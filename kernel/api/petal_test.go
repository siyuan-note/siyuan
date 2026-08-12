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
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSetPetalPublishEnabledAuthorization(t *testing.T) {
	gin.SetMode(gin.TestMode)
	originalConf := model.Conf
	originalDataDir := util.DataDir
	model.Conf = model.NewAppConf()
	model.Conf.Bazaar = &conf.Bazaar{Trust: true}
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		model.Conf = originalConf
		util.DataDir = originalDataDir
	})

	pluginDir := filepath.Join(util.DataDir, "plugins", "example")
	if err := os.MkdirAll(pluginDir, 0755); err != nil {
		t.Fatal(err)
	}
	manifest := []byte(`{"name":"example","version":"1.0.0","minAppVersion":"0.0.1"}`)
	for fileName, content := range map[string][]byte{
		"plugin.json": manifest,
		"index.js":    []byte("example"),
	} {
		if err := os.WriteFile(filepath.Join(pluginDir, fileName), content, 0644); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := model.SetPetalEnabled("example", true); err != nil {
		t.Fatal(err)
	}

	body, err := json.Marshal(map[string]any{"packageName": "example", "enabled": false})
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name       string
		role       model.Role
		statusCode int
	}{
		{name: "administrator", role: model.RoleAdministrator, statusCode: http.StatusOK},
		{name: "editor", role: model.RoleEditor, statusCode: http.StatusForbidden},
		{name: "reader", role: model.RoleReader, statusCode: http.StatusForbidden},
	} {
		t.Run(test.name, func(t *testing.T) {
			engine := gin.New()
			engine.Use(func(c *gin.Context) {
				c.Set(model.RoleContextKey, test.role)
				c.Next()
			})
			ServeAPI(engine)

			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/api/petal/setPetalPublishEnabled", bytes.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)
			if recorder.Code != test.statusCode {
				t.Fatalf("unexpected status code: got %d, want %d", recorder.Code, test.statusCode)
			}
		})
	}

	if petal := model.GetPetalByName("example"); petal == nil || !petal.UserDisabledInPublish {
		t.Fatal("administrator publish preference was not persisted")
	}
}
