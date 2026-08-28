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
	"bytes"
	"compress/gzip"
	"io"
	"math/rand"
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

func TestCleanStaticRelativePath(t *testing.T) {
	if relativePath, ok := cleanStaticRelativePath("/package/index.js"); !ok ||
		filepath.ToSlash(relativePath) != "package/index.js" {
		t.Fatalf("unexpected clean path [%s], ok=%v", relativePath, ok)
	}
	for _, requestPath := range []string{"/../secret", "../secret", "/package/../../secret"} {
		if _, ok := cleanStaticRelativePath(requestPath); ok {
			t.Fatalf("path traversal should be rejected [%s]", requestPath)
		}
	}
}

func TestRegisterStaticFileHandlers(t *testing.T) {
	gin.SetMode(gin.TestMode)
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "package"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "package", "index.html"), []byte("content"), 0644); err != nil {
		t.Fatal(err)
	}

	engine := gin.New()
	group := engine.Group("/files/")
	registerStaticFileHandlers(group, root, true, func(_ *gin.Context, relativePath string) bool {
		return filepath.ToSlash(relativePath) == "package"
	})

	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/files/package/", nil))
	if recorder.Code != http.StatusOK || recorder.Body.String() != "content" {
		t.Fatalf("unexpected allowed response: status=%d body=%q", recorder.Code, recorder.Body.String())
	}

	recorder = httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/files/package/index.html", nil))
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("access callback should deny the request, got %d", recorder.Code)
	}
}

func TestGzipMiddlewareServesPrecompressedStaticFile(t *testing.T) {
	gin.SetMode(gin.TestMode)
	source := make([]byte, 128*1024)
	if _, err := rand.New(rand.NewSource(1)).Read(source); err != nil {
		t.Fatal(err)
	}

	var compressed bytes.Buffer
	writer := gzip.NewWriter(&compressed)
	if _, err := writer.Write(source); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if compressed.Len() <= 32*1024 {
		t.Fatalf("compressed test file is too small: %d", compressed.Len())
	}

	filePath := filepath.Join(t.TempDir(), "data.gz")
	if err := os.WriteFile(filePath, compressed.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}

	engine := gin.New()
	engine.Use(gzipMiddleware())
	for _, requestPath := range []string{"/data.gz", "/data.dump"} {
		engine.GET(requestPath, func(c *gin.Context) {
			http.ServeFile(c.Writer, c.Request, filePath)
		})
	}

	for _, requestPath := range []string{"/data.gz", "/data.dump"} {
		t.Run(requestPath, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, requestPath, nil)
			request.Header.Set("Accept-Encoding", "gzip")
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)
			if recorder.Code != http.StatusOK {
				t.Fatalf("unexpected status: %d", recorder.Code)
			}

			body := recorder.Body.Bytes()
			if recorder.Header().Get("Content-Encoding") == "gzip" {
				reader, err := gzip.NewReader(bytes.NewReader(body))
				if err != nil {
					t.Fatal(err)
				}
				body, err = io.ReadAll(reader)
				if err != nil {
					_ = reader.Close()
					t.Fatal(err)
				}
				if err = reader.Close(); err != nil {
					t.Fatal(err)
				}
			}
			if !bytes.Equal(body, compressed.Bytes()) {
				t.Fatalf("response differs from the static file: got %d bytes, want %d", len(body), compressed.Len())
			}
		})
	}
}

func TestStaticFileNestedSymlinkEscape(t *testing.T) {
	gin.SetMode(gin.TestMode)
	root, outside := t.TempDir(), t.TempDir()
	packagePath := filepath.Join(root, "package")
	if err := os.MkdirAll(packagePath, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "secret.txt"), []byte("secret"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(packagePath, "escape")); err != nil {
		t.Skipf("create directory symlink failed: %s", err)
	}

	engine := gin.New()
	group := engine.Group("/files/")
	registerStaticFileHandlers(group, root, true, func(_ *gin.Context, _ string) bool {
		return true
	})

	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/files/package/escape/secret.txt", nil))
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("nested symlink escape should be forbidden, got %d", recorder.Code)
	}
}

func TestWidgetResponseCacheControl(t *testing.T) {
	gin.SetMode(gin.TestMode)
	originalDataDir, originalConf := util.DataDir, model.Conf
	util.DataDir = t.TempDir()
	model.Conf = model.NewAppConf()
	t.Cleanup(func() {
		util.DataDir = originalDataDir
		model.Conf = originalConf
	})

	widgetDir := filepath.Join(util.DataDir, "widgets", "example")
	if err := os.MkdirAll(widgetDir, 0755); err != nil {
		t.Fatal(err)
	}
	for fileName, content := range map[string]string{
		"index.html": "html",
		"page.html":  "html",
		"page.htm":   "htm",
		"app.js":     "javascript",
	} {
		if err := os.WriteFile(filepath.Join(widgetDir, fileName), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}

	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(model.RoleContextKey, model.RoleAdministrator)
		c.Next()
	})
	serveWidgets(engine)

	for _, test := range []struct {
		method       string
		requestPath  string
		status       int
		body         string
		cacheControl string
	}{
		{http.MethodGet, "/widgets/example/", http.StatusOK, "html", "private, no-store"},
		{http.MethodGet, "/widgets/example/index.html", http.StatusMovedPermanently, "", "private, no-store"},
		{http.MethodGet, "/widgets/example/page.html", http.StatusOK, "html", "private, no-store"},
		{http.MethodGet, "/widgets/example/page.htm", http.StatusOK, "htm", "private, no-store"},
		{http.MethodGet, "/widgets/example/app.js", http.StatusOK, "javascript", "private"},
		{http.MethodHead, "/widgets/example/app.js", http.StatusOK, "", "private"},
	} {
		t.Run(test.method+" "+test.requestPath, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, httptest.NewRequest(test.method, test.requestPath, nil))
			if recorder.Code != test.status || recorder.Body.String() != test.body {
				t.Fatalf("unexpected widget response: status=%d body=%q", recorder.Code, recorder.Body.String())
			}
			if cacheControl := recorder.Header().Get("Cache-Control"); cacheControl != test.cacheControl {
				t.Fatalf("unexpected widget cache control [%s]", cacheControl)
			}
		})
	}
}

func TestLanguageResponseDisablesCache(t *testing.T) {
	gin.SetMode(gin.TestMode)
	originalAppearancePath, originalMode := util.AppearancePath, util.Mode
	util.AppearancePath, util.Mode = t.TempDir(), "prod"
	t.Cleanup(func() {
		util.AppearancePath, util.Mode = originalAppearancePath, originalMode
	})

	langDir := filepath.Join(util.AppearancePath, "langs")
	if err := os.MkdirAll(langDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(langDir, "zh-CN.json"), []byte(`{"label":"value"}`), 0644); err != nil {
		t.Fatal(err)
	}

	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(model.RoleContextKey, model.RoleAdministrator)
		c.Next()
	})
	serveAppearance(engine)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/appearance/langs/zh-CN.json?v=old", nil))
	if recorder.Code != http.StatusOK || strings.TrimSpace(recorder.Body.String()) != `{"label":"value"}` {
		t.Fatalf("unexpected language response: status=%d body=%q", recorder.Code, recorder.Body.String())
	}
	if cacheControl := recorder.Header().Get("Cache-Control"); cacheControl != "private, no-store" {
		t.Fatalf("unexpected language cache control [%s]", cacheControl)
	}
}

func TestThemeResponseDisablesCache(t *testing.T) {
	gin.SetMode(gin.TestMode)
	originalAppearancePath, originalMode := util.AppearancePath, util.Mode
	util.AppearancePath, util.Mode = t.TempDir(), "prod"
	t.Cleanup(func() {
		util.AppearancePath, util.Mode = originalAppearancePath, originalMode
	})

	themeDir := filepath.Join(util.AppearancePath, "themes", "example", "style", "module")
	if err := os.MkdirAll(themeDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(themeDir, "color.css"), []byte("body {}"), 0644); err != nil {
		t.Fatal(err)
	}

	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(model.RoleContextKey, model.RoleAdministrator)
		c.Next()
	})
	serveAppearance(engine)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet,
		"/appearance/themes/example/style/module/color.css", nil))
	if recorder.Code != http.StatusOK || strings.TrimSpace(recorder.Body.String()) != "body {}" {
		t.Fatalf("unexpected theme response: status=%d body=%q", recorder.Code, recorder.Body.String())
	}
	if cacheControl := recorder.Header().Get("Cache-Control"); cacheControl != "private, no-store" {
		t.Fatalf("unexpected theme cache control [%s]", cacheControl)
	}
}

func TestTemplatesAndExportRequireAdministrator(t *testing.T) {
	gin.SetMode(gin.TestMode)
	originalDataDir, originalTempDir := util.DataDir, util.TempDir
	util.DataDir, util.TempDir = t.TempDir(), t.TempDir()
	t.Cleanup(func() {
		util.DataDir, util.TempDir = originalDataDir, originalTempDir
	})

	templatePath := filepath.Join(util.DataDir, "templates", "private.md")
	exportPath := filepath.Join(util.TempDir, "export", "private.txt")
	for path, content := range map[string]string{templatePath: "template", exportPath: "export"} {
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}

	request := func(role model.Role, register func(*gin.Engine), requestPath string) *httptest.ResponseRecorder {
		engine := gin.New()
		engine.Use(func(c *gin.Context) {
			c.Set(model.RoleContextKey, role)
			c.Next()
		})
		register(engine)
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, requestPath, nil))
		return recorder
	}
	for _, test := range []struct {
		register    func(*gin.Engine)
		requestPath string
		content     string
	}{
		{serveTemplates, "/templates/private.md", "template"},
		{serveExport, "/export/private.txt", "export"},
	} {
		if recorder := request(model.RoleReader, test.register, test.requestPath); recorder.Code != http.StatusForbidden {
			t.Fatalf("reader request [%s] should be forbidden, got %d", test.requestPath, recorder.Code)
		}
		recorder := request(model.RoleAdministrator, test.register, test.requestPath)
		if recorder.Code != http.StatusOK || recorder.Body.String() != test.content {
			t.Fatalf("unexpected administrator response [%s]: status=%d body=%q",
				test.requestPath, recorder.Code, recorder.Body.String())
		}
	}
}

func TestSnippetPublishAccess(t *testing.T) {
	gin.SetMode(gin.TestMode)
	originalSnippetsPath := util.SnippetsPath
	util.SnippetsPath = t.TempDir()
	t.Cleanup(func() {
		util.SnippetsPath = originalSnippetsPath
	})

	if err := model.SetSnippet([]*conf.Snippet{
		{Name: "allowed", Type: "css", Content: "allowed"},
		{Name: "disabled", Type: "js", Content: "disabled", DisabledInPublish: true},
	}); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(util.SnippetsPath, "fallback.css"), []byte("fallback"), 0644); err != nil {
		t.Fatal(err)
	}

	request := func(role model.Role, requestPath string) *httptest.ResponseRecorder {
		engine := gin.New()
		engine.Use(func(c *gin.Context) {
			c.Set(model.RoleContextKey, role)
			c.Next()
		})
		serveSnippets(engine)
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, requestPath, nil))
		return recorder
	}
	if recorder := request(model.RoleReader, "/snippets/allowed.css"); recorder.Code != http.StatusOK ||
		strings.TrimSpace(recorder.Body.String()) != "allowed" {
		t.Fatalf("unexpected publish-enabled snippet response: status=%d body=%q", recorder.Code, recorder.Body.String())
	}
	if recorder := request(model.RoleReader, "/snippets/disabled.js"); recorder.Code != http.StatusForbidden {
		t.Fatalf("publish-disabled snippet should be forbidden, got %d", recorder.Code)
	}
	if recorder := request(model.RoleReader, "/snippets/fallback.css"); recorder.Code != http.StatusNotFound {
		t.Fatalf("filesystem fallback should be hidden from readers, got %d", recorder.Code)
	}
	if recorder := request(model.RoleAdministrator, "/snippets/fallback.css"); recorder.Code != http.StatusOK ||
		recorder.Body.String() != "fallback" {
		t.Fatalf("unexpected administrator fallback response: status=%d body=%q", recorder.Code, recorder.Body.String())
	}
}

func TestPluginPublishAccess(t *testing.T) {
	gin.SetMode(gin.TestMode)
	originalDataDir := util.DataDir
	originalConf := model.Conf
	util.DataDir = t.TempDir()
	model.Conf = model.NewAppConf()
	model.Conf.Bazaar = &conf.Bazaar{Trust: true}
	t.Cleanup(func() {
		util.DataDir = originalDataDir
		model.Conf = originalConf
	})

	writePlugin := func(name string) {
		pluginDir := filepath.Join(util.DataDir, "plugins", name)
		if err := os.MkdirAll(pluginDir, 0755); err != nil {
			t.Fatal(err)
		}
		manifest := []byte(`{"name":"` + name + `","version":"1.0.0","minAppVersion":"0.0.1"}`)
		for fileName, content := range map[string][]byte{
			"plugin.json": manifest,
			"index.js":    []byte(name),
		} {
			if err := os.WriteFile(filepath.Join(pluginDir, fileName), content, 0644); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := model.SetPetalEnabled(name, true); err != nil {
			t.Fatal(err)
		}
	}
	writePlugin("allowed")
	writePlugin("user-disabled")
	if _, err := model.SetPetalPublishEnabled("user-disabled", false); err != nil {
		t.Fatal(err)
	}

	request := func(role model.Role, requestPath string) *httptest.ResponseRecorder {
		engine := gin.New()
		engine.Use(func(c *gin.Context) {
			c.Set(model.RoleContextKey, role)
			c.Next()
		})
		servePlugins(engine)
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, requestPath, nil))
		return recorder
	}
	if recorder := request(model.RoleReader, "/plugins/allowed/index.js"); recorder.Code != http.StatusOK ||
		recorder.Body.String() != "allowed" {
		t.Fatalf("unexpected publish-enabled plugin response: status=%d body=%q", recorder.Code, recorder.Body.String())
	}
	if recorder := request(model.RoleReader, "/plugins/user-disabled/index.js"); recorder.Code != http.StatusForbidden {
		t.Fatalf("user-disabled plugin should be forbidden in publish, got %d", recorder.Code)
	}
	if recorder := request(model.RoleAdministrator, "/plugins/user-disabled/index.js"); recorder.Code != http.StatusOK ||
		recorder.Body.String() != "user-disabled" {
		t.Fatalf("unexpected administrator plugin response: status=%d body=%q", recorder.Code, recorder.Body.String())
	}
}
