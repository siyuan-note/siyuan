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
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBazaarPluginReloadExcludeApp(t *testing.T) {
	for _, test := range []struct {
		name    string
		enabled bool
		app     string
		want    string
	}{
		{name: "enable excludes requesting app", enabled: true, app: "current-app", want: "current-app"},
		{name: "disable includes requesting app", enabled: false, app: "current-app", want: ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := bazaarPluginReloadExcludeApp(test.enabled, test.app); got != test.want {
				t.Fatalf("unexpected excluded app: got %q, want %q", got, test.want)
			}
		})
	}
}

func TestSetFiletreePreservesUseSVGDefaultIconWhenMissing(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousConf := model.Conf
	previousReadOnly := util.ReadOnly
	util.ReadOnly = true
	t.Cleanup(func() {
		model.Conf = previousConf
		util.ReadOnly = previousReadOnly
	})

	engine := gin.New()
	engine.POST("/api/setting/setFiletree", setFiletree)
	for _, test := range []struct {
		name    string
		enabled bool
	}{
		{name: "enabled", enabled: true},
		{name: "disabled"},
	} {
		t.Run(test.name, func(t *testing.T) {
			model.Conf = model.NewAppConf()
			model.Conf.FileTree = conf.NewFileTree()
			model.Conf.FileTree.UseSVGDefaultIcon = new(test.enabled)

			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/api/setting/setFiletree", strings.NewReader(`{}`))
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)

			response := &struct {
				Code int `json:"code"`
			}{}
			if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
				t.Fatalf("unmarshal setFiletree response failed: %v", err)
			}
			if 0 != response.Code {
				t.Fatalf("setFiletree failed: %s", recorder.Body.String())
			}
			if nil == model.Conf.FileTree.UseSVGDefaultIcon ||
				test.enabled != *model.Conf.FileTree.UseSVGDefaultIcon {
				t.Fatalf("missing setting changed the current value: %#v", model.Conf.FileTree.UseSVGDefaultIcon)
			}
		})
	}
}
