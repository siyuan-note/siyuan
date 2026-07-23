// SiYuan - Refactor your thinking
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

func TestRefreshBacklinkAuthorization(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("reader", func(t *testing.T) {
		engine := gin.New()
		engine.Use(func(c *gin.Context) {
			c.Set(model.RoleContextKey, model.RoleReader)
			c.Next()
		})
		ServeAPI(engine)

		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/ref/refreshBacklink", strings.NewReader(`{"id":"20260723000000-abcdefg"}`))
		request.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, request)

		if recorder.Code != http.StatusForbidden {
			t.Fatalf("reader request returned status %d: %s", recorder.Code, recorder.Body.String())
		}
	})

	t.Run("readonly workspace", func(t *testing.T) {
		previousReadOnly := util.ReadOnly
		previousConf := model.Conf
		util.ReadOnly = true
		model.Conf = &model.AppConf{Lang: "en"}
		defer func() {
			util.ReadOnly = previousReadOnly
			model.Conf = previousConf
		}()

		engine := gin.New()
		engine.Use(func(c *gin.Context) {
			c.Set(model.RoleContextKey, model.RoleAdministrator)
			c.Next()
		})
		ServeAPI(engine)

		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/ref/refreshBacklink", strings.NewReader(`{"id":"20260723000000-abcdefg"}`))
		request.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, request)

		response := &struct {
			Code int `json:"code"`
		}{}
		if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
			t.Fatalf("unmarshal response failed: %v", err)
		}
		if response.Code != -1 {
			t.Fatalf("readonly request returned code %d: %s", response.Code, recorder.Body.String())
		}
	})
}

func TestRefreshBacklinkRejectsInvalidRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.POST("/api/ref/refreshBacklink", refreshBacklink)

	tests := []struct {
		name string
		body string
	}{
		{name: "missing ID", body: `{}`},
		{name: "wrong ID type", body: `{"id":1}`},
		{name: "empty ID", body: `{"id":""}`},
		{name: "invalid ID", body: `{"id":"invalid"}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/api/ref/refreshBacklink", strings.NewReader(test.body))
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)

			response := &struct {
				Code int `json:"code"`
			}{}
			if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
				t.Fatalf("unmarshal response failed: %v", err)
			}
			if response.Code != -1 {
				t.Fatalf("invalid request returned code %d: %s", response.Code, recorder.Body.String())
			}
		})
	}
}
