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

func TestWidgetResponseDisablesCache(t *testing.T) {
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
	if err := os.WriteFile(filepath.Join(widgetDir, "index.html"), []byte("content"), 0644); err != nil {
		t.Fatal(err)
	}

	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(model.RoleContextKey, model.RoleAdministrator)
		c.Next()
	})
	serveWidgets(engine)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/widgets/example/", nil))
	if recorder.Code != http.StatusOK || recorder.Body.String() != "content" {
		t.Fatalf("unexpected widget response: status=%d body=%q", recorder.Code, recorder.Body.String())
	}
	if cacheControl := recorder.Header().Get("Cache-Control"); cacheControl != "private, no-store" {
		t.Fatalf("unexpected widget cache control [%s]", cacheControl)
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
