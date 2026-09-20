package server

import (
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

func TestPluginPublishStaticBoundaries(t *testing.T) {
	oldData, oldConf := util.DataDir, model.Conf
	util.DataDir = t.TempDir()
	model.Conf = model.NewAppConf()
	model.Conf.Sync = conf.NewSync()
	model.Conf.Bazaar = &conf.Bazaar{Trust: true}
	t.Cleanup(func() { util.DataDir, model.Conf = oldData, oldConf })
	for name, data := range map[string]string{
		"plugins/example/plugin.json": `{"name":"example","version":"1.0.0","minAppVersion":"0.0.1","publish":{"resources":["index.html","logo.txt"]}}`,
		"plugins/example/index.js":    "entry", "plugins/example/index.html": "page", "plugins/example/logo.txt": "logo", "plugins/example/kernel.js": "secret",
		"public/file.txt": "public", "storage/petal/example/private.json": "token",
	} {
		path := filepath.Join(util.DataDir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(data), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := model.SetPetalEnabled("example", true); err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleReader); c.Next() })
	servePlugins(engine)
	servePublic(engine)
	request := func(method, path string) *httptest.ResponseRecorder {
		r := httptest.NewRecorder()
		engine.ServeHTTP(r, httptest.NewRequest(method, path, nil))
		return r
	}
	for path, want := range map[string]string{"/plugins/example/index.js": "entry", "/plugins/example/": "page", "/plugins/example/logo.txt": "logo", "/public/file.txt": "public"} {
		if r := request("GET", path); r.Code != 200 || r.Body.String() != want {
			t.Fatalf("%s: %d %s", path, r.Code, r.Body)
		}
		if r := request("HEAD", path); r.Code != 200 || r.Body.Len() != 0 {
			t.Fatalf("HEAD %s: %d %s", path, r.Code, r.Body)
		}
	}
	for _, path := range []string{"/plugins/example/kernel.js", "/plugins/example/plugin.json", "/plugins/example/../example/kernel.js", "/plugins/example/%2e%2e/example/kernel.js", "/plugins/example/%252e%252e/example/kernel.js", "/plugins/example/logo.txt:stream"} {
		if r := request("GET", path); r.Code != http.StatusForbidden {
			t.Fatalf("denied %s: %d %s", path, r.Code, r.Body)
		}
	}
	if err := os.Symlink(filepath.Join(util.DataDir, "storage", "petal", "example", "private.json"), filepath.Join(util.DataDir, "public", "link.txt")); err == nil {
		if r := request("GET", "/public/link.txt"); r.Code != 404 {
			t.Fatalf("public link: %d %s", r.Code, r.Body)
		}
	} else {
		t.Logf("symlinks unavailable: %v", err)
	}
	if _, err := model.SetPetalPublishEnabled("example", false); err != nil {
		t.Fatal(err)
	}
	for _, method := range []string{"GET", "HEAD"} {
		if r := request(method, "/plugins/example/logo.txt"); r.Code != 403 || r.Header().Get("Cache-Control") != "private, no-store" {
			t.Fatalf("disabled static resource: %d", r.Code)
		}
	}
}
