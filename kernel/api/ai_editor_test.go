// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAIEditorActionAPI(t *testing.T) {
	gin.SetMode(gin.TestMode)

	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = oldDataDir
	})

	engine := gin.New()
	engine.POST("/api/ai/editor/lsActions", lsAIEditorActions)
	engine.POST("/api/ai/editor/saveAction", saveAIEditorAction)
	engine.POST("/api/ai/editor/removeAction", removeAIEditorAction)

	saveRecorder := httptest.NewRecorder()
	saveRequest := httptest.NewRequest(http.MethodPost, "/api/ai/editor/saveAction",
		strings.NewReader(`{"name":"Format","action":"Line 1\nLine 2"}`))
	saveRequest.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(saveRecorder, saveRequest)

	saveResponse := &struct {
		Code int                   `json:"code"`
		Data *model.AIEditorAction `json:"data"`
	}{}
	if err := json.Unmarshal(saveRecorder.Body.Bytes(), saveResponse); err != nil {
		t.Fatal(err)
	}
	if saveResponse.Code != 0 || saveResponse.Data == nil || saveResponse.Data.ID == "" ||
		saveResponse.Data.Action != "Line 1\nLine 2" {
		t.Fatalf("unexpected save response: %s", saveRecorder.Body.String())
	}

	listRecorder := httptest.NewRecorder()
	listRequest := httptest.NewRequest(http.MethodPost, "/api/ai/editor/lsActions", nil)
	engine.ServeHTTP(listRecorder, listRequest)
	listResponse := &struct {
		Code int                     `json:"code"`
		Data []*model.AIEditorAction `json:"data"`
	}{}
	if err := json.Unmarshal(listRecorder.Body.Bytes(), listResponse); err != nil {
		t.Fatal(err)
	}
	if listResponse.Code != 0 || len(listResponse.Data) != 1 || listResponse.Data[0].ID != saveResponse.Data.ID {
		t.Fatalf("unexpected list response: %s", listRecorder.Body.String())
	}

	removeRecorder := httptest.NewRecorder()
	removeRequest := httptest.NewRequest(http.MethodPost, "/api/ai/editor/removeAction",
		strings.NewReader(`{"id":"`+saveResponse.Data.ID+`"}`))
	removeRequest.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(removeRecorder, removeRequest)
	removeResponse := &struct {
		Code int `json:"code"`
	}{}
	if err := json.Unmarshal(removeRecorder.Body.Bytes(), removeResponse); err != nil {
		t.Fatal(err)
	}
	if removeResponse.Code != 0 {
		t.Fatalf("unexpected remove response: %s", removeRecorder.Body.String())
	}

	actions, err := model.GetAIEditorActions()
	if err != nil {
		t.Fatal(err)
	}
	if len(actions) != 0 {
		t.Fatalf("action was not removed: %#v", actions)
	}
}
