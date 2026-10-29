// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractClearRecentDocs(t *testing.T) {
	previousDir, previousConf, previousReadonly := util.DataDir, model.Conf, util.ReadOnly
	util.DataDir, model.Conf, util.ReadOnly = t.TempDir(), model.NewAppConf(), false
	model.Conf.FileTree.Store(conf.NormalizeFileTree(conf.NewFileTree()))
	t.Cleanup(func() { util.DataDir, model.Conf, util.ReadOnly = previousDir, previousConf, previousReadonly })
	const route = "/api/storage/clearRecentDocs"
	recordPath := filepath.Join(util.DataDir, "storage", "recent-doc.json")
	if err := os.MkdirAll(filepath.Dir(recordPath), 0700); err != nil {
		t.Fatal(err)
	}
	const records = `[{"rootID":"20261021000000-abcdefg","viewedAt":1,"openAt":2,"closedAt":3}]`
	for _, scenario := range []struct {
		name     string
		role     model.Role
		readonly bool
		status   int
		success  bool
	}{
		{"unauthenticated", model.RoleVisitor, false, http.StatusUnauthorized, false},
		{"administrator", model.RoleAdministrator, false, http.StatusOK, true},
		{"editor", model.RoleEditor, false, http.StatusForbidden, false},
		{"reader", model.RoleReader, false, http.StatusForbidden, false},
		{"readonly", model.RoleAdministrator, true, http.StatusOK, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			if err := os.WriteFile(recordPath, []byte(records), 0600); err != nil {
				t.Fatal(err)
			}
			util.ReadOnly = scenario.readonly
			engine := gin.New()
			engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, scenario.role) })
			engine.POST(route, contractRouteHandlers(apicontract.ClearRecentDocs, clearRecentDocs)...)
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest("POST", route, nil)
			request.RemoteAddr = "198.51.100.1:12345"
			engine.ServeHTTP(recorder, request)
			if recorder.Code != scenario.status {
				t.Fatalf("unexpected status: %d %s", recorder.Code, recorder.Body.String())
			}
			if scenario.status == http.StatusOK {
				requireAPIContract(t, "POST", route, recorder)
				var result struct {
					Code int `json:"code"`
				}
				if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil || (result.Code == 0) != scenario.success {
					t.Fatalf("unexpected response: %s, %v", recorder.Body.String(), err)
				}
			}
			data, err := os.ReadFile(recordPath)
			want := records
			if scenario.success {
				want = "[]"
			}
			if err != nil || string(data) != want {
				t.Fatalf("unexpected persisted records: %s, %v", data, err)
			}
		})
	}
	util.ReadOnly = false
	util.DataDir = t.TempDir()
	if err := os.WriteFile(filepath.Join(util.DataDir, "storage"), []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.POST(route, clearRecentDocs)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("POST", route, nil))
	requireAPIContract(t, "POST", route, recorder)
	if !strings.Contains(recorder.Body.String(), `"code":-1`) {
		t.Fatalf("write failure returned success: %s", recorder.Body.String())
	}
}

func TestAPIContractReadonlyRecentDocsIgnoreBody(t *testing.T) {
	for _, kernelReadonly := range []bool{false, true} {
		name := "reader role"
		if kernelReadonly {
			name = "readonly kernel"
		}
		t.Run(name, func(t *testing.T) {
			previousReadonly := util.ReadOnly
			util.ReadOnly = kernelReadonly
			t.Cleanup(func() { util.ReadOnly = previousReadonly })
			engine := gin.New()
			engine.Use(func(c *gin.Context) {
				role := model.RoleReader
				if kernelReadonly {
					role = model.RoleAdministrator
				}
				c.Set(model.RoleContextKey, role)
			})
			engine.POST("/api/storage/updateRecentDocOpenTime", updateRecentDocOpenTime)
			engine.POST("/api/storage/updateRecentDocViewTime", updateRecentDocViewTime)
			engine.POST("/api/storage/updateRecentDocCloseTime", updateRecentDocCloseTime)
			engine.POST("/api/storage/batchUpdateRecentDocCloseTime", batchUpdateRecentDocCloseTime)
			for _, path := range []string{"/api/storage/updateRecentDocOpenTime", "/api/storage/updateRecentDocViewTime", "/api/storage/updateRecentDocCloseTime", "/api/storage/batchUpdateRecentDocCloseTime"} {
				for _, body := range []string{"", "{", "null", `{"rootID":42,"rootIDs":42}`} {
					recorder := httptest.NewRecorder()
					engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(body)))
					requireAPIContract(t, "POST", path, recorder)
					if recorder.Code != 200 || !strings.Contains(recorder.Body.String(), `"code":0`) {
						t.Fatalf("readonly mutation should ignore body: %s %s: %s", path, body, recorder.Body.String())
					}
				}
			}
		})
	}
}
