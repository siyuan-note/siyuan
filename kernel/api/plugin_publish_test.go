package api

import (
	"bytes"
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

func TestAPIContractPluginPublish(t *testing.T) {
	oldWorkspace, oldData, oldConfDir, oldConf := util.WorkspaceDir, util.DataDir, util.ConfDir, model.Conf
	util.WorkspaceDir = t.TempDir()
	util.DataDir, util.ConfDir = filepath.Join(util.WorkspaceDir, "data"), filepath.Join(util.WorkspaceDir, "conf")
	model.Conf = model.NewAppConf()
	model.Conf.Sync = conf.NewSync()
	model.Conf.Bazaar = &conf.Bazaar{Trust: true}
	t.Cleanup(func() {
		util.WorkspaceDir, util.DataDir, util.ConfDir, model.Conf = oldWorkspace, oldData, oldConfDir, oldConf
	})
	files := map[string]string{
		"data/plugins/example/plugin.json":        `{"name":"example","version":"1.0.0","minAppVersion":"0.0.1","publish":{"resources":["logo.txt"],"data":["theme"]}}`,
		"data/plugins/example/index.js":           "frontend",
		"data/plugins/example/kernel.js":          "kernel secret",
		"data/plugins/example/logo.txt":           "logo",
		"data/plugins/example/private.json":       "secret",
		"data/storage/petal/example/private.json": "private token",
		"data/public/file.txt":                    "public",
		"data/private.json":                       "private data root",
		"conf/private.json":                       "conf secret",
		"temp/private.json":                       "temp secret",
		"repo/private.json":                       "repo secret",
		"history/private.json":                    "history secret",
	}
	for path, content := range files {
		path = filepath.Join(util.WorkspaceDir, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := model.SetPetalEnabled("example", true); err != nil {
		t.Fatal(err)
	}
	request := func(role model.Role, path, body string) *httptest.ResponseRecorder {
		t.Helper()
		engine := gin.New()
		engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, role); c.Next() })
		ServeAPI(engine)
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", path, strings.NewReader(body)))
		if recorder.Body.Len() > 0 {
			requireAPIContract(t, "POST", path, recorder)
		}
		return recorder
	}
	code := func(recorder *httptest.ResponseRecorder) int {
		t.Helper()
		var value struct {
			Code int `json:"code"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &value); err != nil {
			t.Fatal(err)
		}
		return value.Code
	}
	for _, role := range []model.Role{model.RoleReader, model.RoleEditor} {
		for _, path := range []string{"getPluginPublishInfo", "setPluginPublishDataGrant", "savePluginPublishData"} {
			if response := request(role, "/api/petal/"+path, `{}`); response.Code != http.StatusForbidden {
				t.Fatalf("non-admin %s admitted: %s", path, response.Body)
			}
		}
		if response := request(role, "/api/file/readDir", `{"path":"data/plugins/example"}`); response.Code != http.StatusForbidden {
			t.Fatal("directory enumeration admitted")
		}
	}
	if response := request(model.RoleReader, "/api/petal/loadPluginPublishData", `{"packageName":"example"}`); code(response) != 403 {
		t.Fatalf("ungranted read: %s", response.Body)
	}
	if response := request(model.RoleAdministrator, "/api/petal/setPluginPublishDataGrant", `{"packageName":"example","fields":["theme"],"enabled":true}`); code(response) != 0 {
		t.Fatal(response.Body)
	}
	if response := request(model.RoleReader, "/api/petal/loadPluginPublishData", `{"packageName":"example"}`); code(response) != 404 {
		t.Fatalf("missing snapshot: %s", response.Body)
	}
	if response := request(model.RoleAdministrator, "/api/petal/savePluginPublishData", `{"packageName":"example","data":{"theme":"dark"}}`); code(response) != 0 {
		t.Fatal(response.Body)
	}
	if response := request(model.RoleReader, "/api/petal/loadPluginPublishData", `{"packageName":"example"}`); code(response) != 0 || !strings.Contains(response.Body.String(), `"theme":"dark"`) || response.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatal(response.Body)
	}
	if response := request(model.RoleAdministrator, "/api/petal/savePluginPublishData", `{"packageName":"example","data":{"theme":{"token":"secret"}}}`); code(response) == 0 {
		t.Fatal("nested data accepted")
	}
	for path, want := range map[string]string{"data/public/file.txt": "public", "data/plugins/example/index.js": "frontend", "data/plugins/example/logo.txt": "logo"} {
		body, _ := json.Marshal(map[string]string{"path": path})
		response := request(model.RoleReader, "/api/file/getFile", string(body))
		if response.Code != 200 || response.Body.String() != want {
			t.Fatalf("allowed %s: %d %s", path, response.Code, response.Body)
		}
	}
	for _, path := range []string{"data/plugins/example/kernel.js", "data/plugins/example/private.json", "data/storage/petal/example/private.json", "data/private.json", "conf/private.json", "temp/private.json", "repo/private.json", "history/private.json", "conf/plugin-publish/example.json", "data/public/../storage/petal/example/private.json", "data/plugins/example/%2e%2e/private.json"} {
		body, _ := json.Marshal(map[string]string{"path": path})
		response := request(model.RoleReader, "/api/file/getFile", string(body))
		if response.Code != 202 || code(response) != 403 {
			t.Fatalf("denied %s: %d %s", path, response.Code, response.Body)
		}
	}
	response := request(model.RoleReader, "/api/petal/loadPetals", `{"frontend":"browser-desktop"}`)
	if bytes.Contains(response.Body.Bytes(), []byte("kernel secret")) || !bytes.Contains(response.Body.Bytes(), []byte("frontend")) {
		t.Fatal(response.Body)
	}
	if _, err := model.SetPetalPublishEnabled("example", false); err != nil {
		t.Fatal(err)
	}
	if response := request(model.RoleReader, "/api/petal/loadPluginPublishData", `{"packageName":"example"}`); code(response) != 403 {
		t.Fatal("disabled data admitted")
	}
	if response := request(model.RoleReader, "/api/file/getFile", `{"path":"data/plugins/example/logo.txt"}`); code(response) != 403 {
		t.Fatal("disabled resource admitted")
	}
	if response := request(model.RoleAdministrator, "/api/file/getFile", `{"path":"data/storage/petal/example/private.json"}`); response.Body.String() != "private token" {
		t.Fatalf("admin regression: %s", response.Body)
	}
}
