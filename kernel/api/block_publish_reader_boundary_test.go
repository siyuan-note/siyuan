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
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestPublishReaderBoundary(t *testing.T) {
	const helper = "SIYUAN_TEST_PUBLISH_READER_BOUNDARY"
	if os.Getenv(helper) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestPublishReaderBoundary$", "-test.v")
		command.Env = append(os.Environ(), helper+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("reader boundary subprocess failed: %v\n%s", err, output)
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
		boxID       = "20261119000000-boxread"
		docID       = "20261119000001-docread"
		paragraphID = "20261119000002-parmemo"
		protID      = "20261119000003-docprot"
		visibleText = "visible paragraph text"
		memoCanary  = "INLINE-MEMO-CANARY-4c7a1d"
		protTitle   = "Protected Canary Doc"
		titleLabel  = "Visible title"
		titleMemo   = "Private title memo"
	)

	box := &model.Box{ID: boxID}
	boxConf := conf.NewBoxConf()
	boxConf.Name = "Reader boundary"
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatalf("save box conf: %v", err)
	}

	tree := treenode.NewTree(boxID, "/"+docID+".sy", "/"+docID, "Public Source Doc")
	titleParagraph := &ast.Node{Type: ast.NodeParagraph}
	titleParagraph.AppendChild(&ast.Node{
		Type:                      ast.NodeTextMark,
		TextMarkType:              "strong inline-memo",
		TextMarkTextContent:       titleLabel,
		TextMarkInlineMemoContent: titleMemo,
	})
	if err := treenode.SetDocumentTitleParagraph(tree.Root, titleParagraph); err != nil {
		t.Fatal(err)
	}
	tree.Root.FirstChild.Unlink()
	paragraph := treenode.NewParagraph(paragraphID)
	paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(visibleText)})
	paragraph.AppendChild(&ast.Node{
		Type:                      ast.NodeTextMark,
		TextMarkType:              "inline-memo",
		TextMarkTextContent:       "annotated label",
		TextMarkInlineMemoContent: memoCanary,
	})
	tree.Root.AppendChild(paragraph)
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatalf("write tree: %v", err)
	}
	treenode.IndexBlockTree(tree)
	sql.IndexTreeQueue(tree)

	protTree := treenode.NewTree(boxID, "/"+protID+".sy", "/"+protID, protTitle)
	protTree.Root.FirstChild.Unlink()
	protParagraph := treenode.NewParagraph(ast.NewNodeID())
	protParagraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("protected body")})
	protTree.Root.AppendChild(protParagraph)
	if _, err := filesys.WriteTree(protTree); err != nil {
		t.Fatalf("write protected tree: %v", err)
	}
	treenode.IndexBlockTree(protTree)
	sql.IndexTreeQueue(protTree)
	sql.FlushQueue()

	if err := model.SetPublishAccess(model.PublishAccess{
		{ID: docID, Visible: true},
		{ID: protID, Visible: false},
	}); err != nil {
		t.Fatalf("set publish access: %v", err)
	}

	postAs := func(role model.Role, path, body string, handler gin.HandlerFunc) *httptest.ResponseRecorder {
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
		return recorder
	}
	post := func(path, body string, handler gin.HandlerFunc) map[string]any {
		t.Helper()
		recorder := postAs(model.RoleReader, path, body, handler)
		var response map[string]any
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatalf("%s: invalid response %q: %v", path, recorder.Body.String(), err)
		}
		return response
	}

	t.Run("DocumentTitleContract", func(t *testing.T) {
		const route = "/api/block/getDocTitle"
		body := fmt.Sprintf(`{"id":%q,"notebook":%q}`, docID, boxID)
		for _, role := range []model.Role{model.RoleReader, model.RoleVisitor, model.RoleEditor, model.RoleAdministrator} {
			recorder := postAs(role, route, body, getDocTitle)
			requireAPIContract(t, http.MethodPost, route, recorder)
			var response struct {
				Code int
				Data apicontract.DocumentTitleData
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
				t.Fatalf("title read for role %d failed: code %d, %v", role, response.Code, err)
			}
			title := response.Data
			if title.Text != titleLabel || title.Format != "inline-ast" ||
				!strings.Contains(title.BlockDOM, titleLabel) || !strings.Contains(title.BlockDOM, "strong") {
				t.Fatalf("role %d lost the visible rich title", role)
			}
			if model.IsReadOnlyRole(role) {
				if title.Source != nil || title.Revision != "" || strings.Contains(recorder.Body.String(), titleMemo) {
					t.Fatalf("role %d received private title data", role)
				}
			} else if title.Source == nil || !strings.Contains(title.Source.Content, titleMemo) ||
				title.Revision == "" || !strings.Contains(title.BlockDOM, titleMemo) {
				t.Fatalf("role %d lost the editable title", role)
			}
		}
	})

	// 面包屑子块标签只保留可见文字
	children := post("/api/block/getBlockBreadcrumbChildren",
		fmt.Sprintf(`{"id":%q,"offset":0,"limit":64,"excludeTypes":[]}`, docID), getBlockBreadcrumbChildren)
	if children["code"] != float64(0) {
		t.Fatalf("getBlockBreadcrumbChildren failed: %v", children)
	}
	items, _ := children["data"].(map[string]any)["items"].([]any)
	if 1 > len(items) {
		t.Fatalf("breadcrumb children missing paragraph: %v", children)
	}
	names := fmt.Sprint(items)
	if strings.Contains(names, memoCanary) {
		t.Fatalf("breadcrumb children leaked inline memo: %s", names)
	}
	if !strings.Contains(names, visibleText) {
		t.Fatalf("breadcrumb children dropped visible text: %s", names)
	}

	// 受保护文档的标题命中与不存在必须同形
	hitProtected := post("/api/search/searchRefBlock",
		fmt.Sprintf(`{"id":%q,"rootID":%q,"k":%q,"beforeLen":32,"exactDocTitle":true,"reqId":1}`, docID, docID, protTitle), searchRefBlock)
	missing := post("/api/search/searchRefBlock",
		fmt.Sprintf(`{"id":%q,"rootID":%q,"k":"No Such Title","beforeLen":32,"exactDocTitle":true,"reqId":2}`, docID, docID), searchRefBlock)
	protData, _ := hitProtected["data"].(map[string]any)
	missingData, _ := missing["data"].(map[string]any)
	if hitProtected["code"] != float64(0) || missing["code"] != float64(0) {
		t.Fatalf("searchRefBlock failed: %v / %v", hitProtected, missing)
	}
	if protData["newDoc"] != true {
		t.Fatalf("protected title is distinguishable from a missing title: %v", protData)
	}
	if protData["newDoc"] != missingData["newDoc"] {
		t.Fatalf("newDoc differs between protected and missing title: %v vs %v", protData, missingData)
	}

	// 深层 BlockDOM 在进入解析器前被有界拒绝，普通文本仍可统计
	deep := strings.Repeat("<div>", 300) + "x" + strings.Repeat("</div>", 300)
	deepBody, _ := json.Marshal(map[string]any{"content": deep})
	deepResponse := post("/api/block/getContentWordCount", string(deepBody), getContentWordCount)
	if deepResponse["code"] != float64(-1) {
		t.Fatalf("deeply nested content was not rejected: %v", deepResponse)
	}

	flatBody, _ := json.Marshal(map[string]any{"content": strings.Repeat("x", 1<<20)})
	flatResponse := post("/api/block/getContentWordCount", string(flatBody), getContentWordCount)
	if flatResponse["code"] != float64(0) {
		t.Fatalf("flat content was rejected: %v", flatResponse)
	}
}
