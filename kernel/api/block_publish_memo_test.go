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
	"github.com/88250/lute/parse"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestReaderRenderWithoutMemos(t *testing.T) {
	const helper = "SIYUAN_TEST_READER_DOM_MEMOS"
	if os.Getenv(helper) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestReaderRenderWithoutMemos$", "-test.v")
		command.Env = append(os.Environ(), helper+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("reader render subprocess failed: %v\n%s", err, output)
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
		boxID       = "20261117000000-boxmemo"
		docID       = "20261117000001-docmemo"
		headingID   = "20261117000002-headmem"
		paragraphID = "20261117000003-parmemo"
		quoteID     = "20261117000004-bqtmemo"
		embedDocID  = "20261117000005-embdocs"
		embedID     = "20261117000006-embmemo"
		visibleText = "visible paragraph text"
		memoLabel   = "annotated label"
		inlineMemo  = "private inline note"
		blockMemo   = "private paragraph note"
		quoteMemo   = "private blockquote note"
	)

	box := &model.Box{ID: boxID}
	boxConf := conf.NewBoxConf()
	boxConf.Name = "Reader DOM memos"
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatalf("save box conf: %v", err)
	}

	tree := treenode.NewTree(boxID, "/"+docID+".sy", "/"+docID, docID)
	tree.Root.FirstChild.Unlink()
	heading := &ast.Node{Type: ast.NodeHeading, ID: headingID, HeadingLevel: 1}
	heading.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("heading text")})
	paragraph := treenode.NewParagraph(paragraphID)
	paragraph.SetIALAttr("memo", blockMemo)
	paragraph.SetIALAttr("custom-example", "visible attribute")
	paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(visibleText)})
	paragraph.AppendChild(&ast.Node{
		Type:                      ast.NodeTextMark,
		TextMarkType:              "inline-memo",
		TextMarkTextContent:       memoLabel,
		TextMarkInlineMemoContent: inlineMemo,
	})
	quote := &ast.Node{Type: ast.NodeBlockquote, ID: quoteID}
	quote.SetIALAttr("memo", quoteMemo)
	quote.AppendChild(&ast.Node{Type: ast.NodeBlockquoteMarker, Tokens: []byte(">")})
	quote.AppendChild(paragraph)
	tree.Root.AppendChild(heading)
	tree.Root.AppendChild(quote)

	embedTree := treenode.NewTree(boxID, "/"+embedDocID+".sy", "/"+embedDocID, embedDocID)
	embedTree.Root.FirstChild.Unlink()
	embed := &ast.Node{Type: ast.NodeBlockQueryEmbed, ID: embedID}
	embed.AppendChild(&ast.Node{Type: ast.NodeBlockQueryEmbedScript,
		Tokens: []byte(fmt.Sprintf("SELECT * FROM blocks WHERE id IN ('%s', '%s', '%s')", docID, headingID, paragraphID))})
	embedTree.Root.AppendChild(embed)
	for _, document := range []*parse.Tree{tree, embedTree} {
		if _, err := filesys.WriteTree(document); err != nil {
			t.Fatalf("write tree: %v", err)
		}
		treenode.IndexBlockTree(document)
		sql.IndexTreeQueue(document)
	}
	sql.FlushQueue()

	if err := model.SetPublishAccess(model.PublishAccess{{ID: docID, Visible: true}, {ID: embedDocID, Visible: true}}); err != nil {
		t.Fatalf("set publish access: %v", err)
	}

	post := func(role model.Role, path, body string, handler gin.HandlerFunc) map[string]any {
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
		return response
	}

	readerCheck := func(name string, response map[string]any, dom string) {
		t.Helper()
		if response["code"] != float64(0) {
			t.Fatalf("%s failed: %v", name, response)
		}
		if strings.Contains(dom, inlineMemo) || strings.Contains(dom, blockMemo) || strings.Contains(dom, quoteMemo) ||
			strings.Contains(dom, ` memo="`) || strings.Contains(dom, "protyle-attr--memo") {
			t.Fatalf("%s retained private memo metadata: %s", name, dom)
		}
		if !strings.Contains(dom, visibleText) || !strings.Contains(dom, memoLabel) ||
			!strings.Contains(dom, `custom-example="visible attribute"`) {
			t.Fatalf("%s dropped visible block data: %s", name, dom)
		}
	}

	docBody := fmt.Sprintf(`{"id":%q}`, docID)
	blockBody := fmt.Sprintf(`{"id":%q}`, quoteID)
	blocksBody := fmt.Sprintf(`{"ids":[%q,%q]}`, quoteID, paragraphID)
	headingBody := fmt.Sprintf(`{"id":%q,"removeFoldAttr":true}`, headingID)

	getDocResponse := post(model.RoleReader, "/api/filetree/getDoc", docBody, getDoc)
	docContent, _ := getDocResponse["data"].(map[string]any)["content"].(string)
	readerCheck("getDoc", getDocResponse, docContent)

	getBlockDOMResponse := post(model.RoleReader, "/api/block/getBlockDOM", blockBody, getBlockDOM)
	blockDOM, _ := getBlockDOMResponse["data"].(map[string]any)["dom"].(string)
	readerCheck("getBlockDOM", getBlockDOMResponse, blockDOM)

	getBlockDOMsResponse := post(model.RoleReader, "/api/block/getBlockDOMs", blocksBody, getBlockDOMs)
	blockDOMs, _ := getBlockDOMsResponse["data"].(map[string]any)
	readerCheck("getBlockDOMs (blockquote)", getBlockDOMsResponse, fmt.Sprint(blockDOMs[quoteID]))
	readerCheck("getBlockDOMs", getBlockDOMsResponse, fmt.Sprint(blockDOMs[paragraphID]))

	getBlockDOMWithEmbedResponse := post(model.RoleReader, "/api/block/getBlockDOMWithEmbed", blockBody, getBlockDOMWithEmbed)
	blockDOMWithEmbed, _ := getBlockDOMWithEmbedResponse["data"].(map[string]any)["dom"].(string)
	readerCheck("getBlockDOMWithEmbed", getBlockDOMWithEmbedResponse, blockDOMWithEmbed)

	getBlockDOMsWithEmbedResponse := post(model.RoleReader, "/api/block/getBlockDOMsWithEmbed", blocksBody, getBlockDOMsWithEmbed)
	blockDOMsWithEmbed, _ := getBlockDOMsWithEmbedResponse["data"].(map[string]any)
	readerCheck("getBlockDOMsWithEmbed (blockquote)", getBlockDOMsWithEmbedResponse, fmt.Sprint(blockDOMsWithEmbed[quoteID]))
	readerCheck("getBlockDOMsWithEmbed", getBlockDOMsWithEmbedResponse, fmt.Sprint(blockDOMsWithEmbed[paragraphID]))
	embedBody := fmt.Sprintf(`{"id":%q}`, embedID)
	embedResponse := post(model.RoleReader, "/api/block/getBlockDOMWithEmbed", embedBody, getBlockDOMWithEmbed)
	embedDOM, _ := embedResponse["data"].(map[string]any)["dom"].(string)
	readerCheck("getBlockDOMWithEmbed (query results)", embedResponse, embedDOM)
	if count := strings.Count(embedDOM, visibleText); count != 3 {
		t.Fatalf("expected document, heading and paragraph query results, got %d: %s", count, embedDOM)
	}

	getHeadingChildrenDOMResponse := post(model.RoleReader, "/api/block/getHeadingChildrenDOM", headingBody, getHeadingChildrenDOM)
	headingChildrenDOM, _ := getHeadingChildrenDOMResponse["data"].(string)
	readerCheck("getHeadingChildrenDOM", getHeadingChildrenDOMResponse, headingChildrenDOM)

	adminDOMResponse := post(model.RoleAdministrator, "/api/block/getBlockDOM", blockBody, getBlockDOM)
	adminDOM, _ := adminDOMResponse["data"].(map[string]any)["dom"].(string)
	if adminDOMResponse["code"] != float64(0) || !strings.Contains(adminDOM, inlineMemo) ||
		!strings.Contains(adminDOM, `memo="`+blockMemo+`"`) || !strings.Contains(adminDOM, `aria-label="`+blockMemo+`"`) ||
		!strings.Contains(adminDOM, `memo="`+quoteMemo+`"`) {
		t.Fatalf("administrator DOM must keep memo metadata: %s", adminDOM)
	}
	adminEmbedResponse := post(model.RoleAdministrator, "/api/block/getBlockDOMWithEmbed", embedBody, getBlockDOMWithEmbed)
	adminEmbedDOM, _ := adminEmbedResponse["data"].(map[string]any)["dom"].(string)
	if adminEmbedResponse["code"] != float64(0) || strings.Count(adminEmbedDOM, `memo="`+blockMemo+`"`) != 3 ||
		!strings.Contains(adminEmbedDOM, inlineMemo) {
		t.Fatalf("administrator DOM must keep memos in query results: %s", adminEmbedDOM)
	}
}
