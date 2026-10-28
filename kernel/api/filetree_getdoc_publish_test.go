// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
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

// getDocPublishProbe 只保留断言需要的字段。
type getDocPublishProbe struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Data struct {
		Content               string   `json:"content"`
		Keywords              []string `json:"keywords"`
		PublishAccessRequired bool     `json:"publishAccessRequired"`
	} `json:"data"`
}

// containsKeyword 判断检索片段中是否包含指定文本。
func containsKeyword(keywords []string, text string) bool {
	for _, keyword := range keywords {
		if strings.Contains(keyword, text) {
			return true
		}
	}
	return false
}

// TestGetDocKeywordsPublishAccess 验证读者请求密码保护或禁止发布的文档时，
// getDoc 不通过 keywords 返回正文检索片段，同时确认发布可见文档的检索片段不受影响。
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-qf37-w288-frvq
func TestGetDocKeywordsPublishAccess(t *testing.T) {
	previousConf := model.Conf
	previousWorkspaceDir, previousConfDir, previousDataDir := util.WorkspaceDir, util.ConfDir, util.DataDir
	previousTempDir, previousDBPath, previousBlockTreeDBPath := util.TempDir, util.DBPath, util.BlockTreeDBPath
	previousHistoryDBPath, previousAssetContentDBPath := util.HistoryDBPath, util.AssetContentDBPath

	root := t.TempDir()
	t.Cleanup(func() {
		model.Conf = previousConf
		util.WorkspaceDir, util.ConfDir, util.DataDir = previousWorkspaceDir, previousConfDir, previousDataDir
		util.TempDir, util.DBPath, util.BlockTreeDBPath = previousTempDir, previousDBPath, previousBlockTreeDBPath
		util.HistoryDBPath, util.AssetContentDBPath = previousHistoryDBPath, previousAssetContentDBPath
	})

	util.WorkspaceDir = root
	util.ConfDir = filepath.Join(root, "conf")
	util.DataDir = filepath.Join(root, "data")
	util.TempDir = filepath.Join(root, "temp")
	util.DBPath = filepath.Join(util.TempDir, "siyuan.db")
	util.HistoryDBPath = filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath = filepath.Join(util.TempDir, "asset_content.db")
	util.BlockTreeDBPath = filepath.Join(util.TempDir, "blocktree.db")
	for _, dir := range []string{util.ConfDir, util.DataDir, util.TempDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}

	model.Conf = model.NewAppConf()
	model.Conf.Lang = "en"
	model.Conf.FileTree.Store(conf.NewFileTree())
	model.Conf.Editor.Store(conf.NewEditor())
	model.Conf.Export.Store(conf.NewExport())
	model.Conf.Search.Store(conf.NewSearch())
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()
	model.Conf.Sync.Store(conf.NewSync())

	const (
		boxID              = "20261026000000-boxkw01"
		protectedDocID     = "20261026000001-dockw01"
		protectedBlockID   = "20261026000002-blkkw01"
		disabledDocID      = "20261026000003-dockw02"
		disabledBlockID    = "20261026000004-blkkw02"
		publicDocID        = "20261026000005-dockw03"
		publicBlockID      = "20261026000006-blkkw03"
		protectedPassword  = "probe-password"
		protectedSentinel  = "PROTECTED_SECRET_A1B2C3"
		disabledSentinel   = "DISABLED_SECRET_D4E5F6"
		visibleSentinel    = "VISIBLE_TEXT_A7B8C9"
		nonMatchingPattern = "^NO_MATCH_FOR_GETDOC_PROBE_8592$"
		broadRegexp        = `(?s)(?:.+)`
	)

	box := &model.Box{ID: boxID}
	boxConf := conf.NewBoxConf()
	boxConf.Name = "getDoc keywords publish access"
	boxConf.Closed = false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}

	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	treenode.InitBlockTree(true)
	t.Cleanup(func() {
		sql.CloseDatabase()
		treenode.CloseDatabase()
	})

	previousPublishAccess := model.GetPublishAccess()
	if err := model.SetPublishAccess(model.PublishAccess{
		{ID: protectedDocID, Visible: true, Password: protectedPassword},
		{ID: disabledDocID, Disable: true},
	}); err != nil {
		t.Fatalf("set publish access failed: %v", err)
	}
	t.Cleanup(func() { _ = model.SetPublishAccess(previousPublishAccess) })

	addDoc := func(docID, title, blockID, content string) {
		tree := treenode.NewTree(boxID, "/"+docID+".sy", "/"+title, title)
		tree.Root.FirstChild.Unlink()
		paragraph := &ast.Node{Type: ast.NodeParagraph, ID: blockID}
		paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(content)})
		tree.Root.AppendChild(paragraph)
		treenode.IndexBlockTree(tree)
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		sql.IndexTreeQueue(tree)
	}
	addDoc(protectedDocID, "Protected", protectedBlockID, protectedSentinel)
	addDoc(disabledDocID, "Disabled", disabledBlockID, disabledSentinel)
	addDoc(publicDocID, "Public", publicBlockID, visibleSentinel)
	sql.FlushQueue()

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(boxLeaseMiddleware)
	engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleReader); c.Next() })
	engine.POST("/api/filetree/getDoc", getDoc)

	protectedAuthCookie := &http.Cookie{
		Name:  "publish-auth-" + protectedDocID,
		Value: util.SHA256Hash([]byte(protectedDocID + protectedPassword)),
	}

	tests := []struct {
		name                  string
		docID                 string
		query                 string
		queryMethod           int
		cookie                *http.Cookie
		wantGate              string
		wantPasswordRequired  bool
		wantKeyword           string
		wantSentinelInContent string
	}{
		{"protected regex", protectedDocID, broadRegexp, 3, nil, "protyle-password", true, "", ""},
		{"protected control", protectedDocID, nonMatchingPattern, 3, nil, "protyle-password", true, "", ""},
		{"protected fts", protectedDocID, protectedSentinel, 1, nil, "protyle-password", true, "", ""},
		{"protected authorized", protectedDocID, broadRegexp, 3, protectedAuthCookie, "", false, protectedSentinel, protectedSentinel},
		{"disabled regex", disabledDocID, broadRegexp, 3, nil, "protyle-password--forbidden", false, "", ""},
		{"visible regex", publicDocID, broadRegexp, 3, nil, "", false, visibleSentinel, visibleSentinel},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			body, err := json.Marshal(map[string]any{
				"id":          test.docID,
				"query":       test.query,
				"queryMethod": test.queryMethod,
				"queryTypes":  map[string]bool{"paragraph": true},
			})
			if err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(http.MethodPost, "/api/filetree/getDoc", strings.NewReader(string(body)))
			request.Header.Set("Content-Type", "application/json")
			if nil != test.cookie {
				request.AddCookie(test.cookie)
			}
			recorder := httptest.NewRecorder()
			engine.ServeHTTP(recorder, request)

			response := getDocPublishProbe{}
			if err = json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatalf("decode response failed: %v, body: %s", err, recorder.Body.String())
			}
			if 0 != response.Code {
				t.Fatalf("unexpected response code [%d]: %s", response.Code, recorder.Body.String())
			}
			if test.wantPasswordRequired != response.Data.PublishAccessRequired {
				t.Fatalf("publishAccessRequired = %t, want %t: %s", response.Data.PublishAccessRequired, test.wantPasswordRequired, recorder.Body.String())
			}
			if "" != test.wantGate && !strings.Contains(response.Data.Content, test.wantGate) {
				t.Fatalf("content does not contain the publish gate [%s]: %s", test.wantGate, recorder.Body.String())
			}
			if "" == test.wantGate && strings.Contains(response.Data.Content, "protyle-password") {
				t.Fatalf("content should be readable but shows a publish gate: %s", recorder.Body.String())
			}
			if "" != test.wantSentinelInContent && !strings.Contains(response.Data.Content, test.wantSentinelInContent) {
				t.Fatalf("content does not contain the document body [%s]: %s", test.wantSentinelInContent, recorder.Body.String())
			}
			if "" != test.wantKeyword {
				if !containsKeyword(response.Data.Keywords, test.wantKeyword) {
					t.Fatalf("keywords do not contain the document body [%s]: %s", test.wantKeyword, recorder.Body.String())
				}
			} else if 0 != len(response.Data.Keywords) {
				t.Fatalf("keywords should be empty when publish access is restricted: %s", recorder.Body.String())
			}
		})
	}
}
