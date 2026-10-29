// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/internal/testutil"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// TestWidgetPublishReaderRefusesSensitiveFile 验证发布读者不能经静态路由读取挂件包中的敏感文件。
func TestWidgetPublishReaderRefusesSensitiveFile(t *testing.T) {
	gin.SetMode(gin.TestMode)
	const boxID, docID = "20261026000000-sensbx1", "20261026000000-sensdoc"
	previousWorkspace, previousData, previousConfDir := util.WorkspaceDir, util.DataDir, util.ConfDir
	previousDBPath, previousConf := util.BlockTreeDBPath, model.Conf
	root := t.TempDir()
	util.WorkspaceDir = root
	util.DataDir, util.ConfDir = filepath.Join(root, "data"), filepath.Join(root, "conf")
	util.BlockTreeDBPath = filepath.Join(root, "blocktree.db")
	for _, dir := range []string{util.DataDir, util.ConfDir, filepath.Join(util.DataDir, boxID)} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	model.Conf = model.NewAppConf()
	model.Conf.Sync.Store(conf.NewSync())
	model.Conf.FileTree.Store(conf.NewFileTree())
	model.Conf.Editor.Store(conf.NewEditor())
	model.Conf.Lang = "en"
	treenode.InitBlockTree(true)
	t.Cleanup(func() {
		model.SetPublishAccess(model.PublishAccess{})
		treenode.CloseDatabase()
		util.WorkspaceDir, util.DataDir, util.ConfDir = previousWorkspace, previousData, previousConfDir
		util.BlockTreeDBPath, model.Conf = previousDBPath, previousConf
	})

	widgetDir := filepath.Join(util.DataDir, "widgets", "example")
	if err := os.MkdirAll(widgetDir, 0755); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"widget.json":      `{"name":"example","version":"1.0.0","minAppVersion":"0.0.1","disabledInPublish":false}`,
		"index.html":       "<html>ok</html>",
		"credentials.json": "API_TOKEN=secret",
		"id_token":         "token-secret",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(widgetDir, name), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}

	tree := treenode.NewTree(boxID, "/"+docID+".sy", "/Widget proof", "Widget proof")
	tree.Root.AppendChild(&ast.Node{Type: ast.NodeIFrame, Tokens: []byte(`<iframe src="/widgets/example/"></iframe>`)})
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.IndexBlockTree(tree)
	if err := model.SetPublishAccess(model.PublishAccess{{ID: docID, Visible: true, Password: "", Disable: false}}); err != nil {
		t.Fatal(err)
	}

	request := func(role model.Role, requestPath string) *httptest.ResponseRecorder {
		engine := gin.New()
		engine.Use(func(c *gin.Context) {
			c.Set(model.RoleContextKey, role)
			c.Next()
		})
		serveWidgets(engine)
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, requestPath, nil))
		return recorder
	}

	t.Run("reader short filename", func(t *testing.T) {
		short := filepath.Base(testutil.ShortPath(t, filepath.Join(widgetDir, "credentials.json")))
		recorder := request(model.RoleReader, "/widgets/example/"+short)
		if recorder.Code != http.StatusForbidden || recorder.Body.Len() != 0 {
			t.Fatalf("sensitive widget alias %s: status = %d, body = %q", short, recorder.Code, recorder.Body.String())
		}
	})
	for _, role := range []model.Role{model.RoleReader, model.RoleAdministrator} {
		for _, requestPath := range []string{"/widgets/example/credentials.json", "/widgets/example/id_token"} {
			recorder := request(role, requestPath)
			if recorder.Code != http.StatusForbidden || recorder.Body.Len() != 0 {
				t.Fatalf("%v %s: status = %d, body = %q", role, requestPath, recorder.Code, recorder.Body.String())
			}
		}
		if recorder := request(role, "/widgets/example/"); recorder.Code != http.StatusOK || recorder.Body.String() != files["index.html"] {
			t.Fatalf("%v ordinary widget file: status = %d, body = %q", role, recorder.Code, recorder.Body.String())
		}
	}
}

// TestPluginPublishReaderRefusesSensitiveFile 验证发布读者不能经静态路由读取插件包中的敏感文件。
func TestPluginPublishReaderRefusesSensitiveFile(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousWorkspace, previousData, previousConf := util.WorkspaceDir, util.DataDir, model.Conf
	util.WorkspaceDir = t.TempDir()
	util.DataDir = filepath.Join(util.WorkspaceDir, "data")
	model.Conf = model.NewAppConf()
	model.Conf.Sync.Store(conf.NewSync())
	model.Conf.Bazaar.Store(&conf.Bazaar{Trust: true})
	model.Conf.Lang = "en"
	t.Cleanup(func() { util.WorkspaceDir, util.DataDir, model.Conf = previousWorkspace, previousData, previousConf })

	pluginDir := filepath.Join(util.DataDir, "plugins", "example")
	if err := os.MkdirAll(filepath.Join(pluginDir, "resources"), 0755); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"plugin.json":                `{"name":"example","version":"1.0.0","minAppVersion":"0.0.1","publish":{"resources":["logo.txt","credentials.json","resources/"]}}`,
		"index.js":                   "frontend",
		"logo.txt":                   "logo",
		"credentials.json":           "API_TOKEN=secret",
		"resources/credentials.json": "API_TOKEN=nested-secret",
	}
	for name, content := range files {
		if err := os.WriteFile(filepath.Join(pluginDir, name), []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := model.SetPetalEnabled("example", true); err != nil {
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

	t.Run("reader short filename in declared directory", func(t *testing.T) {
		short := filepath.Base(testutil.ShortPath(t, filepath.Join(pluginDir, "resources", "credentials.json")))
		recorder := request(model.RoleReader, "/plugins/example/resources/"+short)
		if recorder.Code != http.StatusForbidden || recorder.Body.Len() != 0 {
			t.Fatalf("sensitive plugin alias %s: status = %d, body = %q", short, recorder.Code, recorder.Body.String())
		}
	})
	for _, role := range []model.Role{model.RoleReader, model.RoleAdministrator} {
		if recorder := request(role, "/plugins/example/credentials.json"); recorder.Code != http.StatusForbidden || recorder.Body.Len() != 0 {
			t.Fatalf("%v sensitive plugin resource: status = %d, body = %q", role, recorder.Code, recorder.Body.String())
		}
		if recorder := request(role, "/plugins/example/logo.txt"); recorder.Code != http.StatusOK || recorder.Body.String() != files["logo.txt"] {
			t.Fatalf("%v ordinary plugin resource: status = %d, body = %q", role, recorder.Code, recorder.Body.String())
		}
	}
}
