// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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

func TestAPIContractAIAgentInstructions(t *testing.T) {
	aiContractConfiguration(t)
	model.Conf.Sync.Store(conf.NewSync())
	engine := gin.New()
	engine.POST("/api/ai/agent/getInstructions", getAgentInstructions)
	engine.POST("/api/ai/agent/setInstructions", setAgentInstructions)
	call := func(path, body string, code int) apicontract.AIAgentInstructionsData {
		t.Helper()
		path = "/api/ai/agent/" + path
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(body)))
		requireAPIContract(t, "POST", path, recorder)
		var result struct {
			Code int
			Data apicontract.AIAgentInstructionsData
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil || result.Code != code {
			t.Fatalf("%s: %s %v", body, recorder.Body.String(), err)
		}
		return result.Data
	}
	read := call("getInstructions", "", 0)
	if read.Content != "" || read.Revision != "missing" {
		t.Fatalf("missing: %+v", read)
	}
	written := call("setInstructions", `{"content":"Use citations.\r\n","revision":"missing"}`, 0)
	read = call("getInstructions", "", 0)
	if read != written || read.Content != "Use citations.\r\n" {
		t.Fatalf("round trip: %+v", read)
	}
	call("setInstructions", `{"content":"lost update","revision":"missing"}`, -1)
	for _, body := range []string{`{}`, `{"content":null,"revision":"x"}`, `{"content":1,"revision":"x"}`, `{"content":""}`} {
		call("setInstructions", body, -1)
	}
	body, _ := json.Marshal(apicontract.AIAgentInstructionsSaveRequest{Content: "", Revision: read.Revision})
	call("setInstructions", string(body), 0)
	if err := os.WriteFile(util.AgentInstructionsPath(), []byte{255}, 0644); err != nil {
		t.Fatal(err)
	}
	call("getInstructions", "", -1)
	call("setInstructions", string(body), -1)
}

func TestAPIContractAIAgentInstructionsAuthorization(t *testing.T) {
	aiContractConfiguration(t)
	previousReadonly := util.ReadOnly
	t.Cleanup(func() { util.ReadOnly = previousReadonly })
	for _, test := range []struct {
		role     model.Role
		readonly bool
		status   int
	}{
		{model.RoleReader, false, http.StatusForbidden}, {model.RoleEditor, false, http.StatusForbidden},
		{model.RoleAdministrator, true, http.StatusOK},
	} {
		util.ReadOnly = test.readonly
		engine := gin.New()
		engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, test.role); c.Next() })
		ServeAPI(engine)
		request := httptest.NewRequest("POST", "/api/ai/agent/setInstructions", nil)
		request.Body = aiUnreadBody{t: t}
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		if recorder.Code != test.status {
			t.Fatalf("admission: %d %s", recorder.Code, recorder.Body.String())
		}
		if test.readonly && !strings.Contains(recorder.Body.String(), `"code":-1`) {
			t.Fatal("read-only write allowed")
		}
		if _, err := os.Stat(util.AgentInstructionsPath()); !os.IsNotExist(err) {
			t.Fatalf("denied write touched file: %v", err)
		}
	}
}

func TestAPIContractAIAgentInstructionsLegacyMigration(t *testing.T) {
	aiContractConfiguration(t)
	model.Conf.Sync.Store(conf.NewSync())
	legacy := util.LegacyAgentInstructionsPath()
	if err := os.MkdirAll(filepath.Dir(legacy), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(legacy, []byte("legacy preferences\r\n"), 0600); err != nil {
		t.Fatal(err)
	}
	previousReadonly := util.ReadOnly
	t.Cleanup(func() { util.ReadOnly = previousReadonly })
	engine := gin.New()
	engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleAdministrator); c.Next() })
	ServeAPI(engine)
	call := func(name, body string, code int) apicontract.AIAgentInstructionsData {
		t.Helper()
		path := "/api/ai/agent/" + name
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(body)))
		requireAPIContract(t, "POST", path, recorder)
		var result struct {
			Code int
			Data apicontract.AIAgentInstructionsData
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil || result.Code != code {
			t.Fatalf("%s: %s %v", name, recorder.Body.String(), err)
		}
		return result.Data
	}
	util.ReadOnly = true
	read := call("getInstructions", "", 0)
	if read.Content != "legacy preferences\r\n" || read.Revision == "missing" {
		t.Fatalf("legacy read: %+v", read)
	}
	if _, err := os.Stat(util.AgentInstructionsPath()); !os.IsNotExist(err) {
		t.Fatalf("read-only read migrated the file: %v", err)
	}
	body, _ := json.Marshal(apicontract.AIAgentInstructionsSaveRequest{Content: "edited", Revision: read.Revision})
	call("setInstructions", string(body), -1)
	if _, err := os.Stat(util.AgentInstructionsPath()); !os.IsNotExist(err) {
		t.Fatalf("denied save migrated the file: %v", err)
	}
	util.ReadOnly = false
	written := call("setInstructions", string(body), 0)
	if written.Content != "edited" || call("getInstructions", "", 0) != written {
		t.Fatalf("migrated save: %+v", written)
	}
	if _, err := os.Stat(legacy); !os.IsNotExist(err) {
		t.Fatalf("legacy source remains: %v", err)
	}
	if err := os.WriteFile(legacy, []byte("old device update"), 0600); err != nil {
		t.Fatal(err)
	}
	call("getInstructions", "", -1)
	body, _ = json.Marshal(apicontract.AIAgentInstructionsSaveRequest{Content: "replacement", Revision: written.Revision})
	call("setInstructions", string(body), -1)
	for path, want := range map[string]string{legacy: "old device update", util.AgentInstructionsPath(): "edited"} {
		actual, err := os.ReadFile(path)
		if err != nil || string(actual) != want {
			t.Fatalf("conflict changed %s: %q %v", path, actual, err)
		}
	}
}
