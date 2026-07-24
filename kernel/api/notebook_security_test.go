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
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestGetNotebookConfHidesBoxCryptFromReader(t *testing.T) {
	gin.SetMode(gin.TestMode)

	oldConf, oldDataDir := model.Conf, util.DataDir
	util.DataDir = t.TempDir()
	model.Conf = model.NewAppConf()
	model.Conf.FileTree = conf.NewFileTree()
	t.Cleanup(func() {
		model.Conf, util.DataDir = oldConf, oldDataDir
	})

	const boxID = "20260724000000-abcdefg"
	boxConf := conf.NewBoxConf()
	boxConf.Name = "Encrypted notebook"
	boxConf.Encrypted = true
	boxConf.BoxCrypt = &conf.BoxEncryption{
		Spec:       1,
		WrappedDEK: []byte("wrapped-dek"),
		WrapNonce:  []byte("wrap-nonce"),
		CreatedAt:  123,
	}
	boxConfPath := filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json")
	if err := os.MkdirAll(filepath.Dir(boxConfPath), 0755); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(boxConf)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(boxConfPath, data, 0644); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name           string
		role           model.Role
		expectBoxCrypt bool
	}{
		{name: "reader", role: model.RoleReader, expectBoxCrypt: false},
		{name: "administrator", role: model.RoleAdministrator, expectBoxCrypt: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			engine := gin.New()
			engine.Use(func(c *gin.Context) {
				c.Set(model.RoleContextKey, test.role)
				c.Next()
			})
			engine.POST("/api/notebook/getNotebookConf", getNotebookConf)

			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(
				http.MethodPost,
				"/api/notebook/getNotebookConf",
				strings.NewReader(`{"notebook":"`+boxID+`"}`),
			)
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)

			response := &struct {
				Code int `json:"code"`
				Data struct {
					Conf *conf.BoxConf `json:"conf"`
				} `json:"data"`
			}{}
			if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
				t.Fatalf("unmarshal response failed: %v", err)
			}
			if 0 != response.Code || nil == response.Data.Conf {
				t.Fatalf("unexpected response: %s", recorder.Body.String())
			}
			if response.Data.Conf.Encrypted != boxConf.Encrypted ||
				response.Data.Conf.Name != boxConf.Name ||
				response.Data.Conf.SortMode != boxConf.SortMode {
				t.Fatalf("functional notebook settings were changed: %#v", response.Data.Conf)
			}
			if test.expectBoxCrypt != (nil != response.Data.Conf.BoxCrypt) {
				t.Fatalf("unexpected box crypt visibility: %#v", response.Data.Conf.BoxCrypt)
			}
		})
	}
}

func TestGetEncryptedNotebookStatusAuthorization(t *testing.T) {
	gin.SetMode(gin.TestMode)

	oldConf, oldDataDir, oldHistoryDir := model.Conf, util.DataDir, util.HistoryDir
	tempDir := t.TempDir()
	util.DataDir = filepath.Join(tempDir, "data")
	util.HistoryDir = filepath.Join(tempDir, "history")
	if err := os.MkdirAll(util.DataDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(util.HistoryDir, 0755); err != nil {
		t.Fatal(err)
	}
	model.Conf = model.NewAppConf()
	model.Conf.FileTree = conf.NewFileTree()
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()
	t.Cleanup(func() {
		model.Conf, util.DataDir, util.HistoryDir = oldConf, oldDataDir, oldHistoryDir
	})

	tests := []struct {
		name       string
		role       model.Role
		statusCode int
	}{
		{name: "reader", role: model.RoleReader, statusCode: http.StatusForbidden},
		{name: "editor", role: model.RoleEditor, statusCode: http.StatusForbidden},
		{name: "administrator", role: model.RoleAdministrator, statusCode: http.StatusOK},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			engine := gin.New()
			engine.Use(func(c *gin.Context) {
				c.Set(model.RoleContextKey, test.role)
				c.Next()
			})
			ServeAPI(engine)

			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/api/notebook/getEncryptedNotebookStatus", strings.NewReader(`{}`))
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)

			if recorder.Code != test.statusCode {
				t.Fatalf("%s request returned status %d: %s", test.name, recorder.Code, recorder.Body.String())
			}
			if test.role == model.RoleAdministrator {
				response := &struct {
					Code int `json:"code"`
				}{}
				if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
					t.Fatalf("unmarshal response failed: %v", err)
				}
				if response.Code != 0 {
					t.Fatalf("administrator request returned code %d: %s", response.Code, recorder.Body.String())
				}
			}
		})
	}
}
