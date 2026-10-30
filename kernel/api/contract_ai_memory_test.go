// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractAIMemoryLifecycle(t *testing.T) {
	aiContractConfiguration(t)
	model.Conf.Sync.Store(conf.NewSync())
	engine := gin.New()
	engine.POST("/api/ai/memory/save", saveAIMemory)
	engine.POST("/api/ai/memory/get", getAIMemory)
	engine.POST("/api/ai/memory/list", listAIMemory)
	engine.POST("/api/ai/memory/forget", forgetAIMemory)
	engine.POST("/api/ai/memory/overview", overviewAIMemory)
	call := func(route string, body any, code int) json.RawMessage {
		t.Helper()
		data, _ := json.Marshal(body)
		path := "/api/ai/memory/" + route
		w := httptest.NewRecorder()
		engine.ServeHTTP(w, httptest.NewRequest("POST", path, strings.NewReader(string(data))))
		requireAPIContract(t, "POST", path, w)
		var result struct {
			Code int
			Data json.RawMessage
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || result.Code != code {
			t.Fatalf("%s: %s (%v)", route, w.Body.String(), err)
		}
		return result.Data
	}
	q := apicontract.AIMemorySaveRequest{Revision: "missing", OperationID: "manual-1", Content: "I prefer concise explanations", Kind: "preference", Subject: "user", Scope: "workspace", State: "active"}
	original := q
	var saved apicontract.AIMemorySaveData
	if err := json.Unmarshal(call("save", q, 0), &saved); err != nil {
		t.Fatal(err)
	}
	var read apicontract.AIMemoryGetData
	json.Unmarshal(call("get", apicontract.AIMemoryGetRequest{ID: saved.ID}, 0), &read)
	if read.Record.Content != q.Content || read.Revision != saved.Revision {
		t.Fatal("memory roundtrip mismatch")
	}
	var overview apicontract.AIMemoryOverviewData
	if err := json.Unmarshal(call("overview", apicontract.EmptyRequest{}, 0), &overview); err != nil {
		t.Fatal(err)
	}
	if overview.Count != 1 || !overview.CountComplete || overview.User != "" {
		t.Fatalf("overview lost the usable count or compatibility field: %+v", overview)
	}
	q.ID = saved.ID
	q.Revision = saved.Revision
	q.OperationID = "manual-2"
	q.Content = "Use detailed explanations when requested"
	json.Unmarshal(call("save", q, 0), &saved)
	q.OperationID = "stale"
	call("save", q, -1)
	call("forget", apicontract.AIMemoryForgetRequest{ID: saved.ID, Revision: saved.Revision, OperationID: "forget-1"}, 0)
	call("get", apicontract.AIMemoryGetRequest{ID: saved.ID}, -1)
	var listed apicontract.AIMemoryListData
	json.Unmarshal(call("list", apicontract.AIMemoryListRequest{}, 0), &listed)
	if len(listed.Records) != 0 {
		t.Fatal("withdrawn record still listed")
	}
	if err := json.Unmarshal(call("overview", apicontract.EmptyRequest{}, 0), &overview); err != nil {
		t.Fatal(err)
	}
	if overview.Count != 0 || !overview.CountComplete || overview.User != "" {
		t.Fatalf("overview counted withdrawn memory: %+v", overview)
	}
	call("save", original, -1)
	// 撤回标记已生效，但同步残留的目标暂时不能物理删除，响应仍保留成功状态。
	blocked := filepath.Join(util.DataDir, "storage", "ai", "memos", "records", saved.ID+".md")
	if err := os.Mkdir(blocked, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(blocked, "obstacle"), []byte("test"), 0600); err != nil {
		t.Fatal(err)
	}
	var forgotten apicontract.AIMemoryForgetData
	json.Unmarshal(call("forget", apicontract.AIMemoryForgetRequest{ID: saved.ID, Revision: saved.Revision, OperationID: "forget-1"}, 0), &forgotten)
	if !forgotten.Saved || !forgotten.CleanupPending {
		t.Fatalf("partial cleanup response lost durable withdrawal: %+v", forgotten)
	}
}

func TestAPIContractAIMemoryReasoningOptions(t *testing.T) {
	aiContractConfiguration(t)
	engine := gin.New()
	engine.POST("/api/ai/memory/capabilities", capabilitiesAIMemory)
	cfg := conf.NewAI()
	cfg.Providers = []*conf.Provider{{Enabled: true, Models: []*conf.Model{{ID: "chosen", Name: "deepseek-flash", Enabled: true}}}}
	cfg.Memory.ModelID = "chosen"
	for _, tc := range []struct {
		name    string
		modelID string
		enabled bool
		want    []string
	}{
		{"deepseek", "chosen", true, []string{"none", "low", "medium", "high", "xhigh", "max"}},
		{"unconfigured", "", true, []string{}},
		{"missing", "removed", true, []string{}},
		{"disabled", "chosen", false, []string{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg.Memory.ModelID = tc.modelID
			cfg.Providers[0].Models[0].Enabled = tc.enabled
			model.Conf.AI.Store(cfg)
			w := httptest.NewRecorder()
			engine.ServeHTTP(w, httptest.NewRequest("POST", "/api/ai/memory/capabilities", strings.NewReader("{}")))
			requireAPIContract(t, "POST", "/api/ai/memory/capabilities", w)
			var result struct {
				Code int
				Data apicontract.AIMemoryCapabilitiesData
			}
			if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || result.Code != 0 {
				t.Fatalf("capabilities: %s (%v)", w.Body.String(), err)
			}
			if !reflect.DeepEqual(result.Data.Efforts, tc.want) {
				t.Fatalf("options = %v, want %v", result.Data.Efforts, tc.want)
			}
		})
	}
}
