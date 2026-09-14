//go:build (sqlcipher || libsqlcipher) && cgo

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
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
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

type blockedBlockResponseWriter struct {
	*httptest.ResponseRecorder
	ready   chan []byte
	proceed chan struct{}
}

func (w *blockedBlockResponseWriter) Write(data []byte) (int, error) {
	w.ready <- append([]byte(nil), data...)
	<-w.proceed
	return w.ResponseRecorder.Write(data)
}

func TestImplicitNotebookResponseLease(t *testing.T) {
	runNotebookResponseLease(t, false, false)
}

func TestContractBlockSwapReplayNotebookResponseLease(t *testing.T) {
	runNotebookResponseLease(t, false, true)
}

func TestContractRefIDsNotebookResponseLease(t *testing.T) {
	runNotebookResponseLease(t, true, false)
}

func TestContractCheckBlockRefNotebookResponseLease(t *testing.T) {
	runNotebookResponseLease(t, false, true)
}

func TestContractCheckBlockRefExplicitNotebookResponseLease(t *testing.T) {
	runNotebookResponseLease(t, true, false)
}

func TestContractCheckClosedNotebookRefNotebookResponseLease(t *testing.T) {
	runNotebookResponseLease(t, true, false)
}

func TestContractDocInfoNotebookResponseLease(t *testing.T) {
	runNotebookResponseLease(t, true, false)
}

func TestContractGetDocNotebookResponseLease(t *testing.T) {
	runNotebookResponseLease(t, true, false)
}

func TestContractTreeStatNotebookResponseLease(t *testing.T) {
	runNotebookResponseLease(t, false, false)
}

func TestContractBreadcrumbNotebookResponseLease(t *testing.T) {
	runNotebookResponseLease(t, true, false)
}

func TestContractBreadcrumbChildrenNotebookResponseLease(t *testing.T) {
	runNotebookResponseLease(t, false, false)
}

func TestContractTreeInfosNotebookResponseLease(t *testing.T) {
	runNotebookResponseLease(t, false, true)
}

func TestContractChildNotebookResponseLease(t *testing.T) {
	runNotebookResponseLease(t, false, false)
}

func TestContractTailChildNotebookResponseLease(t *testing.T) {
	runNotebookResponseLease(t, true, false)
}

func TestContractDOMNotebookResponseLease(t *testing.T) {
	runNotebookResponseLease(t, false, false)
}

func TestContractDOMsNotebookResponseLease(t *testing.T) {
	runNotebookResponseLease(t, false, true)
}

func TestContractEmbedDOMNotebookResponseLease(t *testing.T) {
	runNotebookResponseLease(t, true, false)
}

func TestContractEmbedDOMsNotebookResponseLease(t *testing.T) {
	runNotebookResponseLease(t, false, true)
}

func TestExplicitNotebookResponseLease(t *testing.T) {
	runNotebookResponseLease(t, true, false)
}

func TestBatchNotebookResponseLease(t *testing.T) {
	runNotebookResponseLease(t, false, true)
}

func TestGetBlockInfoNotebookResponseLease(t *testing.T) {
	runNotebookResponseLease(t, false, false)
}

func TestContractSiblingNotebookResponseLease(t *testing.T) {
	runNotebookResponseLease(t, false, false)
}

func TestContractBatchIndexesNotebookResponseLease(t *testing.T) {
	runNotebookResponseLease(t, false, true)
}

func runNotebookResponseLease(t *testing.T, explicitNotebook, batch bool) {
	t.Helper()
	if os.Getenv("SIYUAN_TEST_NOTEBOOK_RESPONSE_LEASE") == t.Name() {
		testNotebookResponseLease(t, explicitNotebook, batch)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, os.Args[0], "-test.run=^"+t.Name()+"$", "-test.v")
	command.Env = append(os.Environ(), "SIYUAN_TEST_NOTEBOOK_RESPONSE_LEASE="+t.Name())
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("response lease subprocess failed: %v\n%s", err, output)
	}
}

func testNotebookResponseLease(t *testing.T, explicitNotebook, batch bool) {
	root := t.TempDir()
	oldConf := model.Conf
	oldData, oldTemp, oldConfDir, oldHistory := util.DataDir, util.TempDir, util.ConfDir, util.HistoryDir
	oldQueue, oldDB, oldHistoryDB, oldAssetDB, oldBTDB := util.QueueDir, util.DBPath, util.HistoryDBPath, util.AssetContentDBPath, util.BlockTreeDBPath
	defer func() {
		model.Conf = oldConf
		util.DataDir, util.TempDir, util.ConfDir, util.HistoryDir = oldData, oldTemp, oldConfDir, oldHistory
		util.QueueDir, util.DBPath, util.HistoryDBPath, util.AssetContentDBPath, util.BlockTreeDBPath = oldQueue, oldDB, oldHistoryDB, oldAssetDB, oldBTDB
	}()
	util.DataDir, util.TempDir, util.ConfDir, util.HistoryDir = filepath.Join(root, "data"), filepath.Join(root, "temp"), filepath.Join(root, "conf"), filepath.Join(root, "history")
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath, util.HistoryDBPath, util.AssetContentDBPath, util.BlockTreeDBPath = filepath.Join(util.TempDir, util.DBName), filepath.Join(util.TempDir, "history.db"), filepath.Join(util.TempDir, "asset_content.db"), filepath.Join(util.TempDir, "blocktree.db")
	for _, dir := range []string{util.DataDir, util.TempDir, util.ConfDir, util.HistoryDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}
	model.Conf = model.NewAppConf()
	model.Conf.NotebookCrypto, model.Conf.Sync, model.Conf.FileTree = conf.NewNotebookCrypto(), conf.NewSync(), conf.NewFileTree()
	model.Conf.Editor, model.Conf.Export, model.Conf.Search = conf.NewEditor(), conf.NewExport(), conf.NewSearch()
	*model.Conf.FileTree.BoxDocEnabled = true
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	defer sql.CloseDatabase()
	if err := model.EnableEncryptedNotebook("review-password"); err != nil {
		t.Fatal(err)
	}
	count := 1
	if batch {
		count = 2
	}
	var boxIDs []string
	for range count {
		boxID, err := model.CreateEncryptedBox("Response lease", "review-password")
		if err != nil {
			t.Fatal(err)
		}
		defer model.LockBox(boxID)
		boxIDs = append(boxIDs, boxID)
		tree, err := filesys.LoadTree(boxID, "/"+boxID+".sy", util.NewLute())
		if err != nil {
			t.Fatal(err)
		}
		paragraph := &ast.Node{Type: ast.NodeParagraph, ID: ast.NewNodeID()}
		paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("REVIEW-SECRET-CONTENT")})
		tree.Root.AppendChild(paragraph)
		if t.Name() == "TestGetBlockInfoNotebookResponseLease" {
			tree.Root.SetIALAttr("title", "REVIEW-SECRET-CONTENT")
		}
		if _, err = filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
	}
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(boxLeaseMiddleware)
	engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleAdministrator); c.Next() })
	engine.POST("/api/block/getBlockKramdown", getBlockKramdown)
	engine.POST("/api/block/getRefIDs", getRefIDs)
	engine.POST("/api/block/checkBlockRef", checkBlockRef)
	engine.POST("/api/block/getDocInfo", getDocInfo)
	engine.POST("/api/filetree/getDoc", getDoc)
	engine.POST("/api/block/getTreeStat", getTreeStat)
	engine.POST("/api/block/getBlockBreadcrumb", getBlockBreadcrumb)
	engine.POST("/api/block/getBlockBreadcrumbChildren", getBlockBreadcrumbChildren)
	engine.POST("/api/block/getBlockTreeInfos", getBlockTreeInfos)
	engine.POST("/api/block/getChildBlocks", getChildBlocks)
	engine.POST("/api/block/getTailChildBlocks", getTailChildBlocks)
	engine.POST("/api/block/getBlockDOM", getBlockDOM)
	engine.POST("/api/block/getBlockDOMs", getBlockDOMs)
	engine.POST("/api/block/getBlockDOMWithEmbed", getBlockDOMWithEmbed)
	engine.POST("/api/block/getBlockDOMsWithEmbed", getBlockDOMsWithEmbed)
	engine.POST("/api/block/getBlockKramdowns", getBlockKramdowns)
	engine.POST("/api/block/getBlockInfo", getBlockInfo)
	engine.POST("/api/block/getBlockSiblingID", getBlockSiblingID)
	engine.POST("/api/block/getBlocksIndexes", getBlocksIndexes)
	engine.POST("/review/blockSwapLease", func(c *gin.Context) {
		tx := &model.Transaction{DoOperations: []*model.Operation{{Action: "swapBlockRef"}}}
		if err := holdBlockSwapReplayRequests(c, tx, boxIDs); err != nil {
			c.JSON(http.StatusOK, map[string]string{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, map[string]int{"code": 0})
	})
	writer := &blockedBlockResponseWriter{ResponseRecorder: httptest.NewRecorder(), ready: make(chan []byte, 1), proceed: make(chan struct{})}
	var releaseWriter sync.Once
	defer releaseWriter.Do(func() { close(writer.proceed) })
	args := map[string]any{"id": boxIDs[0]}
	if explicitNotebook {
		args["notebook"] = boxIDs[0]
	}
	endpoint := "/api/block/getBlockKramdown"
	if t.Name() == "TestGetBlockInfoNotebookResponseLease" {
		endpoint = "/api/block/getBlockInfo"
	}
	if batch {
		delete(args, "id")
		args["ids"] = boxIDs
		endpoint += "s"
	}
	typedQuery := false
	switch t.Name() {
	case "TestContractBlockSwapReplayNotebookResponseLease":
		endpoint, typedQuery = "/review/blockSwapLease", true
	case "TestContractCheckBlockRefNotebookResponseLease":
		endpoint, typedQuery = "/api/block/checkBlockRef", true
	case "TestContractCheckBlockRefExplicitNotebookResponseLease":
		endpoint, typedQuery = "/api/block/checkBlockRef", true
		args["ids"] = []string{boxIDs[0]}
	case "TestContractCheckClosedNotebookRefNotebookResponseLease":
		endpoint, typedQuery = "/api/block/checkBlockRef", true
		args["scope"] = "notebook"
	case "TestContractDocInfoNotebookResponseLease":
		endpoint, typedQuery = "/api/block/getDocInfo", true
	case "TestContractGetDocNotebookResponseLease":
		endpoint, typedQuery = "/api/filetree/getDoc", true
	case "TestContractTreeStatNotebookResponseLease":
		endpoint, typedQuery = "/api/block/getTreeStat", true
		args["includeEmbed"] = true
	case "TestContractBreadcrumbNotebookResponseLease":
		endpoint, typedQuery = "/api/block/getBlockBreadcrumb", true
	case "TestContractBreadcrumbChildrenNotebookResponseLease":
		endpoint, typedQuery = "/api/block/getBlockBreadcrumbChildren", true
	case "TestContractTreeInfosNotebookResponseLease":
		endpoint, typedQuery = "/api/block/getBlockTreeInfos", true
	case "TestContractRefIDsNotebookResponseLease":
		endpoint, typedQuery = "/api/block/getRefIDs", true
	case "TestContractChildNotebookResponseLease":
		endpoint, typedQuery = "/api/block/getChildBlocks", true
	case "TestContractTailChildNotebookResponseLease":
		endpoint, typedQuery = "/api/block/getTailChildBlocks", true
	case "TestContractDOMNotebookResponseLease":
		endpoint = "/api/block/getBlockDOM"
	case "TestContractDOMsNotebookResponseLease":
		endpoint = "/api/block/getBlockDOMs"
	case "TestContractEmbedDOMNotebookResponseLease":
		endpoint = "/api/block/getBlockDOMWithEmbed"
	case "TestContractEmbedDOMsNotebookResponseLease":
		endpoint = "/api/block/getBlockDOMsWithEmbed"
	case "TestContractSiblingNotebookResponseLease":
		endpoint, typedQuery = "/api/block/getBlockSiblingID", true
	case "TestContractBatchIndexesNotebookResponseLease":
		endpoint, typedQuery = "/api/block/getBlocksIndexes", true
	}
	requestBody, err := json.Marshal(args)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, endpoint, strings.NewReader(string(requestBody)))
	request.Header.Set("Content-Type", "application/json")
	responseDone := make(chan struct{})
	go func() { engine.ServeHTTP(writer, request); close(responseDone) }()
	var body []byte
	select {
	case body = <-writer.ready:
	case <-time.After(5 * time.Second):
		t.Fatal("response never reached writer")
	}
	if (!typedQuery || t.Name() == "TestContractGetDocNotebookResponseLease") && strings.Count(string(body), "REVIEW-SECRET-CONTENT") != count {
		releaseWriter.Do(func() { close(writer.proceed) })
		<-responseDone
		t.Fatalf("fixture did not produce plaintext: %s", body)
	}
	lockDone := make(chan string, len(boxIDs))
	for _, boxID := range boxIDs {
		go func() { model.LockBox(boxID); lockDone <- boxID }()
	}
	lockedBeforeResponse := false
	select {
	case <-lockDone:
		lockedBeforeResponse = true
	case <-time.After(300 * time.Millisecond):
	}
	releaseWriter.Do(func() { close(writer.proceed) })
	<-responseDone
	if typedQuery {
		if t.Name() != "TestContractBlockSwapReplayNotebookResponseLease" {
			requireAPIContract(t, http.MethodPost, endpoint, writer.ResponseRecorder)
		}
		var response struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		wantCode := 0
		if t.Name() == "TestContractCheckClosedNotebookRefNotebookResponseLease" {
			// 此夹具仅解锁密钥，未挂载笔记本；业务失败也必须保持布尔载荷和响应租约。
			wantCode = -1
		}
		if err := json.Unmarshal(body, &response); err != nil || response.Code != wantCode {
			t.Fatalf("typed query failed: %s, %v", body, err)
		}
		if wantCode == -1 && string(response.Data) != "false" {
			t.Fatalf("reference error lost boolean data: %s", body)
		}
	}
	remaining := len(boxIDs)
	if lockedBeforeResponse {
		remaining--
	}
	for range remaining {
		select {
		case <-lockDone:
		case <-time.After(5 * time.Second):
			t.Fatal("lock did not complete after response lease release")
		}
	}
	if lockedBeforeResponse {
		t.Fatalf("lock completed before plaintext response was sent: %s", writer.Body.String())
	}
	if t.Name() == "TestGetBlockInfoNotebookResponseLease" {
		for _, explicit := range []bool{false, true} {
			args := map[string]any{"id": boxIDs[0]}
			if explicit {
				args["notebook"] = boxIDs[0]
			}
			body, err := json.Marshal(args)
			if err != nil {
				t.Fatal(err)
			}
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, endpoint, strings.NewReader(string(body)))
			request.Header.Set("Content-Type", "application/json")
			engine.ServeHTTP(recorder, request)
			var response struct {
				Code int `json:"code"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if response.Code == 0 || strings.Contains(recorder.Body.String(), "REVIEW-SECRET-CONTENT") {
				t.Fatalf("locked notebook metadata escaped: %s", recorder.Body.String())
			}
		}
	}
}
