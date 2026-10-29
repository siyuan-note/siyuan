package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestAPIContractAIMemoryLifecycle(t *testing.T) {
	aiContractConfiguration(t)
	model.Conf.Sync.Store(conf.NewSync())
	engine := gin.New()
	engine.POST("/api/ai/memory/save", saveAIMemory)
	engine.POST("/api/ai/memory/get", getAIMemory)
	engine.POST("/api/ai/memory/list", listAIMemory)
	engine.POST("/api/ai/memory/forget", forgetAIMemory)
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
	var saved apicontract.AIMemorySaveData
	if err := json.Unmarshal(call("save", q, 0), &saved); err != nil {
		t.Fatal(err)
	}
	var read apicontract.AIMemoryGetData
	json.Unmarshal(call("get", apicontract.AIMemoryGetRequest{ID: saved.ID}, 0), &read)
	if read.Record.Content != q.Content || read.Revision != saved.Revision {
		t.Fatal("memory roundtrip mismatch")
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
}
