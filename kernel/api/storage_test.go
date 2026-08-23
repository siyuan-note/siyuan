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

func TestCriteriaCRUD(t *testing.T) {
	gin.SetMode(gin.TestMode)

	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = oldDataDir
	})

	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(model.RoleContextKey, model.RoleAdministrator)
		c.Next()
	})
	ServeAPI(engine)
	perform := func(path, body string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, request)
		return recorder
	}
	type criterionData struct {
		Name     string          `json:"name"`
		SubTypes map[string]bool `json:"subTypes"`
	}
	getCriteria := func() []criterionData {
		t.Helper()
		recorder := perform("/api/storage/getCriteria", `{}`)
		response := &struct {
			Code int             `json:"code"`
			Data []criterionData `json:"data"`
		}{}
		if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
			t.Fatalf("unmarshal criteria response failed: %v", err)
		}
		if response.Code != 0 {
			t.Fatalf("get criteria failed: %s", recorder.Body.String())
		}
		return response.Data
	}

	setRecorder := perform("/api/storage/setCriterion", `{"criterion":{"name":"Public notes","subTypes":{"h1":true}}}`)
	if responseCode(t, setRecorder) != 0 {
		t.Fatalf("set criterion failed: %s", setRecorder.Body.String())
	}
	criteria := getCriteria()
	if len(criteria) != 1 || criteria[0].Name != "Public notes" || !criteria[0].SubTypes["h1"] {
		t.Fatalf("criterion was not persisted: %#v", criteria)
	}

	overwriteRecorder := perform("/api/storage/setCriterion", `{"criterion":{"name":"Public notes","subTypes":{"h2":true}}}`)
	if responseCode(t, overwriteRecorder) != 0 {
		t.Fatalf("overwrite criterion failed: %s", overwriteRecorder.Body.String())
	}
	criteria = getCriteria()
	if len(criteria) != 1 || criteria[0].SubTypes["h1"] || !criteria[0].SubTypes["h2"] {
		t.Fatalf("criterion was not overwritten: %#v", criteria)
	}

	removeRecorder := perform("/api/storage/removeCriterion", `{"name":"Public notes"}`)
	if responseCode(t, removeRecorder) != 0 {
		t.Fatalf("remove criterion failed: %s", removeRecorder.Body.String())
	}
	if criteria = getCriteria(); len(criteria) != 0 {
		t.Fatalf("criterion was not removed: %#v", criteria)
	}
}

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

func TestGetViewStateByRole(t *testing.T) {
	gin.SetMode(gin.TestMode)

	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = oldDataDir
	})

	const viewKey = "backlink:dock:20260820000000-host"
	if _, err := model.PatchViewState(viewKey, map[string]any{
		"fold:20260820000000-block": true,
	}, nil); err != nil {
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
				"/api/storage/getViewState",
				strings.NewReader(`{"key":"`+viewKey+`"}`),
			)
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)

			if recorder.Code != role.statusCode {
				t.Fatalf("unexpected status code: got %d, want %d", recorder.Code, role.statusCode)
			}
			if role.role == model.RoleReader {
				if strings.Contains(recorder.Body.String(), "20260820000000-block") {
					t.Fatalf("reader received administrator view state: %s", recorder.Body.String())
				}
				return
			}
			if !strings.Contains(recorder.Body.String(), "20260820000000-block") {
				t.Fatalf("administrator did not receive view state: %s", recorder.Body.String())
			}
		})
	}
}

func TestMutateViewStateByRoleAndReadonly(t *testing.T) {
	gin.SetMode(gin.TestMode)

	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = oldDataDir
	})

	const (
		viewKey = "backlink:dock:20260820000000-host"
		field   = "fold:20260820000000-block"
	)
	if _, err := model.PatchViewState(viewKey, map[string]any{field: true}, nil); err != nil {
		t.Fatal(err)
	}

	for _, path := range []string{"/api/storage/patchViewState", "/api/storage/removeViewState"} {
		engine := newViewStateAPIEngine(model.RoleReader)
		body := `{"key":"` + viewKey + `"}`
		if strings.HasSuffix(path, "patchViewState") {
			body = `{"key":"` + viewKey + `","values":{"` + field + `":false}}`
		}
		recorder := performViewStateAPIRequest(engine, path, body)
		if recorder.Code != http.StatusForbidden {
			t.Fatalf("reader mutation returned status %d for %s: %s", recorder.Code, path, recorder.Body.String())
		}
	}
	state, err := model.GetViewState(viewKey)
	if err != nil {
		t.Fatal(err)
	}
	if folded, ok := state[field].(bool); !ok || !folded {
		t.Fatalf("reader changed view state: %#v", state)
	}

	oldReadOnly := util.ReadOnly
	oldConf := model.Conf
	t.Cleanup(func() {
		util.ReadOnly = oldReadOnly
		model.Conf = oldConf
	})
	util.ReadOnly = true
	model.Conf = &model.AppConf{Lang: "en"}
	readOnlyRecorder := performViewStateAPIRequest(
		newViewStateAPIEngine(model.RoleAdministrator),
		"/api/storage/patchViewState",
		`{"key":"`+viewKey+`","values":{"`+field+`":false}}`,
	)
	util.ReadOnly = oldReadOnly
	model.Conf = oldConf
	if responseCode(t, readOnlyRecorder) != -1 {
		t.Fatalf("read-only mutation was not rejected: %s", readOnlyRecorder.Body.String())
	}
	state, err = model.GetViewState(viewKey)
	if err != nil {
		t.Fatal(err)
	}
	if folded, ok := state[field].(bool); !ok || !folded {
		t.Fatalf("read-only request changed view state: %#v", state)
	}

	adminEngine := newViewStateAPIEngine(model.RoleAdministrator)
	patchRecorder := performViewStateAPIRequest(
		adminEngine,
		"/api/storage/patchViewState",
		`{"key":"`+viewKey+`","values":{"`+field+`":false}}`,
	)
	if responseCode(t, patchRecorder) != 0 {
		t.Fatalf("administrator patch failed: %s", patchRecorder.Body.String())
	}
	state, err = model.GetViewState(viewKey)
	if err != nil {
		t.Fatal(err)
	}
	if folded, ok := state[field].(bool); !ok || folded {
		t.Fatalf("administrator patch was not persisted: %#v", state)
	}

	removeRecorder := performViewStateAPIRequest(
		adminEngine,
		"/api/storage/removeViewState",
		`{"key":"`+viewKey+`"}`,
	)
	if responseCode(t, removeRecorder) != 0 {
		t.Fatalf("administrator removal failed: %s", removeRecorder.Body.String())
	}
	state, err = model.GetViewState(viewKey)
	if err != nil {
		t.Fatal(err)
	}
	if 0 != len(state) {
		t.Fatalf("administrator removal was not persisted: %#v", state)
	}
}

func TestViewStateAPIRejectsInvalidArguments(t *testing.T) {
	gin.SetMode(gin.TestMode)

	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = oldDataDir
	})

	tests := []struct {
		name string
		path string
		body string
		msg  string
	}{
		{name: "missing key", path: "/api/storage/getViewState", body: `{}`, msg: "Field [key] is required"},
		{name: "empty key", path: "/api/storage/removeViewState", body: `{"key":" "}`, msg: "Field [key] must not be empty"},
		{
			name: "values is not an object",
			path: "/api/storage/patchViewState",
			body: `{"key":"view","values":[]}`,
			msg:  "Field [values]: should be of type [Object]",
		},
		{
			name: "remove keys is not an array",
			path: "/api/storage/patchViewState",
			body: `{"key":"view","removeKeys":"field"}`,
			msg:  "Field [removeKeys]: each element should be a non-empty String",
		},
		{
			name: "remove key is empty",
			path: "/api/storage/patchViewState",
			body: `{"key":"view","removeKeys":[""]}`,
			msg:  "Field [removeKeys]: each element should be a non-empty String",
		},
		{
			name: "remove key is whitespace",
			path: "/api/storage/patchViewState",
			body: `{"key":"view","removeKeys":[" "]}`,
			msg:  "Field [removeKeys]: each element should be a non-empty String",
		},
	}
	engine := newViewStateAPIEngine(model.RoleAdministrator)
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := performViewStateAPIRequest(engine, test.path, test.body)
			response := &struct {
				Code int    `json:"code"`
				Msg  string `json:"msg"`
			}{}
			if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
				t.Fatalf("unmarshal response failed: %v", err)
			}
			if response.Code != -1 || !strings.Contains(response.Msg, test.msg) {
				t.Fatalf("unexpected invalid argument response: %s", recorder.Body.String())
			}
		})
	}
}

func newViewStateAPIEngine(role model.Role) *gin.Engine {
	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(model.RoleContextKey, role)
		c.Next()
	})
	ServeAPI(engine)
	return engine
}

func performViewStateAPIRequest(engine *gin.Engine, path, body string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)
	return recorder
}

func responseCode(t *testing.T, recorder *httptest.ResponseRecorder) int {
	t.Helper()
	response := &struct {
		Code int `json:"code"`
	}{}
	if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
		t.Fatalf("unmarshal response failed: %v", err)
	}
	return response.Code
}
