// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/internal/testutil"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// TestOpenPublishPackageFileRejectsSensitiveWidgetResource 验证发布读者经文件接口读取挂件包时先拒绝敏感文件名。
func TestOpenPublishPackageFileRejectsSensitiveWidgetResource(t *testing.T) {
	const boxID, rootID = "20261026000000-sensbx1", "20261026000000-sensdoc"
	previousDataDir, previousWorkspace, previousDBPath := util.DataDir, util.WorkspaceDir, util.BlockTreeDBPath
	root := t.TempDir()
	util.DataDir = filepath.Join(root, "data")
	util.WorkspaceDir = root
	util.BlockTreeDBPath = filepath.Join(root, "blocktree.db")
	if err := os.MkdirAll(util.DataDir, 0755); err != nil {
		t.Fatal(err)
	}
	treenode.InitBlockTree(true)
	cacheKey := boxID + "/" + rootID
	t.Cleanup(func() {
		publishResourceRefsCache.Delete(cacheKey)
		treenode.CloseDatabase()
		util.DataDir, util.WorkspaceDir, util.BlockTreeDBPath = previousDataDir, previousWorkspace, previousDBPath
	})

	doc := &ast.Node{Type: ast.NodeDocument, ID: rootID}
	doc.SetIALAttr("updated", "20261026000001")
	tree := &parse.Tree{ID: rootID, Box: boxID, Path: "/" + rootID + ".sy", Root: doc}
	treenode.IndexBlockTree(tree)
	bt := treenode.GetBlockTreeInBox(rootID, boxID)
	if bt == nil {
		t.Fatal("block tree missing")
	}

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
	publishResourceRefsCache.Store(cacheKey, &publishResourceRefs{
		updated: bt.Updated,
		widgets: map[string]struct{}{"example": {}},
	})

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/api/file/getFile", nil)
	for _, requestPath := range []string{"/data/widgets/example/credentials.json", "/data/widgets/example/id_token"} {
		file, handled, err := OpenPublishPackageFile(c, requestPath)
		if file != nil {
			file.Close()
		}
		if !handled || !errors.Is(err, fs.ErrPermission) {
			t.Fatalf("sensitive %s: handled = %v, err = %v, want permission denied", requestPath, handled, err)
		}
	}
	t.Run("short filename", func(t *testing.T) {
		short := filepath.Base(testutil.ShortPath(t, filepath.Join(widgetDir, "credentials.json")))
		file, handled, err := OpenPublishPackageFile(c, "/data/widgets/example/"+short)
		if file != nil {
			file.Close()
		}
		if !handled || !errors.Is(err, fs.ErrPermission) {
			t.Fatalf("sensitive widget alias %s: handled = %v, err = %v", short, handled, err)
		}
	})

	file, handled, err := OpenPublishPackageFile(c, "/data/widgets/example/index.html")
	if err != nil || !handled {
		t.Fatalf("ordinary widget file rejected: handled = %v, err = %v", handled, err)
	}
	defer file.Close()
	data, readErr := io.ReadAll(file)
	if readErr != nil || string(data) != files["index.html"] {
		t.Fatalf("unexpected ordinary widget content: %q, %v", data, readErr)
	}
}

// TestOpenPublishPackageFileRejectsSensitivePluginResource 验证发布读者经文件接口读取插件包时先拒绝敏感文件名。
func TestOpenPublishPackageFileRejectsSensitivePluginResource(t *testing.T) {
	originalWorkspace, originalDataDir, originalConf := util.WorkspaceDir, util.DataDir, Conf
	util.WorkspaceDir = t.TempDir()
	util.DataDir = filepath.Join(util.WorkspaceDir, "data")
	Conf = NewAppConf()
	Conf.Sync.Store(conf.NewSync())
	Conf.Bazaar.Store(&conf.Bazaar{Trust: true})
	Conf.Lang = "en"
	t.Cleanup(func() { util.WorkspaceDir, util.DataDir, Conf = originalWorkspace, originalDataDir, originalConf })

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
	if _, err := SetPetalEnabled("example", true); err != nil {
		t.Fatal(err)
	}

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/api/file/getFile", nil)
	file, handled, err := OpenPublishPackageFile(c, "/data/plugins/example/credentials.json")
	if file != nil {
		file.Close()
	}
	if !handled || !errors.Is(err, fs.ErrPermission) {
		t.Fatalf("sensitive plugin resource: handled = %v, err = %v, want permission denied", handled, err)
	}
	t.Run("short filename in declared directory", func(t *testing.T) {
		short := filepath.Base(testutil.ShortPath(t, filepath.Join(pluginDir, "resources", "credentials.json")))
		file, handled, err := OpenPublishPackageFile(c, "/data/plugins/example/resources/"+short)
		if file != nil {
			file.Close()
		}
		if !handled || !errors.Is(err, fs.ErrPermission) {
			t.Fatalf("sensitive plugin alias %s: handled = %v, err = %v", short, handled, err)
		}
	})

	file, handled, err = OpenPublishPackageFile(c, "/data/plugins/example/logo.txt")
	if err != nil || !handled {
		t.Fatalf("ordinary plugin resource rejected: handled = %v, err = %v", handled, err)
	}
	defer file.Close()
	data, readErr := io.ReadAll(file)
	if readErr != nil || string(data) != files["logo.txt"] {
		t.Fatalf("unexpected ordinary plugin content: %q, %v", data, readErr)
	}
}
