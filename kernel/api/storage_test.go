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

func TestGetLocalStorageByRole(t *testing.T) {
	gin.SetMode(gin.TestMode)

	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = oldDataDir
	})

	if err := model.SetLocalStorage(map[string]any{
		"local-closed-tabs": []any{
			map[string]any{
				"title": "private-document-title",
				"children": map[string]any{
					"rootId": "20260729000000-private",
				},
			},
		},
		"future-private-key": "future-private-value",
	}); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name string
		path string
		body string
	}{
		{
			name: "all",
			path: "/api/storage/getLocalStorage",
		},
		{
			name: "single value",
			path: "/api/storage/getLocalStorageVal",
			body: `{"key":"local-closed-tabs"}`,
		},
		{
			name: "multiple values",
			path: "/api/storage/getLocalStorageVals",
			body: `{"keys":["local-closed-tabs","future-private-key"]}`,
		},
	}
	roles := []struct {
		name string
		role model.Role
	}{
		{name: "administrator", role: model.RoleAdministrator},
		{name: "reader", role: model.RoleReader},
	}
	for _, role := range roles {
		for _, test := range tests {
			t.Run(role.name+"/"+test.name, func(t *testing.T) {
				engine := gin.New()
				engine.Use(func(c *gin.Context) {
					c.Set(model.RoleContextKey, role.role)
					c.Next()
				})
				engine.POST("/api/storage/getLocalStorage", getLocalStorage)
				engine.POST("/api/storage/getLocalStorageVal", getLocalStorageVal)
				engine.POST("/api/storage/getLocalStorageVals", getLocalStorageVals)

				recorder := httptest.NewRecorder()
				request := httptest.NewRequest(http.MethodPost, test.path, strings.NewReader(test.body))
				if test.body != "" {
					request.Header.Set("Content-Type", "application/json")
				}
				engine.ServeHTTP(recorder, request)

				response := &struct {
					Code int             `json:"code"`
					Data json.RawMessage `json:"data"`
				}{}
				if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
					t.Fatalf("unmarshal local storage response failed: %v", err)
				}
				if response.Code != 0 {
					t.Fatalf("get local storage failed: %s", recorder.Body.String())
				}

				if role.role == model.RoleAdministrator {
					if !strings.Contains(string(response.Data), "private-document-title") {
						t.Fatalf("administrator local storage data was removed: %s", recorder.Body.String())
					}
					return
				}

				if strings.Contains(string(response.Data), "private-document-title") ||
					strings.Contains(string(response.Data), "future-private-value") {
					t.Fatalf("reader received administrator local storage data: %s", recorder.Body.String())
				}
				switch test.name {
				case "all":
					data := map[string]any{}
					if err := json.Unmarshal(response.Data, &data); err != nil {
						t.Fatal(err)
					}
					if len(data) != 0 {
						t.Fatalf("reader received non-empty local storage: %#v", data)
					}
				case "single value":
					if string(response.Data) != "null" {
						t.Fatalf("reader received a local storage value: %s", response.Data)
					}
				case "multiple values":
					data := map[string]any{}
					if err := json.Unmarshal(response.Data, &data); err != nil {
						t.Fatal(err)
					}
					if len(data) != 2 || data["local-closed-tabs"] != nil || data["future-private-key"] != nil {
						t.Fatalf("reader received local storage values: %#v", data)
					}
				}
			})
		}
	}
}

func TestGetOutlineStorageByRole(t *testing.T) {
	gin.SetMode(gin.TestMode)

	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = oldDataDir
	})

	const (
		docID     = "20260729000000-document"
		headingID = "20260729000000-heading"
	)
	if err := model.SetOutlineStorage(docID, map[string]any{
		"expandIds": []any{headingID},
	}); err != nil {
		t.Fatal(err)
	}

	roles := []struct {
		name       string
		role       model.Role
		statusCode int
	}{
		{name: "administrator", role: model.RoleAdministrator, statusCode: http.StatusOK},
		{name: "reader", role: model.RoleReader, statusCode: http.StatusForbidden},
	}
	for _, role := range roles {
		t.Run(role.name, func(t *testing.T) {
			engine := gin.New()
			engine.Use(func(c *gin.Context) {
				c.Set(model.RoleContextKey, role.role)
				c.Next()
			})
			ServeAPI(engine)

			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(
				http.MethodPost,
				"/api/storage/getOutlineStorage",
				strings.NewReader(`{"docID":"`+docID+`"}`),
			)
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)

			if recorder.Code != role.statusCode {
				t.Fatalf("unexpected status code: got %d, want %d", recorder.Code, role.statusCode)
			}
			if role.role == model.RoleReader {
				if strings.Contains(recorder.Body.String(), headingID) {
					t.Fatalf("reader received administrator outline storage data: %s", recorder.Body.String())
				}
				return
			}

			response := &struct {
				Code int `json:"code"`
				Data struct {
					ExpandIDs []string `json:"expandIds"`
				} `json:"data"`
			}{}
			if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
				t.Fatalf("unmarshal outline storage response failed: %v", err)
			}
			if response.Code != 0 || len(response.Data.ExpandIDs) != 1 || response.Data.ExpandIDs[0] != headingID {
				t.Fatalf("administrator did not receive outline storage data: %s", recorder.Body.String())
			}
		})
	}
}
