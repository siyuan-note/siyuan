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

const ftsMatchInjectionEnv = "SIYUAN_TEST_FTS_MATCH_INJECTION"

// TestFullTextSearchBlockFTSMatchInjection 验证查询语法搜索（method=1）中的恶意 query 无法注入 FTS5 MATCH 操作数。
// 攻击载荷尝试闭合 MATCH 字符串字面量后 UNION 读取 blocks 表，GHSA-336w-67gx-gx2h。
// 测试在子进程中运行，避免 SQLite 文件句柄影响临时目录回收。
func TestFullTextSearchBlockFTSMatchInjection(t *testing.T) {
	if "1" != os.Getenv(ftsMatchInjectionEnv) {
		cmd := exec.Command(os.Args[0], "-test.run=^TestFullTextSearchBlockFTSMatchInjection$", "-test.v")
		cmd.Env = append(os.Environ(), ftsMatchInjectionEnv+"=1")
		output, err := cmd.CombinedOutput()
		if nil != err {
			t.Fatalf("FTS match injection subprocess failed: %v\n%s", err, output)
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

	const boxID = "20260826000000-b0xb0x1"
	const docID = "20260826000001-aabbccd"
	box := &model.Box{ID: boxID}
	boxConf := conf.NewBoxConf()
	boxConf.Name = "FTS match injection"
	boxConf.Closed = false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}

	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	treenode.InitBlockTree(true)

	tree := treenode.NewTree(boxID, "/"+docID+".sy", "/"+docID, "FTS match injection")
	tree.Root.FirstChild.Unlink()
	node := &ast.Node{Type: ast.NodeParagraph, ID: docID + "-child"}
	node.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("fts injection canary")})
	tree.Root.AppendChild(node)
	treenode.IndexBlockTree(tree)
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	sql.IndexTreeQueue(tree)
	sql.FlushQueue()

	search := func(query string, method int) (blocksLen, matchedBlockCount, matchedRootCount, pageCount int, body string) {
		payload, err := json.Marshal(map[string]any{
			"query":    query,
			"method":   method,
			"types":    map[string]bool{"document": true, "paragraph": true},
			"subTypes": map[string]bool{},
			"paths":    []string{},
			"groupBy":  0,
			"orderBy":  0,
			"page":     1,
			"pageSize": 32,
		})
		if err != nil {
			t.Fatal(err)
		}
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodPost, "/api/search/fullTextSearchBlock", strings.NewReader(string(payload)))
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
		if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatalf("invalid handler response: %v\n%s", err, recorder.Body.String())
		}
		return len(response.Data.Blocks), response.Data.MatchedBlockCount, response.Data.MatchedRootCount, response.Data.PageCount, recorder.Body.String()
	}

	// 正常的查询语法搜索仍应命中
	if blocksLen, matchedBlockCount, _, _, body := search("fts injection canary", 1); 0 >= blocksLen || 0 >= matchedBlockCount {
		t.Fatalf("query syntax search should match canary content: %s", body)
	}

	// 恶意 query 试图闭合 MATCH 字符串字面量后 UNION 读取 blocks 表，不应返回任何数据
	injection := `x)') UNION SELECT id,parent_id,root_id,hash,box,path,hpath,name,alias,memo,tag,content,fcontent,markdown,length,type,subtype,ial,sort,created,updated FROM blocks --`
	blocksLen, matchedBlockCount, matchedRootCount, pageCount, body := search(injection, 1)
	if 0 != blocksLen || 0 != matchedBlockCount || 0 != matchedRootCount || 0 != pageCount {
		t.Fatalf("FTS match injection returned unexpected data: %s", body)
	}
	if strings.Contains(body, "fts injection canary") {
		t.Fatalf("FTS match injection leaked block content: %s", body)
	}
}
