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
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractSettingDocTreeBatch(t *testing.T) {
	previousConf, previousReadOnly, previousConfDir := model.Conf, util.ReadOnly, util.ConfDir
	util.ReadOnly, util.ConfDir = true, t.TempDir()
	t.Cleanup(func() { model.Conf, util.ReadOnly, util.ConfDir = previousConf, previousReadOnly, previousConfDir })
	engine := gin.New()
	engine.POST("/api/setting/setFiletree", setFiletree)
	engine.POST("/api/setting/patch", patchSetting)
	for _, route := range []string{"/api/setting/setFiletree", "/api/setting/patch"} {
		for _, test := range []struct {
			body string
			want int
			ok   bool
		}{
			{`{"maxOpenTabCount":8}`, 32, true}, {`{"docTreeBatchSize":1}`, 1, true},
			{`{"docTreeBatchSize":null}`, 512, true}, {`{"docTreeBatchSize":100000}`, 10240, true},
			{`{"docTreeBatchSize":"64"}`, 32, false},
		} {
			model.Conf = model.NewAppConf()
			setting := conf.NewFileTree()
			setting.DocTreeBatchSize, setting.MaxListCount = new(32), 64
			model.Conf.FileTree.Store(setting)
			body := test.body
			if route == "/api/setting/patch" {
				body = `{"fileTree":` + body + `}`
			}
			writer := httptest.NewRecorder()
			request := httptest.NewRequest("POST", route, strings.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(writer, request)
			requireAPIContract(t, "POST", route, writer)
			var response struct {
				Code int `json:"code"`
			}
			if err := json.Unmarshal(writer.Body.Bytes(), &response); err != nil || (response.Code == 0) != test.ok ||
				*model.Conf.FileTree.Load().DocTreeBatchSize != test.want || model.Conf.FileTree.Load().MaxListCount != 64 {
				t.Fatalf("%s %s: %s, %v", route, body, writer.Body.String(), err)
			}
		}
	}
}
