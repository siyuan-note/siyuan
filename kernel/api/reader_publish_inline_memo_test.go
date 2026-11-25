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

// TestReaderBookmarkAndOutlineWithoutInlineMemo 校验读者书签与大纲响应不输出行级备注内容，
// 同时保留可见文字；管理员响应继续保留备注，避免影响编辑器。
func TestReaderBookmarkAndOutlineWithoutInlineMemo(t *testing.T) {
	const helper = "SIYUAN_TEST_READER_MEMO_FREE_CONTENT"
	if os.Getenv(helper) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestReaderBookmarkAndOutlineWithoutInlineMemo$", "-test.v")
		command.Env = append(os.Environ(), helper+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("reader memo subprocess failed: %v\n%s", err, output)
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
		boxID       = "20261122000000-boxbmk1"
		docID       = "20261122000001-docbmk1"
		headingID   = "20261122000002-hdgbmk1"
		blockID     = "20261122000003-blkbmk1"
		headingText = "HEADING_TEXT_MARKER"
		visibleText = "BOOKMARK_BODY_MARKER"
		memoLabel   = "annotated label"
		memoCanary  = "PRIVATE_INLINE_MEMO_CANARY_8d3e41"
	)

	box := &model.Box{ID: boxID}
	boxConf := conf.NewBoxConf()
	boxConf.Name = "Reader memo content"
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatalf("save box conf: %v", err)
	}

	inlineMemo := func() *ast.Node {
		return &ast.Node{
			Type:                      ast.NodeTextMark,
			TextMarkType:              "inline-memo",
			TextMarkTextContent:       memoLabel,
			TextMarkInlineMemoContent: memoCanary,
		}
	}
	tree := treenode.NewTree(boxID, "/"+docID+".sy", "/"+docID, docID)
	tree.Root.FirstChild.Unlink()
	heading := &ast.Node{Type: ast.NodeHeading, ID: headingID, HeadingLevel: 1}
	heading.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(headingText)})
	heading.AppendChild(inlineMemo())
	paragraph := treenode.NewParagraph(blockID)
	paragraph.SetIALAttr("bookmark", "label")
	paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(visibleText)})
	paragraph.AppendChild(inlineMemo())
	tree.Root.AppendChild(heading)
	tree.Root.AppendChild(paragraph)
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatalf("write tree: %v", err)
	}
	treenode.IndexBlockTree(tree)
	sql.IndexTreeQueue(tree)
	sql.FlushQueue()

	if err := model.SetPublishAccess(model.PublishAccess{{ID: docID, Visible: true}}); err != nil {
		t.Fatalf("set publish access: %v", err)
	}

	post := func(role model.Role, path, body string, handler gin.HandlerFunc) string {
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
		raw := recorder.Body.String()
		var response struct {
			Code int `json:"code"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != 0 {
			t.Fatalf("%s response failed: %s, %v", path, raw, err)
		}
		return raw
	}

	bookmarkBody := func(raw string) string {
		t.Helper()
		var response struct {
			Data []struct {
				Blocks []struct {
					Content string `json:"content"`
				} `json:"blocks"`
			} `json:"data"`
		}
		if err := json.Unmarshal([]byte(raw), &response); err != nil {
			t.Fatalf("decode bookmark response: %s, %v", raw, err)
		}
		if len(response.Data) != 1 || len(response.Data[0].Blocks) != 1 {
			t.Fatalf("unexpected bookmark response: %s", raw)
		}
		return response.Data[0].Blocks[0].Content
	}
	outlineBody := func(raw string) string {
		t.Helper()
		var response struct {
			Data []struct {
				Name string `json:"name"`
			} `json:"data"`
		}
		if err := json.Unmarshal([]byte(raw), &response); err != nil {
			t.Fatalf("decode outline response: %s, %v", raw, err)
		}
		for _, path := range response.Data {
			if strings.Contains(path.Name, headingText) {
				return path.Name
			}
		}
		t.Fatalf("outline response missing heading: %s", raw)
		return ""
	}

	readerBookmark := post(model.RoleReader, "/api/bookmark/getBookmark", "", getBookmark)
	if strings.Contains(readerBookmark, memoCanary) {
		t.Fatalf("reader bookmark leaked inline memo content: %s", readerBookmark)
	}
	readerBookmarkContent := bookmarkBody(readerBookmark)
	if !strings.Contains(readerBookmarkContent, visibleText) || !strings.Contains(readerBookmarkContent, memoLabel) {
		t.Fatalf("reader bookmark dropped visible text: %s", readerBookmarkContent)
	}
	adminBookmark := post(model.RoleAdministrator, "/api/bookmark/getBookmark", "", getBookmark)
	if !strings.Contains(adminBookmark, memoCanary) {
		t.Fatalf("administrator bookmark must keep inline memo content: %s", adminBookmark)
	}

	outlineRequest := fmt.Sprintf(`{"id":%q}`, docID)
	readerOutline := post(model.RoleReader, "/api/outline/getDocOutline", outlineRequest, getDocOutline)
	if strings.Contains(readerOutline, memoCanary) {
		t.Fatalf("reader outline leaked inline memo content: %s", readerOutline)
	}
	if content := outlineBody(readerOutline); !strings.Contains(content, headingText) || !strings.Contains(content, memoLabel) {
		t.Fatalf("reader outline dropped visible text: %s", content)
	}
	adminOutline := post(model.RoleAdministrator, "/api/outline/getDocOutline", outlineRequest, getDocOutline)
	if !strings.Contains(adminOutline, memoCanary) {
		t.Fatalf("administrator outline must keep inline memo content: %s", adminOutline)
	}
}
