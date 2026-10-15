package api

import (
	archivezip "archive/zip"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractPluginDevelopmentRawGuards(t *testing.T) {
	origWorkspace, origData, origConfDir, origConf := util.WorkspaceDir, util.DataDir, util.ConfDir, model.Conf
	util.WorkspaceDir = t.TempDir()
	util.DataDir, util.ConfDir = filepath.Join(util.WorkspaceDir, "data"), filepath.Join(util.WorkspaceDir, "conf")
	model.Conf = model.NewAppConf()
	t.Cleanup(func() {
		util.WorkspaceDir, util.DataDir, util.ConfDir, model.Conf = origWorkspace, origData, origConfDir, origConf
	})
	engine := gin.New()
	engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleAdministrator) })
	for route, handler := range map[string]gin.HandlerFunc{"getFile": getFile, "putFile": putFile, "readDir": readDir, "removeFile": removeFile, "renameFile": renameFile, "workspaceCopyFiles": workspaceCopyFiles, "globalCopyFiles": globalCopyFiles} {
		engine.POST("/api/file/"+route, handler)
	}
	protected := []string{
		"data/storage/ai/agent/plugin-projects/task/source/index.js",
		"conf/plugin-development/task/checkpoints/source.js",
		"data/storage/ai/agent/sessions/task/runtime.json",
		"data/storage/ai/agent/sessions/task/runtime.jsona1b2c3d.tmp",
		"data/plugins/.siyuan-package-install-abcdef/staging/index.js",
	}
	for _, path := range protected {
		abs := filepath.Join(util.WorkspaceDir, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(abs), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(abs, []byte("unchanged-private-state"), 0600); err != nil {
			t.Fatal(err)
		}
		for _, entry := range []struct{ route, body, media string }{
			{"getFile", `{"path":"` + path + `"}`, "application/json"},
			{"putFile", "path=" + path + "&isDir=true", "application/x-www-form-urlencoded"},
			{"removeFile", `{"path":"` + path + `"}`, "application/json"},
			{"renameFile", `{"path":"` + path + `","newPath":"temp/moved"}`, "application/json"},
			{"workspaceCopyFiles", `{"srcs":["` + path + `"],"destDir":"temp/copy"}`, "application/json"},
		} {
			t.Run(entry.route+"/"+path, func(t *testing.T) {
				recorder := httptest.NewRecorder()
				request := httptest.NewRequest("POST", "/api/file/"+entry.route, strings.NewReader(entry.body))
				request.Header.Set("Content-Type", entry.media)
				engine.ServeHTTP(recorder, request)
				var ret struct {
					Code int    `json:"code"`
					Msg  string `json:"msg"`
				}
				if err := json.Unmarshal(recorder.Body.Bytes(), &ret); err != nil || ret.Code == 0 ||
					(!strings.Contains(ret.Msg, "managed plugin development") && !strings.Contains(ret.Msg, "sensitive file")) {
					t.Fatalf("guard was bypassed: %s %v", recorder.Body.String(), err)
				}
				if data, err := os.ReadFile(abs); err != nil || string(data) != "unchanged-private-state" {
					t.Fatalf("protected file changed: %q %v", data, err)
				}
			})
		}
	}
	for _, path := range []string{"data/storage/ai/agent", "data/storage/ai/agent/sessions/task", "conf"} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/file/removeFile", strings.NewReader(`{"path":"`+path+`"}`)))
		if !strings.Contains(recorder.Body.String(), "managed plugin development") {
			t.Fatalf("ancestor removal accepted: %s", recorder.Body.String())
		}
	}
	// 目录枚举不得泄漏失败保存留下的运行时临时文件。
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/file/readDir", strings.NewReader(`{"path":"data/storage/ai/agent/sessions/task"}`)))
	if strings.Contains(recorder.Body.String(), "runtime.json") {
		t.Fatalf("runtime staging file was listed: %s", recorder.Body.String())
	}
	if _, err := os.Stat(filepath.Join(util.WorkspaceDir, "temp", "moved")); !os.IsNotExist(err) {
		t.Fatal("rejected rename created destination")
	}
}

func TestAPIContractPluginDevelopmentArchiveGuard(t *testing.T) {
	origWorkspace, origData, origConf := util.WorkspaceDir, util.DataDir, util.ConfDir
	util.WorkspaceDir = t.TempDir()
	util.DataDir = filepath.Join(util.WorkspaceDir, "data")
	util.ConfDir = filepath.Join(util.WorkspaceDir, "conf")
	t.Cleanup(func() { util.WorkspaceDir, util.DataDir, util.ConfDir = origWorkspace, origData, origConf })
	archive := filepath.Join(util.WorkspaceDir, "attack.zip")
	file, err := os.Create(archive)
	if err != nil {
		t.Fatal(err)
	}
	w := archivezip.NewWriter(file)
	entry, err := w.Create("data/storage/ai/agent/sessions/task/runtime.jsonabcdefg.tmp")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = entry.Write([]byte(`{"pluginWorkflow":{"approved":true}}`)); err != nil {
		t.Fatal(err)
	}
	if err = w.Close(); err != nil {
		t.Fatal(err)
	}
	if err = file.Close(); err != nil {
		t.Fatal(err)
	}
	if err = unzipWorkspaceArchive(archive, util.WorkspaceDir); err == nil {
		t.Fatal("archive overwrote private runtime staging")
	}
	if _, err = os.Stat(filepath.Join(util.DataDir, "storage")); !os.IsNotExist(err) {
		t.Fatal("rejected archive created a partial tree")
	}
}
