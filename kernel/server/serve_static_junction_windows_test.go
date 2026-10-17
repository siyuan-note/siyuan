package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/internal/testutil"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestStaticFileJunctionWorkspace(t *testing.T) {
	for _, atWorkspace := range []bool{false, true} {
		t.Run(map[bool]string{false: "ancestor", true: "workspace"}[atWorkspace], func(t *testing.T) {
			alias, _ := testutil.JunctionWorkspace(t, testutil.PublicDataDir(t), atWorkspace)
			previousWorkspace, previousData := util.WorkspaceDir, util.DataDir
			util.WorkspaceDir, util.DataDir = alias, filepath.Join(alias, "data")
			t.Cleanup(func() { util.WorkspaceDir, util.DataDir = previousWorkspace, previousData })
			write := func(name string) {
				t.Helper()
				if err := os.MkdirAll(filepath.Dir(name), 0755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(name, []byte("resource"), 0644); err != nil {
					t.Fatal(err)
				}
			}
			gin.SetMode(gin.TestMode)
			engine := gin.New()
			for _, kind := range []string{"plugins", "widgets", "templates", "emojis", "snippets"} {
				root := filepath.Join(util.DataDir, kind)
				write(filepath.Join(root, "demo", "icon.png"))
				registerStaticFileHandlers(engine.Group("/"+kind), root, kind != "emojis" && kind != "snippets", nil)
			}
			outside := testutil.PublicDataDir(t)
			write(filepath.Join(outside, "icon.png"))
			write(filepath.Join(alias, "conf", "conf.json"))
			write(filepath.Join(alias, "temp", "private.txt"))
			write(filepath.Join(alias, "temp", "export", "doc.html"))
			plugins := filepath.Join(util.DataDir, "plugins")
			write(filepath.Join(plugins, "demo", "credentials.json"))
			testutil.Junction(t, filepath.Join(plugins, "linked"), outside)
			testutil.Junction(t, filepath.Join(plugins, "demo", "escape"), outside)
			testutil.Junction(t, filepath.Join(plugins, "private"), filepath.Join(alias, "conf"))
			registerStaticFileHandlers(engine.Group("/files"), alias, false, nil)
			for _, item := range []struct {
				path string
				code int
			}{
				{"/plugins/demo/icon.png?v=123", http.StatusOK},
				{"/widgets/demo/icon.png", http.StatusOK},
				{"/templates/demo/icon.png", http.StatusOK},
				{"/emojis/demo/icon.png", http.StatusOK},
				{"/snippets/demo/icon.png", http.StatusOK},
				{"/plugins/linked/icon.png", http.StatusOK},
				{"/plugins/demo/escape/icon.png", http.StatusForbidden},
				{"/plugins/private/conf.json", http.StatusForbidden},
				{"/files/conf/conf.json", http.StatusForbidden},
				{"/files/temp/private.txt", http.StatusForbidden},
				{"/files/temp/export/doc.html", http.StatusOK},
				{"/plugins/demo/credentials.json", http.StatusForbidden},
				{"/files/data/plugins/demo/icon.png", http.StatusOK},
				{"/plugins/demo/missing.png", http.StatusNotFound},
			} {
				for _, method := range []string{http.MethodGet, http.MethodHead} {
					recorder := httptest.NewRecorder()
					engine.ServeHTTP(recorder, httptest.NewRequest(method, item.path, nil))
					if recorder.Code != item.code {
						t.Errorf("%s %s = %d, want %d", method, item.path, recorder.Code, item.code)
					}
					if method == http.MethodGet && item.code == http.StatusOK && recorder.Body.String() != "resource" {
						t.Errorf("%s returned %q", item.path, recorder.Body.String())
					}
				}
			}
		})
	}
}
