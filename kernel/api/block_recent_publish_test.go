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

// TestRecentUpdatedBlocksSkipsDeniedBeforeLimit 校验读者侧最近更新在截断前排除不可见文档，
// 被隐藏或密码保护的更新不能挤占固定窗口的最后一个位置。
func TestRecentUpdatedBlocksSkipsDeniedBeforeLimit(t *testing.T) {
	const helper = "SIYUAN_TEST_RECENT_UPDATED_PUBLISH"
	if os.Getenv(helper) != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestRecentUpdatedBlocksSkipsDeniedBeforeLimit$", "-test.v")
		command.Env = append(os.Environ(), helper+"=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("recent updated subprocess failed: %v\n%s", err, output)
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
		boxID         = "20261117000000-boxrec1"
		visibleDocID  = "20261117000001-visdoc1"
		deniedDocID   = "20261117000002-dendoc1"
		passwordDocID = "20261117000003-pwddoc1"
		deniedParaID  = "20261117029999-dp00001"
		passwordPara  = "20261117039999-pp00001"
	)

	box := &model.Box{ID: boxID}
	boxConf := conf.NewBoxConf()
	boxConf.Name = "Recent updated publish"
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatalf("save box conf: %v", err)
	}

	writeDoc := func(docID string, paragraphs map[string]string) {
		tree := treenode.NewTree(boxID, "/"+docID+".sy", "/"+docID, docID)
		tree.Root.FirstChild.Unlink()
		for paraID, updated := range paragraphs {
			paragraph := treenode.NewParagraph(paraID)
			paragraph.SetIALAttr("updated", updated)
			paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("recent text " + paraID)})
			tree.Root.AppendChild(paragraph)
		}
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatalf("write tree %s: %v", docID, err)
		}
		treenode.IndexBlockTree(tree)
		sql.IndexTreeQueue(tree)
	}

	visibleParaIDs := make([]string, 0, 16)
	visibleParagraphs := map[string]string{}
	for i := 1; i <= 16; i++ {
		paraID := fmt.Sprintf("2026111701%04d-vp%05d", i, i)
		visibleParaIDs = append(visibleParaIDs, paraID)
		visibleParagraphs[paraID] = fmt.Sprintf("2026010100%04d", i)
	}
	writeDoc(visibleDocID, visibleParagraphs)
	writeDoc(deniedDocID, map[string]string{deniedParaID: "20260101000098"})
	writeDoc(passwordDocID, map[string]string{passwordPara: "20260101000099"})
	sql.FlushQueue()

	if err := model.SetPublishAccess(model.PublishAccess{
		{ID: deniedDocID, Disable: true},
		{ID: passwordDocID, Password: "secret"},
	}); err != nil {
		t.Fatalf("set publish access: %v", err)
	}

	post := func(role model.Role) []string {
		t.Helper()
		gin.SetMode(gin.TestMode)
		engine := gin.New()
		engine.Use(func(c *gin.Context) {
			c.Set(model.RoleContextKey, role)
			c.Next()
		})
		engine.POST("/api/block/getRecentUpdatedBlocks",
			contractRouteHandlers(apicontract.GetRecentUpdatedBlocks, getRecentUpdatedBlocks)...)
		recorder := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/api/block/getRecentUpdatedBlocks", strings.NewReader("{}"))
		request.Header.Set("Content-Type", "application/json")
		engine.ServeHTTP(recorder, request)

		var response struct {
			Code int `json:"code"`
			Data []struct {
				ID string `json:"id"`
			} `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
			t.Fatalf("decode response: %v body=%s", err, recorder.Body.String())
		}
		if 0 != response.Code {
			t.Fatalf("response code = %d, body=%s", response.Code, recorder.Body.String())
		}
		ids := make([]string, 0, len(response.Data))
		for _, block := range response.Data {
			ids = append(ids, block.ID)
		}
		return ids
	}

	readerIDs := post(model.RoleReader)
	if 16 != len(readerIDs) {
		t.Fatalf("reader returned %d blocks, want 16: %v", len(readerIDs), readerIDs)
	}
	readerSet := map[string]bool{}
	for _, id := range readerIDs {
		readerSet[id] = true
	}
	if readerSet[deniedParaID] || readerSet[passwordPara] {
		t.Fatalf("reader received denied block: %v", readerIDs)
	}
	if !readerSet[visibleParaIDs[0]] {
		t.Fatalf("reader lost the oldest visible block: %v", readerIDs)
	}
	if readerIDs[0] != visibleParaIDs[len(visibleParaIDs)-1] {
		t.Fatalf("reader first block = %q, want %q", readerIDs[0], visibleParaIDs[len(visibleParaIDs)-1])
	}

	adminIDs := post(model.RoleAdministrator)
	if 16 != len(adminIDs) {
		t.Fatalf("administrator returned %d blocks, want 16: %v", len(adminIDs), adminIDs)
	}
	if adminIDs[0] != passwordPara {
		t.Fatalf("administrator first block = %q, want %q", adminIDs[0], passwordPara)
	}
	adminSet := map[string]bool{}
	for _, id := range adminIDs {
		adminSet[id] = true
	}
	if !adminSet[deniedParaID] {
		t.Fatalf("administrator lost denied block: %v", adminIDs)
	}
}
