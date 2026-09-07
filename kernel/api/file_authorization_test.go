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
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestGetUniqueFilenameAuthorization(t *testing.T) {
	gin.SetMode(gin.TestMode)

	filePath := filepath.Join(t.TempDir(), "export.pdf")
	body, err := json.Marshal(map[string]string{"path": filePath})
	if err != nil {
		t.Fatal(err)
	}

	roles := []struct {
		name       string
		role       model.Role
		statusCode int
	}{
		{name: "administrator", role: model.RoleAdministrator, statusCode: http.StatusOK},
		{name: "editor", role: model.RoleEditor, statusCode: http.StatusForbidden},
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
			request := httptest.NewRequest(http.MethodPost, "/api/file/getUniqueFilename", bytes.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)

			if recorder.Code != role.statusCode {
				t.Fatalf("unexpected status code: got %d, want %d", recorder.Code, role.statusCode)
			}
			if role.role != model.RoleAdministrator {
				return
			}

			response := &struct {
				Data struct {
					Path string `json:"path"`
				} `json:"data"`
			}{}
			if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
				t.Fatal(err)
			}
			if response.Data.Path != filePath {
				t.Fatalf("unexpected path: got %q, want %q", response.Data.Path, filePath)
			}
		})
	}
}

func TestGetUniqueFilenameRejectsEncryptedNotebook(t *testing.T) {
	root, boxID := setupArchiveWorkspace(t)
	oldConf := model.Conf
	model.Conf = model.NewAppConf()
	t.Cleanup(func() { model.Conf = oldConf })
	for _, name := range []string{"existing.sy", "missing.sy"} {
		filePath := filepath.Join(util.DataDir, boxID, name)
		if name == "existing.sy" {
			if err := os.WriteFile(filePath, []byte("ciphertext"), 0600); err != nil {
				t.Fatal(err)
			}
		}
		body, err := json.Marshal(map[string]string{"path": filePath})
		if err != nil {
			t.Fatal(err)
		}
		result := callArchiveAPI(t, getUniqueFilename, string(body))
		if result.Code != -3 || result.Data != nil {
			t.Fatalf("encrypted filename existence was exposed: %+v", result)
		}
	}
	filePath := filepath.Join(root, "normal.txt")
	if err := os.WriteFile(filePath, []byte("normal"), 0600); err != nil {
		t.Fatal(err)
	}
	body, err := json.Marshal(map[string]string{"path": filePath})
	if err != nil {
		t.Fatal(err)
	}
	result := callArchiveAPI(t, getUniqueFilename, string(body))
	if result.Code != 0 || result.Data.(map[string]any)["path"] != filepath.Join(root, "normal (1).txt") {
		t.Fatalf("normal filename allocation failed: %+v", result)
	}
}
