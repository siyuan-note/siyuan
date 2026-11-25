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
	searchSettings := conf.NewSearch()
	searchSettings.IAL = true
	model.Conf.Search.Store(searchSettings)
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
			MatchedBlockCount int `json:"matchedBlockCount"`
			MatchedRootCount  int `json:"matchedRootCount"`
			PageCount         int `json:"pageCount"`
			Blocks            []struct {
				ID   string            `json:"id"`
				Memo string            `json:"memo"`
				IAL  map[string]string `json:"ial"`
			} `json:"blocks"`
		} `json:"data"`
	}

	call := func(role model.Role, path, body string, handler gin.HandlerFunc) map[string]any {
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
		var response map[string]any
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatalf("%s: invalid response %q: %v", path, recorder.Body.String(), err)
		}
		if response["code"] != float64(0) {
			t.Fatalf("%s failed: %s", path, recorder.Body.String())
		}
		return response
	}

	post := func(role model.Role, path, body string, handler gin.HandlerFunc) memoResponse {
		t.Helper()
		encoded, err := json.Marshal(call(role, path, body, handler))
		if err != nil {
			t.Fatal(err)
		}
		var response memoResponse
		if err = json.Unmarshal(encoded, &response); err != nil {
			t.Fatalf("%s: invalid response: %v", path, err)
		}
		return response
	}

	dataOf := func(response map[string]any, path string) map[string]any {
		t.Helper()
		data, ok := response["data"].(map[string]any)
		if !ok {
			t.Fatalf("%s returned no data object: %#v", path, response)
		}
		return data
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

	for _, tc := range []struct {
		name                      string
		method                    int
		searchHPath               bool
		privateQuery, publicQuery string
	}{
		{"keywords", 0, false, memoCanary, "broken"},
		{"keywords with path", 0, true, memoCanary, "broken"},
		{"document keywords", 0, true, memoCanary + " broken", "broken reference"},
		{"query syntax", 1, false, memoCanary, "(broken OR missing)"},
		{"regular expression", 3, false, memoCanary, "broken.*reference"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			search := func(role model.Role, query string) memoResponse {
				body := fmt.Sprintf(`{"query":%q,"method":%d,"page":1,"pageSize":20,"searchHPath":%t}`, query, tc.method, tc.searchHPath)
				return post(role, "/api/search/fullTextSearchBlock", body, fullTextSearchBlock)
			}
			data := search(model.RoleReader, tc.privateQuery).Data
			if len(data.Blocks) != 0 || data.MatchedBlockCount != 0 || data.MatchedRootCount != 0 || data.PageCount != 0 {
				t.Fatalf("private memo changed the reader's search matches: %+v", data)
			}
			for _, response := range []memoResponse{search(model.RoleReader, tc.publicQuery), search(model.RoleAdministrator, tc.privateQuery)} {
				data := response.Data
				if len(data.Blocks) == 0 || data.MatchedBlockCount == 0 || data.MatchedRootCount == 0 || data.PageCount == 0 {
					t.Fatalf("search lost accessible matches: %+v", data)
				}
			}
		})
	}

	blockBody := fmt.Sprintf(`{"id":%q}`, blockID)
	attrOf := func(role model.Role, label string) map[string]any {
		t.Helper()
		return dataOf(call(role, "/api/attr/getBlockAttrs", blockBody, getBlockAttrs), label)
	}
	readerAttrs := attrOf(model.RoleReader, "reader getBlockAttrs")
	if memo, ok := readerAttrs["memo"]; ok {
		t.Fatalf("reader received the block memo attribute: %#v", memo)
	}
	if blockID != readerAttrs["id"] {
		t.Fatalf("reader getBlockAttrs lost the block id: %#v", readerAttrs)
	}
	adminAttrs := attrOf(model.RoleAdministrator, "administrator getBlockAttrs")
	if memoCanary != adminAttrs["memo"] || blockID != adminAttrs["id"] {
		t.Fatalf("administrator getBlockAttrs lost the block id or memo: %#v", adminAttrs)
	}

	batchBody := fmt.Sprintf(`{"ids":[%q]}`, blockID)
	batchAttrsOf := func(role model.Role, label string) map[string]any {
		t.Helper()
		data := dataOf(call(role, "/api/attr/batchGetBlockAttrs", batchBody, batchGetBlockAttrs), label)
		attrs, ok := data[blockID].(map[string]any)
		if !ok {
			t.Fatalf("%s returned no attrs for %s: %#v", label, blockID, data)
		}
		return attrs
	}
	if memo, ok := batchAttrsOf(model.RoleReader, "reader batchGetBlockAttrs")["memo"]; ok {
		t.Fatalf("reader received the block memo from batchGetBlockAttrs: %#v", memo)
	}
	if memo := batchAttrsOf(model.RoleAdministrator, "administrator batchGetBlockAttrs")["memo"]; memoCanary != memo {
		t.Fatalf("administrator lost the block memo from batchGetBlockAttrs: %#v", memo)
	}

	const kramdownPath = "/api/block/getBlockKramdown"
	kramdownOf := func(role model.Role, label string) string {
		t.Helper()
		data := dataOf(call(role, kramdownPath, blockBody, getBlockKramdown), label)
		kramdown, ok := data["kramdown"].(string)
		if !ok {
			t.Fatalf("%s returned no kramdown: %#v", label, data)
		}
		return kramdown
	}
	readerKramdown := kramdownOf(model.RoleReader, "reader getBlockKramdown")
	if strings.Contains(readerKramdown, memoCanary) {
		t.Fatalf("reader received the block memo in kramdown: %s", readerKramdown)
	}
	if !strings.Contains(readerKramdown, "broken reference") {
		t.Fatalf("reader kramdown lost visible content: %s", readerKramdown)
	}
	adminKramdown := kramdownOf(model.RoleAdministrator, "administrator getBlockKramdown")
	if !strings.Contains(adminKramdown, memoCanary) || !strings.Contains(adminKramdown, "broken reference") {
		t.Fatalf("administrator kramdown lost visible content or memo: %s", adminKramdown)
	}

	kramdownsOf := func(role model.Role, label string) string {
		t.Helper()
		data := dataOf(call(role, "/api/block/getBlockKramdowns", batchBody, getBlockKramdowns), label)
		kramdown, ok := data[blockID].(string)
		if !ok {
			t.Fatalf("%s returned no kramdown for %s: %#v", label, blockID, data)
		}
		return kramdown
	}
	if readerKramdowns := kramdownsOf(model.RoleReader, "reader getBlockKramdowns"); strings.Contains(readerKramdowns, memoCanary) || !strings.Contains(readerKramdowns, "broken reference") {
		t.Fatalf("reader getBlockKramdowns content is wrong: %s", readerKramdowns)
	}
	if adminKramdowns := kramdownsOf(model.RoleAdministrator, "administrator getBlockKramdowns"); !strings.Contains(adminKramdowns, memoCanary) || !strings.Contains(adminKramdowns, "broken reference") {
		t.Fatalf("administrator getBlockKramdowns content is wrong: %s", adminKramdowns)
	}

	const backlinkPath = "/api/ref/getBacklink2"
	backlinks := func(role model.Role) map[string]any {
		body := fmt.Sprintf(`{"id":%q,"k":"","mk":"","includeMentions":false}`, docID)
		return dataOf(call(role, backlinkPath, body, getBacklink2), backlinkPath)
	}
	if data := backlinks(model.RoleReader); data["box"] != boxID {
		t.Fatalf("reader lost the published backlink target: %#v", data)
	}
	if err := model.SetPublishAccess(model.PublishAccess{{ID: docID, Disable: true}}); err != nil {
		t.Fatal(err)
	}
	for _, role := range []model.Role{model.RoleReader, model.RoleVisitor} {
		data := backlinks(role)
		for _, key := range []string{"backlinks", "backmentions"} {
			if list, ok := data[key].([]any); !ok || len(list) != 0 {
				t.Fatalf("role %d received %s for a disabled target: %#v", role, key, data)
			}
		}
		if data["box"] != "" || data["linkRefsCount"] != float64(0) || data["mentionsCount"] != float64(0) {
			t.Fatalf("role %d received metadata for a disabled target: %#v", role, data)
		}
	}
	if data := backlinks(model.RoleAdministrator); data["box"] != boxID {
		t.Fatalf("administrator lost metadata for the backlink target: %#v", data)
	}
}
