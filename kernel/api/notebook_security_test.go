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
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestNotebookPublishVisibility(t *testing.T) {
	const boxID = "20260726000000-abcdefg"
	tests := []struct {
		name          string
		notebook      *model.Box
		publishAccess model.PublishAccess
		expected      bool
	}{
		{name: "missing notebook", expected: false},
		{name: "closed notebook", notebook: &model.Box{ID: boxID, Closed: true}, expected: false},
		{
			name:          "encrypted notebook",
			notebook:      &model.Box{ID: boxID, Encrypted: true},
			publishAccess: model.PublishAccess{{ID: boxID, Visible: true}},
			expected:      false,
		},
		{name: "default visible", notebook: &model.Box{ID: boxID}, expected: true},
		{
			name:          "explicitly visible",
			notebook:      &model.Box{ID: boxID},
			publishAccess: model.PublishAccess{{ID: boxID, Visible: true}},
			expected:      true,
		},
		{
			name:          "invisible",
			notebook:      &model.Box{ID: boxID},
			publishAccess: model.PublishAccess{{ID: boxID, Visible: false}},
			expected:      false,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if actual := isNotebookVisibleByPublishAccess(test.notebook, test.publishAccess); actual != test.expected {
				t.Fatalf("unexpected notebook visibility: %v", actual)
			}
		})
	}
}

func TestGetNotebookInfoHidesInvisibleNotebookFromReader(t *testing.T) {
	gin.SetMode(gin.TestMode)

	oldConf, oldDataDir := model.Conf, util.DataDir
	util.DataDir = t.TempDir()
	model.Conf = model.NewAppConf()
	model.Conf.FileTree = conf.NewFileTree()
	const testLang = "notebook-security-test"
	oldTimeLang, hadTimeLang := util.TimeLangs[testLang]
	util.TimeLangs[testLang] = map[string]any{
		"albl": "ago",
		"blbl": "from now",
		"now":  "now",
		"1s":   "1 second %s",
		"xs":   "%d seconds %s",
		"1m":   "1 minute %s",
		"xm":   "%d minutes %s",
		"xh":   "%d hours %s",
		"1h":   "1 hour %s",
		"1d":   "1 day %s",
		"xd":   "%d days %s",
		"1w":   "1 week %s",
		"xw":   "%d weeks %s",
		"1M":   "1 month %s",
		"xM":   "%d months %s",
		"1y":   "1 year %s",
		"2y":   "2 years %s",
		"xy":   "%d years %s",
		"max":  "a long while %s",
	}
	model.Conf.Lang = testLang
	t.Cleanup(func() {
		if err := model.SetPublishAccess(model.PublishAccess{}); err != nil {
			t.Errorf("reset publish access failed: %v", err)
		}
		if hadTimeLang {
			util.TimeLangs[testLang] = oldTimeLang
		} else {
			delete(util.TimeLangs, testLang)
		}
		model.Conf, util.DataDir = oldConf, oldDataDir
	})

	const boxID = "20260726000000-abcdefg"
	boxConf := conf.NewBoxConf()
	boxConf.Name = "Invisible notebook"
	boxConf.Closed = false
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
	if err = model.SetPublishAccess(model.PublishAccess{{ID: boxID, Visible: false}}); err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name         string
		role         model.Role
		expectedCode int
		expectInfo   bool
	}{
		{name: "reader", role: model.RoleReader, expectedCode: -1},
		{name: "visitor", role: model.RoleVisitor, expectedCode: -1},
		{name: "administrator", role: model.RoleAdministrator, expectedCode: 0, expectInfo: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			engine := gin.New()
			engine.Use(func(c *gin.Context) {
				c.Set(model.RoleContextKey, test.role)
				c.Next()
			})
			engine.POST("/api/notebook/getNotebookInfo", getNotebookInfo)

			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(
				http.MethodPost,
				"/api/notebook/getNotebookInfo",
				strings.NewReader(`{"notebook":"`+boxID+`"}`),
			)
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)

			response := &struct {
				Code int    `json:"code"`
				Msg  string `json:"msg"`
				Data struct {
					BoxInfo *model.BoxInfo `json:"boxInfo"`
				} `json:"data"`
			}{}
			if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
				t.Fatalf("unmarshal response failed: %v", err)
			}
			if response.Code != test.expectedCode {
				t.Fatalf("unexpected response: %s", recorder.Body.String())
			}
			if test.expectInfo {
				if nil == response.Data.BoxInfo || boxConf.Name != response.Data.BoxInfo.Name {
					t.Fatalf("administrator did not receive notebook info: %s", recorder.Body.String())
				}
			} else {
				expectedMsg := "notebook [" + boxID + "] not found"
				if response.Msg != expectedMsg || nil != response.Data.BoxInfo {
					t.Fatalf("reader received invisible notebook info: %s", recorder.Body.String())
				}
			}
		})
	}
}

func TestGetNotebookConfHidesEncryptedNotebookFromReader(t *testing.T) {
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
		name       string
		role       model.Role
		expectCode int
	}{
		{name: "reader", role: model.RoleReader, expectCode: -1},
		{name: "administrator", role: model.RoleAdministrator, expectCode: 0},
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
			if test.expectCode != response.Code {
				t.Fatalf("unexpected response code: %s", recorder.Body.String())
			}
			if model.RoleReader == test.role {
				if nil != response.Data.Conf {
					t.Fatalf("reader received encrypted notebook configuration: %s", recorder.Body.String())
				}
				return
			}
			if nil == response.Data.Conf {
				t.Fatalf("administrator did not receive notebook configuration: %s", recorder.Body.String())
			}
			if response.Data.Conf.Encrypted != boxConf.Encrypted ||
				response.Data.Conf.Name != boxConf.Name ||
				response.Data.Conf.SortMode != boxConf.SortMode {
				t.Fatalf("functional notebook settings were changed: %#v", response.Data.Conf)
			}
			if nil == response.Data.Conf.BoxCrypt {
				t.Fatal("administrator did not receive encrypted notebook key metadata")
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
