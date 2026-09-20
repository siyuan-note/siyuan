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

// refIDsDocInfo 只保留断言需要的字段，getDocInfo 下发单个对象，getDocsInfo 下发数组。
type refIDsDocInfo struct {
	ID       string   `json:"id"`
	RefCount int      `json:"refCount"`
	RefIDs   []string `json:"refIDs"`
}

func parseRefIDsDocInfos(t *testing.T, name, body string) []refIDsDocInfo {
	t.Helper()

	response := &struct {
		Code int             `json:"code"`
		Data json.RawMessage `json:"data"`
	}{}
	if err := json.Unmarshal([]byte(body), response); nil != err {
		t.Fatalf("unmarshal %s response failed: %v, body: %s", name, err, body)
	}
	if 0 != response.Code {
		t.Fatalf("unexpected %s response code [%d]: %s", name, response.Code, body)
	}

	var single refIDsDocInfo
	if err := json.Unmarshal(response.Data, &single); nil == err {
		return []refIDsDocInfo{single}
	}
	var batch []refIDsDocInfo
	if err := json.Unmarshal(response.Data, &batch); nil != err {
		t.Fatalf("unmarshal %s response data failed: %v, body: %s", name, err, body)
	}
	return batch
}

// TestGetDocInfoRefIDsPublishAccess 验证读者请求发布可见文档时，反链块 ID 与引用数
// 不包含禁止发布、密码保护文档中的引用块，同时保留读者可见的反链计数。
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-v758-8w88-pfr2
func TestGetDocInfoRefIDsPublishAccess(t *testing.T) {
	previousConf := model.Conf
	previousWorkspaceDir, previousConfDir, previousDataDir := util.WorkspaceDir, util.ConfDir, util.DataDir
	previousTempDir, previousDBPath, previousBlockTreeDBPath := util.TempDir, util.DBPath, util.BlockTreeDBPath
	previousHistoryDBPath, previousAssetContentDBPath := util.HistoryDBPath, util.AssetContentDBPath

	root := t.TempDir()
	t.Cleanup(func() {
		sql.CloseDatabase()
		treenode.CloseDatabase()
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
	model.Conf.FileTree = conf.NewFileTree()
	model.Conf.Editor = conf.NewEditor()
	model.Conf.Export = conf.NewExport()
	model.Conf.Search = conf.NewSearch()
	model.Conf.NotebookCrypto = conf.NewNotebookCrypto()
	model.Conf.Sync = conf.NewSync()

	const (
		boxID             = "20260919000000-boxid01"
		publicDocID       = "20260919000001-public1"
		publicBlockID     = "20260919000002-publblk1"
		disabledDocID     = "20260919000003-disable"
		disabledBlockID   = "20260919000004-disblk1"
		protectedDocID    = "20260919000005-protect"
		protectedBlockID  = "20260919000006-protblk"
		visibleDocID      = "20260919000007-visible"
		visibleBlockID    = "20260919000008-visblk1"
		protectedPassword = "protected-password"
	)

	box := &model.Box{ID: boxID}
	boxConf := conf.NewBoxConf()
	boxConf.Name = "Publish ref IDs"
	boxConf.Closed = false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}

	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	treenode.InitBlockTree(true)

	previousPublishAccess := model.GetPublishAccess()
	if err := model.SetPublishAccess(model.PublishAccess{
		{ID: disabledDocID, Disable: true},
		{ID: protectedDocID, Password: protectedPassword},
	}); err != nil {
		t.Fatalf("set publish access failed: %v", err)
	}
	t.Cleanup(func() { _ = model.SetPublishAccess(previousPublishAccess) })

	// 建立文档树：禁止发布与密码保护文档中的段落反链公开文档中的段落，
	// 另有发布可见文档中的段落同样反链公开文档，用于确认可见反链未被一并过滤
	addDoc := func(docID, title, blockID, refDefID, content string) {
		tree := treenode.NewTree(boxID, "/"+docID+".sy", "/"+title, title)
		tree.Root.FirstChild.Unlink()
		paragraph := &ast.Node{Type: ast.NodeParagraph, ID: blockID}
		paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(content)})
		if "" != refDefID {
			paragraph.AppendChild(&ast.Node{
				Type:                    ast.NodeTextMark,
				TextMarkType:            "block-ref",
				TextMarkBlockRefID:      refDefID,
				TextMarkBlockRefSubtype: "s",
				TextMarkTextContent:     refDefID,
			})
		}
		tree.Root.AppendChild(paragraph)
		treenode.IndexBlockTree(tree)
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		sql.IndexTreeQueue(tree)
	}

	addDoc(publicDocID, "Public", publicBlockID, "", "public content")
	addDoc(disabledDocID, "Disabled", disabledBlockID, publicBlockID, "disabled secret ")
	addDoc(protectedDocID, "Password", protectedBlockID, publicBlockID, "password secret ")
	addDoc(visibleDocID, "Visible", visibleBlockID, publicBlockID, "visible content ")
	sql.FlushQueue()

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(boxLeaseMiddleware)
	engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleReader); c.Next() })
	engine.POST("/api/block/getDocInfo", getDocInfo)
	engine.POST("/api/block/getDocsInfo", getDocsInfo)

	post := func(path, body string) string {
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, request)
		return recorder.Body.String()
	}

	// 两个端点下发给读者的反链都必须剔除不可访问文档中的块，只保留发布可见的反链
	for _, testCase := range []struct {
		name     string
		endpoint string
		body     string
	}{
		{"getDocInfo", "/api/block/getDocInfo", `{"id":"` + publicDocID + `"}`},
		{"getDocsInfo", "/api/block/getDocsInfo", `{"ids":["` + publicDocID + `"],"refCount":true,"av":true}`},
	} {
		body := post(testCase.endpoint, testCase.body)
		docInfos := parseRefIDsDocInfos(t, testCase.name, body)
		if 1 != len(docInfos) {
			t.Fatalf("unexpected %s response: %s", testCase.name, body)
		}

		docInfo := docInfos[0]
		for _, hiddenRefID := range []string{disabledBlockID, protectedBlockID} {
			if strings.Contains(body, hiddenRefID) {
				t.Fatalf("%s disclosed block ID [%s] of an inaccessible document: %s", testCase.name, hiddenRefID, body)
			}
		}
		if 1 != len(docInfo.RefIDs) || visibleBlockID != docInfo.RefIDs[0] {
			t.Fatalf("%s ref IDs = %v, want only the published backlink [%s]: %s",
				testCase.name, docInfo.RefIDs, visibleBlockID, body)
		}
		if 1 != docInfo.RefCount {
			t.Fatalf("%s ref count = %d, want only the published backlink counted: %s", testCase.name, docInfo.RefCount, body)
		}
	}

	// 读者请求禁止发布文档本身仍应被拒绝
	body := post("/api/block/getDocInfo", `{"id":"`+disabledDocID+`"}`)
	if !strings.Contains(body, `"code":-1`) {
		t.Fatalf("reader should not read a publish-disabled document: %s", body)
	}
}
