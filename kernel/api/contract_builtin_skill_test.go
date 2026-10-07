package api

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractAIBuiltinSkills(t *testing.T) {
	aiContractConfiguration(t)
	engine := gin.New()
	engine.POST("/api/ai/agent/lsBuiltinSkills", lsBuiltinSkills)
	engine.POST("/api/ai/agent/lsSkills", lsSkills)
	for _, disabled := range []bool{false, true} {
		if disabled {
			model.Conf.AI.Agent.Skills.BuiltinDisabled = []string{util.BuiltinPluginSkillID, "builtin:future"}
		}
		response := httptest.NewRecorder()
		engine.ServeHTTP(response, httptest.NewRequest("POST", "/api/ai/agent/lsBuiltinSkills", strings.NewReader("{}")))
		requireAPIContract(t, "POST", "/api/ai/agent/lsBuiltinSkills", response)
		var result struct {
			Code int                              `json:"code"`
			Data []apicontract.AIBuiltinSkillInfo `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || result.Code != 0 || len(result.Data) != 1 {
			t.Fatalf("invalid builtin discovery: %s, %v", response.Body.String(), err)
		}
		info := result.Data[0]
		if info.Enabled == disabled || info.ID != util.BuiltinPluginSkillID || info.Source != "builtin" || info.Version == "" || !strings.HasPrefix(info.Digest, "sha256:") {
			t.Fatalf("invalid metadata: %+v", info)
		}
		response = httptest.NewRecorder()
		engine.ServeHTTP(response, httptest.NewRequest("POST", "/api/ai/agent/lsSkills", strings.NewReader("{}")))
		requireAPIContract(t, "POST", "/api/ai/agent/lsSkills", response)
		if strings.Contains(response.Body.String(), util.PluginDevelopmentSkillName) {
			t.Fatalf("builtin exposed in unqualified slash skills: %s", response.Body.String())
		}
	}
	if _, err := os.Stat(util.SkillsDir()); !os.IsNotExist(err) {
		t.Fatalf("discovery wrote user directories: %v", err)
	}
}

func TestAPIContractAIBuiltinSkillHTTPGuards(t *testing.T) {
	aiContractConfiguration(t)
	content := "---\nname: " + util.PluginDevelopmentSkillName + "\n---\nprivate workspace body"
	if err := util.SaveSkill(util.PluginDevelopmentSkillName, content); err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.POST("/api/ai/agent/getSkill", getSkill)
	engine.POST("/api/ai/agent/saveSkill", saveSkill)
	engine.POST("/api/ai/agent/removeSkill", removeSkill)
	engine.POST("/api/ai/agent/renameSkill", renameSkill)
	for _, action := range []string{"getSkill", "saveSkill", "removeSkill", "renameSkill"} {
		path := "/api/ai/agent/" + action
		body := `{"source":"builtin","name":"siyuan-plugin-development","oldName":"siyuan-plugin-development","newName":"changed","content":"changed"}`
		response := httptest.NewRecorder()
		engine.ServeHTTP(response, httptest.NewRequest("POST", path, strings.NewReader(body)))
		requireAPIContract(t, "POST", path, response)
		if !strings.Contains(response.Body.String(), `"code":-1`) || strings.Contains(response.Body.String(), "private workspace body") {
			t.Fatalf("explicit builtin request escaped guard: %s", response.Body.String())
		}
		actual, err := util.ReadSkill(util.PluginDevelopmentSkillName, nil)
		if err != nil || actual != content {
			t.Fatalf("denied builtin operation changed same-name workspace skill: %q, %v", actual, err)
		}
	}
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, httptest.NewRequest("POST", "/api/ai/agent/getSkill", strings.NewReader(`{"name":"siyuan-plugin-development"}`)))
	requireAPIContract(t, "POST", "/api/ai/agent/getSkill", response)
	if !strings.Contains(response.Body.String(), "private workspace body") {
		t.Fatalf("ordinary skill resolution changed: %s", response.Body.String())
	}
}
