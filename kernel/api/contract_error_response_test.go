// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractRemovedEntriesKeepNullSuccessData(t *testing.T) {
	previousDir, previousConfDir, previousConf := util.DataDir, util.ConfDir, model.Conf
	util.DataDir, util.ConfDir, model.Conf = t.TempDir(), t.TempDir(), model.NewAppConf()
	t.Cleanup(func() { util.DataDir, util.ConfDir, model.Conf = previousDir, previousConfDir, previousConf })
	engine := gin.New()
	engine.POST("/api/ai/editor/removeAction", removeAIEditorAction)
	engine.POST("/api/storage/removeViewState", removeViewState)
	for _, scenario := range []struct{ path, body string }{
		{"/api/ai/editor/removeAction", `{"id":"20261028000000-abcdefg"}`},
		{"/api/storage/removeViewState", `{"key":"review-fixture"}`},
	} {
		t.Run(scenario.path, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest("POST", scenario.path, strings.NewReader(scenario.body)))
			requireAPIContract(t, "POST", scenario.path, recorder)
			var envelope struct {
				Code int             `json:"code"`
				Data json.RawMessage `json:"data"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
				t.Fatal(err)
			}
			if envelope.Code != 0 || string(envelope.Data) != "null" {
				t.Fatalf("success envelope changed: %s", recorder.Body.String())
			}
		})
	}
}
