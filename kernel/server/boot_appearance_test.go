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

package server

import (
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestServeBootAppearanceAssets(t *testing.T) {
	gin.SetMode(gin.TestMode)
	originalDataDir, originalConfDir, originalSafeMode := util.DataDir, util.ConfDir, util.SafeMode
	root := t.TempDir()
	util.DataDir = filepath.Join(root, "data")
	util.ConfDir = filepath.Join(root, "conf")
	util.SafeMode = false
	t.Cleanup(func() {
		util.DataDir, util.ConfDir, util.SafeMode = originalDataDir, originalConfDir, originalSafeMode
	})

	appearanceDir := filepath.Join(util.DataDir, "plugins", "provider", "boot-appearances", "sample")
	assetsDir := filepath.Join(appearanceDir, "assets")
	if err := os.MkdirAll(assetsDir, 0755); err != nil {
		t.Fatal(err)
	}
	for filePath, content := range map[string]string{
		filepath.Join(util.DataDir, "plugins", "provider", "plugin.json"): `{"name":"provider","version":"1.0.0",` +
			`"bootAppearances":["sample"]}`,
		filepath.Join(appearanceDir, "boot.json"): `{"schemaVersion":1,"id":"sample",` +
			`"displayName":{"default":"Sample"},"layers":[{"id":"background","type":"image",` +
			`"src":"assets/background.png"}]}`,
		filepath.Join(assetsDir, "invalid.png"): "not an image",
		filepath.Join(assetsDir, "script.js"):   "alert(1)",
	} {
		if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	imageFile, err := os.Create(filepath.Join(assetsDir, "background.png"))
	if err != nil {
		t.Fatal(err)
	}
	if err = png.Encode(imageFile, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		_ = imageFile.Close()
		t.Fatal(err)
	}
	if err = imageFile.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err = model.SetBootAppearance("provider", "sample"); err != nil {
		t.Fatal(err)
	}

	engine := gin.New()
	serveBootAppearanceAssets(engine)
	request := func(method, remoteAddr, requestPath string, headers map[string]string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(method, requestPath, nil)
		req.RemoteAddr = remoteAddr
		for name, value := range headers {
			req.Header.Set(name, value)
		}
		engine.ServeHTTP(recorder, req)
		return recorder
	}

	assetPath := "/boot-appearance-assets/provider/sample/assets/background.png"
	recorder := request(http.MethodGet, "127.0.0.1:12345", assetPath, nil)
	if recorder.Code != http.StatusOK || recorder.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("unexpected local asset response: status=%d content-type=%q", recorder.Code,
			recorder.Header().Get("Content-Type"))
	}
	if recorder.Header().Get("Cache-Control") != "no-store" ||
		recorder.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("missing secure asset response headers: %v", recorder.Header())
	}
	if recorder := request(http.MethodHead, "127.0.0.1:12345", assetPath, nil); recorder.Code != http.StatusOK || recorder.Body.Len() != 0 {
		t.Fatalf("unexpected HEAD response: status=%d body-length=%d", recorder.Code, recorder.Body.Len())
	}
	if recorder := request(http.MethodGet, "127.0.0.1:12345", assetPath,
		map[string]string{"Range": "bytes=0-7"}); recorder.Code != http.StatusPartialContent || recorder.Body.Len() != 8 {
		t.Fatalf("unexpected range response: status=%d body-length=%d", recorder.Code, recorder.Body.Len())
	}
	if recorder := request(http.MethodGet, "192.0.2.1:12345", assetPath, nil); recorder.Code != http.StatusForbidden {
		t.Fatalf("remote asset request should be forbidden, got %d", recorder.Code)
	}
	if recorder := request(http.MethodGet, "127.0.0.1:12345",
		"/boot-appearance-assets/other/sample/assets/background.png", nil); recorder.Code != http.StatusForbidden {
		t.Fatalf("unselected provider should be forbidden, got %d", recorder.Code)
	}
	if recorder := request(http.MethodGet, "127.0.0.1:12345",
		"/boot-appearance-assets/provider/sample/assets/script.js", nil); recorder.Code != http.StatusForbidden {
		t.Fatalf("unsupported MIME should be forbidden, got %d", recorder.Code)
	}
	if recorder := request(http.MethodGet, "127.0.0.1:12345",
		"/boot-appearance-assets/provider/sample/assets/invalid.png", nil); recorder.Code != http.StatusForbidden {
		t.Fatalf("mismatched MIME should be forbidden, got %d", recorder.Code)
	}
	if recorder := request(http.MethodGet, "127.0.0.1:12345",
		"/boot-appearance-assets/provider/sample/boot.json", nil); recorder.Code != http.StatusForbidden {
		t.Fatalf("the private manifest should not be served as an asset, got %d", recorder.Code)
	}
	encodedTraversal := "/boot-appearance-assets/provider/sample/assets/%2e%2e/boot.json"
	if recorder := request(http.MethodGet, "127.0.0.1:12345", encodedTraversal, nil); recorder.Code == http.StatusOK {
		t.Fatal("encoded path traversal should not serve an asset")
	}
}
