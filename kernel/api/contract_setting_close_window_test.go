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
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractSettingCloseWindowOnLastTab(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousConf, previousReadOnly, previousConfDir := model.Conf, util.ReadOnly, util.ConfDir
	util.ReadOnly, util.ConfDir = true, t.TempDir()
	t.Cleanup(func() { model.Conf, util.ReadOnly, util.ConfDir = previousConf, previousReadOnly, previousConfDir })
	engine := gin.New()
	engine.POST("/api/setting/setFiletree", setFiletree)
	engine.POST("/api/setting/patch", patchSetting)
	for _, path := range []string{"/api/setting/setFiletree", "/api/setting/patch"} {
		for _, entry := range []struct {
			body string
			want bool
			ok   bool
		}{
			{`{"maxOpenTabCount":8}`, false, true},
			{`{"closeWindowOnLastTabClosed":true}`, true, true},
			{`{"closeWindowOnLastTabClosed":false}`, false, true},
			{`{"closeWindowOnLastTabClosed":null}`, true, true},
			{`{"closeWindowOnLastTabClosed":"true"}`, false, false},
		} {
			model.Conf = model.NewAppConf()
			fileTree := conf.NewFileTree()
			fileTree.CloseWindowOnLastTabClosed = new(false)
			model.Conf.FileTree.Store(fileTree)
			body := entry.body
			if path == "/api/setting/patch" {
				body = `{"fileTree":` + body + `}`
			}
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest("POST", path, strings.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)
			requireAPIContract(t, "POST", path, recorder)
			var response struct {
				Code int                          `json:"code"`
				Data *apicontract.SettingFileTree `json:"data"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if (response.Code == 0) != entry.ok || *model.Conf.FileTree.Load().CloseWindowOnLastTabClosed != entry.want {
				t.Fatalf("%s %s: unexpected result %s", path, body, recorder.Body.String())
			}
			if entry.ok && path == "/api/setting/setFiletree" &&
				(response.Data == nil || response.Data.CloseWindowOnLastTabClosed == nil ||
					*response.Data.CloseWindowOnLastTabClosed != entry.want) {
				t.Fatalf("response lost last-tab close preference: %s", recorder.Body.String())
			}
		}
	}
}
