package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestPluginDevelopmentStaticPrivateState(t *testing.T) {
	origWorkspace, origData, origConf, origTemp := util.WorkspaceDir, util.DataDir, util.ConfDir, util.TempDir
	util.WorkspaceDir = t.TempDir()
	util.DataDir = filepath.Join(util.WorkspaceDir, "data")
	util.ConfDir = filepath.Join(util.WorkspaceDir, "conf")
	util.TempDir = filepath.Join(util.WorkspaceDir, "temp")
	t.Cleanup(func() {
		util.WorkspaceDir, util.DataDir, util.ConfDir, util.TempDir = origWorkspace, origData, origConf, origTemp
	})
	for _, name := range []string{"data/storage/ai/agent/sessions/task/runtime.json", "data/storage/ai/agent/sessions/task/runtime.jsonabcdefg.tmp", "data/plugins/.siyuan-package-install-abc/staging/index.js", "temp/export/plugin-project-task-hash.zip"} {
		p := filepath.Join(util.WorkspaceDir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(p), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("fixture"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	engine := gin.New()
	registerStaticFileHandlers(engine.Group("/files"), util.WorkspaceDir, false, nil)
	for _, test := range []struct {
		path   string
		status int
	}{
		{"data/storage/ai/agent/sessions/task/runtime.json", http.StatusForbidden},
		{"data/storage/ai/agent/sessions/task/runtime.jsonabcdefg.tmp", http.StatusForbidden},
		{"data/plugins/.siyuan-package-install-abc/staging/index.js", http.StatusForbidden},
		{"temp/export/plugin-project-task-hash.zip", http.StatusOK},
	} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("GET", "/files/"+test.path, nil))
		if recorder.Code != test.status {
			t.Errorf("%s status=%d want=%d", test.path, recorder.Code, test.status)
		}
	}
}
