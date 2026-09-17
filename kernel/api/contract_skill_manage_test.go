package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractAISkillManagement(t *testing.T) {
	aiContractConfiguration(t)
	model.Conf.Sync = conf.NewSync()
	engine := gin.New()
	engine.POST("/api/ai/agent/manageSkills", manageSkills)
	call := func(body string, code int) apicontract.AISkillFileData {
		t.Helper()
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/ai/agent/manageSkills", strings.NewReader(body)))
		requireAPIContract(t, "POST", "/api/ai/agent/manageSkills", recorder)
		var result struct {
			Code int                         `json:"code"`
			Data apicontract.AISkillFileData `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil || result.Code != code {
			t.Fatalf("request %s: %s %v", body, recorder.Body.String(), err)
		}
		return result.Data
	}
	list := call(`{"action":"list"}`, 0)
	if list.Entries == nil || len(*list.Entries) != 0 {
		t.Fatalf("empty list must contain an empty entries array: %+v", list)
	}
	created := call(`{"action":"create","path":"directory","content":"---\r\nname: display-name\r\n---\r\nOriginal\r\n"}`, 0)
	if created.Content == nil || created.Revision == "" {
		t.Fatalf("missing created source: %+v", created)
	}
	read := call(`{"action":"read","path":"directory/SKILL.md"}`, 0)
	if read.Content == nil || *read.Content != *created.Content || read.Revision != created.Revision {
		t.Fatalf("raw source changed: %+v", read)
	}
	call(`{"action":"write","path":"directory/SKILL.md","content":"overwritten","revision":"stale"}`, -1)
	call(`{"action":"write","path":"directory/SKILL.md","content":""}`, -1)
	call(`{"action":"read","path":"../outside.md"}`, -1)
	call(`{"action":null}`, -1)
	call(`{"action":"read","path":true}`, -1)
	call(`{"action":"unknown"}`, -1)
	call(`{`, -1)
	encoded, err := json.Marshal(apicontract.AISkillFileRequest{Action: "write", Path: "directory/SKILL.md", Content: "", Revision: read.Revision})
	if err != nil {
		t.Fatal(err)
	}
	written := call(string(encoded), 0)
	read = call(`{"action":"read","path":"directory/SKILL.md"}`, 0)
	if read.Content == nil || *read.Content != "" || written.Revision != read.Revision {
		t.Fatalf("empty content omitted or revision incorrect: %+v", read)
	}
	call(`{"action":"mkdir","path":"directory/references"}`, 0)
	call(`{"action":"write","path":"directory/references/reference.md","content":"reference"}`, 0)
	call(`{"action":"mkdir","path":"directory/.claude"}`, 0)
	call(`{"action":"write","path":"directory/.claude/.config.json","content":"{\r\n\"enabled\":true\r\n}\r\n"}`, 0)
	text := call(`{"action":"read","path":"directory/.claude/.config.json"}`, 0)
	if text.Content == nil || *text.Content != "{\r\n\"enabled\":true\r\n}\r\n" || text.ReadOnlyReason != "" {
		t.Fatalf("hidden JSON file is not editable: %+v", text)
	}
	for _, fixture := range []struct{ name, content, reason string }{
		{"binary.json", "\x00\x01", "binary"},
		{"encoding.txt", "\xff\xfea\x00", "encoding"},
		{"large.txt", strings.Repeat("a", 8*1024*1024+1), "tooLarge"},
	} {
		if err = os.WriteFile(filepath.Join(util.SkillsDir(), "directory", fixture.name), []byte(fixture.content), 0644); err != nil {
			t.Fatal(err)
		}
		response := call(`{"action":"read","path":"directory/`+fixture.name+`"}`, 0)
		if response.Content != nil || response.ReadOnlyReason != fixture.reason || response.Revision == "" {
			t.Fatalf("read-only reason missing from HTTP response: %+v", response)
		}
	}
	resource := filepath.Join(util.SkillsDir(), "directory", "asset.bin")
	if err = os.WriteFile(resource, []byte{0, 255}, 0644); err != nil {
		t.Fatal(err)
	}
	asset := call(`{"action":"read","path":"directory/asset.bin"}`, 0)
	if asset.Content != nil || asset.Revision == "" {
		t.Fatalf("asset content or revision incorrect: %+v", asset)
	}
	directory := call(`{"action":"read","path":"directory"}`, 0)
	if directory.Content != nil || directory.Revision == "" {
		t.Fatalf("directory content or revision incorrect: %+v", directory)
	}
	encoded, err = json.Marshal(apicontract.AISkillFileRequest{Action: "move", Path: "directory", Target: "renamed", Revision: directory.Revision})
	if err != nil {
		t.Fatal(err)
	}
	call(string(encoded), 0)
	directory = call(`{"action":"read","path":"renamed"}`, 0)
	encoded, err = json.Marshal(apicontract.AISkillFileRequest{Action: "remove", Path: "renamed", Revision: directory.Revision})
	if err != nil {
		t.Fatal(err)
	}
	call(string(encoded), 0)
	if _, err = os.Stat(filepath.Join(util.SkillsDir(), "renamed")); !os.IsNotExist(err) {
		t.Fatalf("removed skill is still present: %v", err)
	}
}

func TestAPIContractAISkillManagementAuthorization(t *testing.T) {
	aiContractConfiguration(t)
	previousReadonly := util.ReadOnly
	t.Cleanup(func() { util.ReadOnly = previousReadonly })
	for _, test := range []struct {
		name     string
		role     model.Role
		readonly bool
		status   int
	}{
		{"reader", model.RoleReader, false, http.StatusForbidden},
		{"editor", model.RoleEditor, false, http.StatusForbidden},
		{"readonly", model.RoleAdministrator, true, http.StatusOK},
	} {
		t.Run(test.name, func(t *testing.T) {
			util.ReadOnly = test.readonly
			engine := gin.New()
			engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, test.role); c.Next() })
			ServeAPI(engine)
			request := httptest.NewRequest("POST", "/api/ai/agent/manageSkills", nil)
			request.Body = aiUnreadBody{t: t}
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			if recorder.Code != test.status {
				t.Fatalf("authorization changed: %d %s", recorder.Code, recorder.Body.String())
			}
			if test.readonly {
				requireAPIContract(t, "POST", "/api/ai/agent/manageSkills", recorder)
				if !strings.Contains(recorder.Body.String(), `"code":-1`) {
					t.Fatalf("read-only request reached handler: %s", recorder.Body.String())
				}
			}
			if _, err := os.Stat(util.SkillsDir()); !os.IsNotExist(err) {
				t.Fatalf("denied request modified workspace: %v", err)
			}
		})
	}
}
