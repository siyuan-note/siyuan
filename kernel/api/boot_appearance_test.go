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

func TestBootAppearanceAPI(t *testing.T) {
	gin.SetMode(gin.TestMode)
	originalDataDir, originalConfDir := util.DataDir, util.ConfDir
	originalSafeMode, originalReadOnly, originalConf := util.SafeMode, util.ReadOnly, model.Conf
	root := t.TempDir()
	util.DataDir = filepath.Join(root, "data")
	util.ConfDir = filepath.Join(root, "conf")
	util.SafeMode, util.ReadOnly = false, false
	model.Conf = model.NewAppConf()
	t.Cleanup(func() {
		util.DataDir, util.ConfDir = originalDataDir, originalConfDir
		util.SafeMode, util.ReadOnly, model.Conf = originalSafeMode, originalReadOnly, originalConf
	})

	appearanceDir := filepath.Join(util.DataDir, "plugins", "provider", "boot-appearances", "sample")
	if err := os.MkdirAll(appearanceDir, 0755); err != nil {
		t.Fatal(err)
	}
	for filePath, content := range map[string]string{
		filepath.Join(util.DataDir, "plugins", "provider", "plugin.json"): `{"name":"provider","version":"1.0.0",` +
			`"bootAppearances":["sample"]}`,
		filepath.Join(appearanceDir, "boot.json"): `{"schemaVersion":1,"id":"sample",` +
			`"displayName":{"default":"Sample"},"backgroundColor":"#123456"}`,
	} {
		if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := model.SetBootAppearance("provider", "sample"); err != nil {
		t.Fatal(err)
	}

	engine := gin.New()
	ServeAPI(engine)
	request := func(method, requestPath, remoteAddr string, body []byte) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(method, requestPath, bytes.NewReader(body))
		req.RemoteAddr = remoteAddr
		req.Host = "127.0.0.1:6806"
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		engine.ServeHTTP(recorder, req)
		return recorder
	}

	recorder := request(http.MethodGet, "/api/system/getBootAppearance", "127.0.0.1:12345", nil)
	if recorder.Code != http.StatusOK || recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("unexpected current appearance response: status=%d headers=%v", recorder.Code, recorder.Header())
	}
	var current struct {
		Code int `json:"code"`
		Data struct {
			Enabled     bool   `json:"enabled"`
			Provider    string `json:"provider"`
			Appearance  string `json:"appearance"`
			DisplayName string `json:"displayName"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &current); err != nil {
		t.Fatal(err)
	}
	if current.Code != 0 || !current.Data.Enabled || current.Data.Provider != "provider" ||
		current.Data.Appearance != "sample" || current.Data.DisplayName != "Sample" {
		t.Fatalf("unexpected current appearance payload: %+v", current)
	}
	if recorder := request(http.MethodGet, "/api/system/getBootAppearance", "192.0.2.1:12345", nil); recorder.Code != http.StatusForbidden {
		t.Fatalf("remote startup request should be forbidden, got %d", recorder.Code)
	}

	recorder = request(http.MethodPost, "/api/setting/getBootAppearances", "127.0.0.1:12345", []byte(`{}`))
	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected appearance list status: %d", recorder.Code)
	}
	var list struct {
		Code int `json:"code"`
		Data struct {
			Appearances []json.RawMessage `json:"appearances"`
			Current     map[string]string `json:"current"`
		} `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if list.Code != 0 || len(list.Data.Appearances) != 1 || list.Data.Current["provider"] != "provider" ||
		list.Data.Current["appearance"] != "sample" {
		t.Fatalf("unexpected appearance list payload: %+v", list)
	}
	util.SafeMode = true
	recorder = request(http.MethodPost, "/api/setting/getBootAppearances", "127.0.0.1:12345", []byte(`{}`))
	if err := json.Unmarshal(recorder.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if list.Data.Current["provider"] != "" || list.Data.Current["appearance"] != "" {
		t.Fatalf("safe mode should report the default selection: %+v", list.Data.Current)
	}
	recorder = request(http.MethodGet, "/api/system/getBootAppearance", "127.0.0.1:12345", nil)
	if err := json.Unmarshal(recorder.Body.Bytes(), &current); err != nil {
		t.Fatal(err)
	}
	if current.Data.Enabled {
		t.Fatalf("safe mode should disable the custom boot appearance: %+v", current.Data)
	}
	util.SafeMode = false

	recorder = request(http.MethodPost, "/api/setting/setBootAppearance", "127.0.0.1:12345",
		[]byte(`{"provider":"","appearance":""}`))
	if recorder.Code != http.StatusOK || model.GetBootAppearance().Enabled {
		t.Fatalf("failed to restore the default appearance: status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}
