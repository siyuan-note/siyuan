//go:build fts5

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

package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const publishSearchCountExclusionEnv = "SIYUAN_TEST_PUBLISH_SEARCH_COUNT_EXCLUSION"

// TestPublishSearchCountExclusion 验证发布模式下读者搜索不可见文档时不会通过计数泄露其存在性。
// 覆盖隐藏、禁止发布以及密码保护三种不可见级别，GHSA-g45v-hxvm-wccj。
// 测试在子进程中运行，避免 SQLite 文件句柄影响临时目录回收。
func TestPublishSearchCountExclusion(t *testing.T) {
	if "1" != os.Getenv(publishSearchCountExclusionEnv) {
		cmd := exec.Command(os.Args[0], "-test.run=^TestPublishSearchCountExclusion$", "-test.v")
		cmd.Env = append(os.Environ(), publishSearchCountExclusionEnv+"=1")
		output, err := cmd.CombinedOutput()
		if nil != err {
			t.Fatalf("publish search count exclusion subprocess failed: %v\n%s", err, output)
		}
		return
	}

	gin.SetMode(gin.TestMode)

	oldConf := model.Conf
	oldWorkspaceDir, oldConfDir, oldDataDir := util.WorkspaceDir, util.ConfDir, util.DataDir
	oldHistoryDir, oldTempDir, oldQueueDir := util.HistoryDir, util.TempDir, util.QueueDir
	oldDBPath, oldHistoryDBPath := util.DBPath, util.HistoryDBPath
	oldAssetDBPath, oldBlockTreeDBPath := util.AssetContentDBPath, util.BlockTreeDBPath

	root := t.TempDir()
	t.Cleanup(func() {
		sql.CloseDatabase()
		model.Conf = oldConf
		util.WorkspaceDir, util.ConfDir, util.DataDir = oldWorkspaceDir, oldConfDir, oldDataDir
		util.HistoryDir, util.TempDir, util.QueueDir = oldHistoryDir, oldTempDir, oldQueueDir
		util.DBPath, util.HistoryDBPath = oldDBPath, oldHistoryDBPath
		util.AssetContentDBPath, util.BlockTreeDBPath = oldAssetDBPath, oldBlockTreeDBPath
	})

	util.WorkspaceDir = root
	util.ConfDir = filepath.Join(root, "conf")
	util.DataDir = filepath.Join(root, "data")
	util.HistoryDir = filepath.Join(root, "history")
	util.TempDir = filepath.Join(root, "temp")
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath = filepath.Join(util.TempDir, util.DBName)
	util.HistoryDBPath = filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath = filepath.Join(util.TempDir, "asset_content.db")
	util.BlockTreeDBPath = filepath.Join(util.TempDir, "blocktree.db")
	for _, dir := range []string{util.ConfDir, util.DataDir, util.HistoryDir, util.TempDir, util.QueueDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}

	model.Conf = model.NewAppConf()
	model.Conf.Lang = "en"
	model.Conf.FileTree = conf.NewFileTree()
	model.Conf.Editor = conf.NewEditor()
	model.Conf.Export = conf.NewExport()
	model.Conf.Search = conf.NewSearch()
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()
	model.Conf.Sync = conf.NewSync()

	const boxID = "20260823000000-b0xb0x1"
	const publicID = "20260823000001-aabbccd"
	const hiddenID = "20260823000002-aabbccd"
	const disabledID = "20260823000003-aabbccd"
	const passwordID = "20260823000004-aabbccd"
	box := &model.Box{ID: boxID}
	boxConf := conf.NewBoxConf()
	boxConf.Name = "Publish search count exclusion"
	boxConf.Closed = false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}

	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	treenode.InitBlockTree(true)

	addDoc := func(id, title, term string) {
		tree := treenode.NewTree(boxID, "/"+id+".sy", "/"+title, title)
		tree.Root.FirstChild.Unlink()
		node := &ast.Node{Type: ast.NodeParagraph, ID: id + "-child"}
		node.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(term)})
		tree.Root.AppendChild(node)
		treenode.IndexBlockTree(tree)
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		sql.IndexTreeQueue(tree)
	}
	addDoc(publicID, "Public", "publiccanary")
	addDoc(hiddenID, "Hidden", "hiddencanary")
	addDoc(disabledID, "Disabled", "disabledcanary")
	addDoc(passwordID, "Password", "passwordcanary")
	sql.FlushQueue()

	if err := model.SetPublishAccess(model.PublishAccess{
		{ID: hiddenID, Visible: false},
		{ID: disabledID, Disable: true},
		{ID: passwordID, Password: "secret123"},
	}); err != nil {
		t.Fatal(err)
	}

	search := func(query string) (blocksLen, matchedBlockCount, matchedRootCount, pageCount int, body string) {
		payload := `{"query":"` + query + `","method":0,"types":{"document":true,"paragraph":true},"subTypes":{},"paths":[],"groupBy":0,"orderBy":0,"page":1,"pageSize":32}`
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodPost, "/api/search/fullTextSearchBlock", strings.NewReader(payload))
		c.Request.Header.Set("Content-Type", "application/json")
		c.Set(model.RoleContextKey, model.RoleReader)
		fullTextSearchBlock(c)

		var response struct {
			Data struct {
				Blocks            []json.RawMessage `json:"blocks"`
				MatchedBlockCount int               `json:"matchedBlockCount"`
				MatchedRootCount  int               `json:"matchedRootCount"`
				PageCount         int               `json:"pageCount"`
			} `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatalf("invalid handler response: %v\n%s", err, recorder.Body.String())
		}
		return len(response.Data.Blocks), response.Data.MatchedBlockCount, response.Data.MatchedRootCount, response.Data.PageCount, recorder.Body.String()
	}

	if blocksLen, matchedBlockCount, matchedRootCount, pageCount, body := search("publiccanary"); 0 >= blocksLen || 0 >= matchedBlockCount || 0 >= matchedRootCount || 0 >= pageCount {
		t.Fatalf("public doc should remain searchable: %s", body)
	}

	for _, term := range []string{"hiddencanary", "disabledcanary", "passwordcanary"} {
		blocksLen, matchedBlockCount, matchedRootCount, pageCount, body := search(term)
		if 0 != blocksLen || 0 != matchedBlockCount || 0 != matchedRootCount || 0 != pageCount {
			t.Fatalf("search [%s] disclosed counts for invisible doc: %s", term, body)
		}
	}
}
