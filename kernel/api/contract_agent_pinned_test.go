// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/agent"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractAISessionPinned(t *testing.T) {
	aiContractConfiguration(t)
	const id = "20261020120000-abcdefg"
	if _, _, err := agent.SaveSessionState([]byte(`{"id":"` + id + `","title":"Pinned","createdAt":1}`)); err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.POST("/api/ai/agent/setPinned", setAgentSessionPinned)
	engine.POST("/api/ai/agent/lsSessions", lsSessions)
	call := func(path, body string, code int) json.RawMessage {
		t.Helper()
		path = "/api/ai/agent/" + path
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(body)))
		requireAPIContract(t, "POST", path, recorder)
		var result struct {
			Code int
			Data json.RawMessage
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil || result.Code != code {
			t.Fatalf("%s: %s %v", body, recorder.Body.String(), err)
		}
		return result.Data
	}
	var pin apicontract.AISessionPinnedData
	if err := json.Unmarshal(call("setPinned", `{"id":"`+id+`","pinned":true}`, 0), &pin); err != nil || pin.PinnedAt <= 0 {
		t.Fatalf("pin: %+v %v", pin, err)
	}
	var list apicontract.AISessionList
	if err := json.Unmarshal(call("lsSessions", `{}`, 0), &list); err != nil || len(list.Sessions) != 1 || list.Sessions[0].PinnedAt != pin.PinnedAt {
		t.Fatalf("list: %+v %v", list, err)
	}
	for _, body := range []string{
		`{}`, `{"id":"` + id + `"}`, `{"id":"` + id + `","pinned":null}`,
		`{"id":"` + id + `","pinned":1}`, `{"id":"` + id + `","pinned":"true"}`,
		`{"id":null,"pinned":true}`, `{"id":"../outside","pinned":true}`,
		`{"id":"20261020120000-missing","pinned":true}`,
	} {
		call("setPinned", body, -1)
	}
	if err := json.Unmarshal(call("setPinned", `{"id":"`+id+`","pinned":false}`, 0), &pin); err != nil || pin.PinnedAt != 0 {
		t.Fatalf("unpin: %+v %v", pin, err)
	}
}

func TestAPIContractAISessionPinnedAuthorization(t *testing.T) {
	aiContractConfiguration(t)
	previous := util.ReadOnly
	t.Cleanup(func() { util.ReadOnly = previous })
	for _, test := range []struct {
		role     model.Role
		readonly bool
		status   int
	}{
		{model.RoleReader, false, http.StatusForbidden},
		{model.RoleEditor, false, http.StatusForbidden},
		{model.RoleAdministrator, true, http.StatusOK},
	} {
		util.ReadOnly = test.readonly
		engine := gin.New()
		engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, test.role); c.Next() })
		ServeAPI(engine)
		request := httptest.NewRequest("POST", "/api/ai/agent/setPinned", nil)
		request.Body = aiUnreadBody{t: t}
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, request)
		if recorder.Code != test.status || (test.readonly && !strings.Contains(recorder.Body.String(), `"code":-1`)) {
			t.Fatalf("admission: %d %s", recorder.Code, recorder.Body.String())
		}
	}
}
