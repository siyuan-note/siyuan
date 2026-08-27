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

//go:build fts5

package model

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// TestExportEmbedFilteredByPublishAccess 验证发布读者导出公共文档时，查询嵌入块匹配到的
// 发布禁用文档内容会被访问检查过滤，而管理员导出不受影响。
func TestExportEmbedFilteredByPublishAccess(t *testing.T) {
	oldConf := Conf
	oldWorkspaceDir := util.WorkspaceDir
	oldConfDir := util.ConfDir
	oldDataDir := util.DataDir
	oldTempDir := util.TempDir
	oldQueueDir := util.QueueDir
	oldDBPath := util.DBPath
	oldHistoryDBPath := util.HistoryDBPath
	oldAssetContentDBPath := util.AssetContentDBPath
	oldBlockTreeDBPath := util.BlockTreeDBPath

	tempDir := t.TempDir()
	util.WorkspaceDir = tempDir
	util.ConfDir = filepath.Join(tempDir, "conf")
	util.DataDir = filepath.Join(tempDir, "data")
	util.TempDir = filepath.Join(tempDir, "temp")
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath = filepath.Join(util.TempDir, util.DBName)
	util.HistoryDBPath = filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath = filepath.Join(util.TempDir, "asset_content.db")
	util.BlockTreeDBPath = filepath.Join(tempDir, "blocktree.db")
	for _, dir := range []string{util.ConfDir, util.DataDir, util.TempDir, util.QueueDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatalf("create temporary directory %s: %v", dir, err)
		}
	}
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	Conf = NewAppConf()
	Conf.Editor = conf.NewEditor()
	Conf.FileTree = conf.NewFileTree()
	Conf.Search = conf.NewSearch()
	Conf.Export = conf.NewExport()
	treenode.InitBlockTree(true)
	invalidateEncryptedPublishAccessCache()

	t.Cleanup(func() {
		treenode.CloseDatabase()
		sql.CloseDatabase()
		Conf = oldConf
		util.WorkspaceDir = oldWorkspaceDir
		util.ConfDir = oldConfDir
		util.DataDir = oldDataDir
		util.TempDir = oldTempDir
		util.QueueDir = oldQueueDir
		util.DBPath = oldDBPath
		util.HistoryDBPath = oldHistoryDBPath
		util.AssetContentDBPath = oldAssetContentDBPath
		util.BlockTreeDBPath = oldBlockTreeDBPath
		invalidateEncryptedPublishAccessCache()
		if "" != oldBlockTreeDBPath {
			treenode.InitBlockTree(false)
		}
	})

	const (
		boxID     = "20260826000000-box0001"
		publicID  = "20260826000001-public1"
		privateID = "20260826000002-prv0001"
		embedID   = "20260826000003-embed01"
		canary    = "PRIVATE_EMBED_CANARY_20260826"
	)

	publicTree := treenode.NewTree(boxID, "/"+publicID+".sy", "/Public", "Public")
	embed := &ast.Node{Type: ast.NodeBlockQueryEmbed, ID: embedID, Box: boxID, Path: publicTree.Path}
	embed.AppendChild(&ast.Node{Type: ast.NodeBlockQueryEmbedScript,
		Tokens: []byte("SELECT * FROM blocks WHERE id = '" + privateID + "'")})
	publicTree.Root.AppendChild(embed)

	privateTree := treenode.NewTree(boxID, "/"+privateID+".sy", "/Private", "Private")
	privateParagraph := privateTree.Root.FirstChild
	privateParagraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(canary)})

	for _, tree := range []*parse.Tree{publicTree, privateTree} {
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatalf("write synthetic tree: %v", err)
		}
		treenode.UpsertBlockTree(tree)
		sql.IndexTreeQueue(tree)
	}
	sql.FlushQueue()
	t.Cleanup(func() {
		treenode.RemoveBlockTree(boxID, publicID)
		treenode.RemoveBlockTree(boxID, privateID)
	})

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	publishAccess := PublishAccess{
		{ID: publicID, Visible: true},
		{ID: privateID, Disable: true},
	}
	accessChecker := func(blockID string) bool {
		bt := treenode.GetBlockTree(blockID)
		if nil == bt {
			return false
		}
		return checkBlockTreeAccessableByPublishAccess(c, publishAccess, bt)
	}

	markdown := ExportStdMarkdown(publicID, false, false, false, false, accessChecker)
	if strings.Contains(markdown, canary) {
		t.Fatalf("publish reader received private embed content: %s", markdown)
	}
	stdHTML := ExportPreview(publicID, false, accessChecker)
	if strings.Contains(stdHTML, canary) {
		t.Fatalf("publish reader received private embed content in preview: %s", stdHTML)
	}

	adminMarkdown := ExportStdMarkdown(publicID, false, false, false, false)
	if !strings.Contains(adminMarkdown, canary) {
		t.Fatalf("administrator export should include embed content: %s", adminMarkdown)
	}
}
