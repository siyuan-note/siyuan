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

func TestAttributeViewEditorEndpointsRejectReader(t *testing.T) {
	gin.SetMode(gin.TestMode)

	previousConf := model.Conf
	model.Conf = &model.AppConf{Lang: "en"}
	t.Cleanup(func() {
		model.Conf = previousConf
	})

	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(model.RoleContextKey, model.RoleReader)
		c.Next()
	})
	ServeAPI(engine)

	tests := []struct {
		path string
		body string
	}{
		{
			path: "/api/av/getAttributeViewFieldViews",
			body: `{"avID":"20260726000000-abcdefg","keyID":"20260726000001-abcdefg"}`,
		},
		{
			path: "/api/av/getAttributeViewSearchTarget",
			body: `{"id":"20260726000000-abcdefg","keywords":["secret"]}`,
		},
	}
	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, test.path, strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)

			response := &struct {
				Code int            `json:"code"`
				Data map[string]any `json:"data"`
			}{}
			if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
				t.Fatalf("unmarshal response failed: %v", err)
			}
			if response.Code != -1 {
				t.Fatalf("reader request returned code %d: %s", response.Code, recorder.Body.String())
			}
			if response.Data["closeTimeout"] != float64(5000) {
				t.Fatalf("reader request reached the handler: %s", recorder.Body.String())
			}
		})
	}
}

func TestGetAttributeViewKeysByIDRespectsPublishAccess(t *testing.T) {
	gin.SetMode(gin.TestMode)

	previousConf := model.Conf
	model.Conf = &model.AppConf{Lang: "en"}
	previousDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		model.Conf = previousConf
		util.DataDir = previousDataDir
	})

	roles := []struct {
		name string
		role model.Role
		code int
	}{
		{name: "reader", role: model.RoleReader, code: -1},
		{name: "editor", role: model.RoleEditor, code: 0},
		{name: "administrator", role: model.RoleAdministrator, code: 0},
	}
	for _, role := range roles {
		t.Run(role.name, func(t *testing.T) {
			engine := gin.New()
			engine.Use(func(c *gin.Context) {
				c.Set(model.RoleContextKey, role.role)
				c.Next()
			})
			engine.Handle(http.MethodPost, "/api/av/getAttributeViewKeysByID", getAttributeViewKeysByID)

			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(
				http.MethodPost,
				"/api/av/getAttributeViewKeysByID",
				strings.NewReader(`{"avID":"20260726000000-abcdefg","keyIDs":[]}`),
			)
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)

			response := &struct {
				Code int `json:"code"`
			}{}
			if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
				t.Fatalf("unmarshal response failed: %v", err)
			}
			if response.Code != role.code {
				t.Fatalf("unexpected code: got %d, want %d: %s", response.Code, role.code, recorder.Body.String())
			}
		})
	}
}

func TestGetAttributeViewSearchTargetAllowsEditor(t *testing.T) {
	gin.SetMode(gin.TestMode)

	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(model.RoleContextKey, model.RoleEditor)
		c.Next()
	})
	ServeAPI(engine)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/av/getAttributeViewSearchTarget",
		strings.NewReader(`{"id":"","keywords":[]}`),
	)
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)

	response := &struct {
		Code int            `json:"code"`
		Data map[string]any `json:"data"`
	}{}
	if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
		t.Fatalf("unmarshal response failed: %v", err)
	}
	if response.Code != 0 {
		t.Fatalf("editor request returned code %d: %s", response.Code, recorder.Body.String())
	}
	if response.Data["closeTimeout"] != nil {
		t.Fatalf("editor request was rejected as read-only: %s", recorder.Body.String())
	}
}
