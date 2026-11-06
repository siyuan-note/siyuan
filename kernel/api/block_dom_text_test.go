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
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// TestGetDOMTextReaderOmitsOCRAssets 校验读者不能通过调用方构造的 DOM 读取缓存中的资源 OCR 文本。
func TestGetDOMTextReaderOmitsOCRAssets(t *testing.T) {
	oldConf := model.Conf
	model.Conf = model.NewAppConf()
	model.Conf.Editor.Store(conf.NewEditor())
	model.Conf.Export.Store(conf.NewExport())
	t.Cleanup(func() {
		model.Conf = oldConf
	})

	const (
		asset  = "assets/private-ocr-probe.png"
		canary = "PRIVATE_OCR_CANARY_74B1"
	)
	util.SetAssetText(asset, canary)
	t.Cleanup(func() {
		util.RemoveAssetText(asset)
	})

	dom := util.NewLute().Md2BlockDOM("![image]("+asset+")", false)
	payload, err := json.Marshal(map[string]string{"dom": dom})
	if err != nil {
		t.Fatal(err)
	}

	gin.SetMode(gin.TestMode)
	for _, test := range []struct {
		name    string
		role    model.Role
		wantOCR bool
	}{
		{name: "reader", role: model.RoleReader, wantOCR: false},
		{name: "editor", role: model.RoleEditor, wantOCR: true},
		{name: "administrator", role: model.RoleAdministrator, wantOCR: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			engine := gin.New()
			engine.Use(func(c *gin.Context) {
				c.Set(model.RoleContextKey, test.role)
				c.Next()
			})
			engine.POST("/api/block/getDOMText", getDOMText)

			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/api/block/getDOMText", strings.NewReader(string(payload)))
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)

			response := struct {
				Code int    `json:"code"`
				Data string `json:"data"`
			}{}
			if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
				t.Fatalf("unexpected response: %s, %v", recorder.Body.String(), err)
			}
			if got := strings.Contains(response.Data, canary); got != test.wantOCR {
				t.Fatalf("OCR text exposure = %v, want %v; response=%q", got, test.wantOCR, response.Data)
			}
		})
	}
}
