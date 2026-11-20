// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// TestReaderSearchWithoutBlockMemo 校验发布读者经无效块引搜索和全文搜索都拿不到块备注，管理员保持原样。
func TestReaderSearchWithoutBlockMemo(t *testing.T) {
	const helper = "SIYUAN_TEST_READER_SEARCH_MEMO"
	if os.Getenv(helper) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestReaderSearchWithoutBlockMemo$", "-test.v")
		command.Env = append(os.Environ(), helper+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("reader search subprocess failed: %v\n%s", err, output)
		}
		return
	}

	root := t.TempDir()
	util.WorkspaceDir = root
	util.DataDir = filepath.Join(root, "data")
	util.TempDir = root
	util.ConfDir = root
	util.QueueDir = filepath.Join(root, "queue")
	util.DBPath = filepath.Join(root, "siyuan.db")
	util.HistoryDBPath = filepath.Join(root, "history.db")
	util.AssetContentDBPath = filepath.Join(root, "asset_content.db")
	util.BlockTreeDBPath = filepath.Join(root, "blocktree.db")
	util.ReadOnly = false
	if err := os.MkdirAll(util.DataDir, 0755); err != nil {
		t.Fatal(err)
	}

	model.Conf = model.NewAppConf()
	model.Conf.Lang = "en"
	model.Conf.FileTree.Store(conf.NewFileTree())
	model.Conf.Sync.Store(conf.NewSync())
	model.Conf.Search.Store(conf.NewSearch())
	model.Conf.Editor.Store(conf.NewEditor())
	model.Conf.Export.Store(conf.NewExport())
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()

	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	treenode.InitBlockTree(true)
	defer treenode.CloseDatabase()
	defer sql.CloseDatabase()

	const (
		boxID      = "20261120000000-boxmemo"
		docID      = "20261120000001-docmemo"
		blockID    = "20261120000002-blkmemo"
		missingID  = "20261120000003-missing"
		memoCanary = "READER_BLOCK_MEMO_CANARY_4c1d"
	)

	box := &model.Box{ID: boxID}
	boxConf := conf.NewBoxConf()
	boxConf.Name = "Reader search memo"
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatalf("save box conf: %v", err)
	}

	tree := treenode.NewTree(boxID, "/"+docID+".sy", "/"+docID, docID)
	tree.Root.FirstChild.Unlink()
	paragraph := treenode.NewParagraph(blockID)
	paragraph.SetIALAttr("memo", memoCanary)
	paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("broken reference")})
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: missingID,
		TextMarkBlockRefSubtype: "s", TextMarkTextContent: "missing"})
	tree.Root.AppendChild(paragraph)
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatalf("write tree: %v", err)
	}
	treenode.IndexBlockTree(tree)
	sql.IndexTreeQueue(tree)
	sql.FlushQueue()

	if err := model.SetPublishAccess(model.PublishAccess{}); err != nil {
		t.Fatalf("set publish access: %v", err)
	}

	type memoResponse struct {
		Code int `json:"code"`
		Data struct {
			Blocks []struct {
				ID   string            `json:"id"`
				Memo string            `json:"memo"`
				IAL  map[string]string `json:"ial"`
			} `json:"blocks"`
		} `json:"data"`
	}

	post := func(role model.Role, path, body string, handler gin.HandlerFunc) memoResponse {
		t.Helper()
		gin.SetMode(gin.TestMode)
		engine := gin.New()
		engine.Use(func(c *gin.Context) {
			c.Set(model.RoleContextKey, role)
			c.Next()
		})
		engine.POST(path, handler)
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, request)
		var response memoResponse
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatalf("%s: invalid response %q: %v", path, recorder.Body.String(), err)
		}
		if response.Code != 0 {
			t.Fatalf("%s failed: %s", path, recorder.Body.String())
		}
		return response
	}

	blockOf := func(response memoResponse, path string) (string, string) {
		t.Helper()
		if 1 != len(response.Data.Blocks) {
			t.Fatalf("%s returned %d blocks, want 1", path, len(response.Data.Blocks))
		}
		if blockID != response.Data.Blocks[0].ID {
			t.Fatalf("%s returned unexpected block %q", path, response.Data.Blocks[0].ID)
		}
		return response.Data.Blocks[0].Memo, response.Data.Blocks[0].IAL["memo"]
	}

	invalidRefBody := `{"page":1,"pageSize":20}`
	if memo, ialMemo := blockOf(post(model.RoleReader, "/api/search/listInvalidBlockRefs", invalidRefBody, listInvalidBlockRefs), "reader listInvalidBlockRefs"); "" != memo || "" != ialMemo {
		t.Fatalf("reader received the block memo from listInvalidBlockRefs: memo=%q ial=%q", memo, ialMemo)
	}
	if memo, ialMemo := blockOf(post(model.RoleAdministrator, "/api/search/listInvalidBlockRefs", invalidRefBody, listInvalidBlockRefs), "administrator listInvalidBlockRefs"); memoCanary != memo || memoCanary != ialMemo {
		t.Fatalf("administrator lost the block memo from listInvalidBlockRefs: memo=%q ial=%q", memo, ialMemo)
	}

	fullTextBody := fmt.Sprintf(`{"query":"%s","page":1,"pageSize":20}`, "broken")
	if memo, ialMemo := blockOf(post(model.RoleReader, "/api/search/fullTextSearchBlock", fullTextBody, fullTextSearchBlock), "reader fullTextSearchBlock"); "" != memo || "" != ialMemo {
		t.Fatalf("reader received the block memo from fullTextSearchBlock: memo=%q ial=%q", memo, ialMemo)
	}
	if memo, ialMemo := blockOf(post(model.RoleAdministrator, "/api/search/fullTextSearchBlock", fullTextBody, fullTextSearchBlock), "administrator fullTextSearchBlock"); memoCanary != memo || memoCanary != ialMemo {
		t.Fatalf("administrator lost the block memo from fullTextSearchBlock: memo=%q ial=%q", memo, ialMemo)
	}
}
