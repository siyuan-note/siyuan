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

func TestExplicitNotebookResponseLease(t *testing.T) {
	runNotebookResponseLease(t, true, false)
}

func TestBatchNotebookResponseLease(t *testing.T) {
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
	engine.POST("/api/block/getBlockKramdowns", getBlockKramdowns)
	writer := &blockedBlockResponseWriter{ResponseRecorder: httptest.NewRecorder(), ready: make(chan []byte, 1), proceed: make(chan struct{})}
	var releaseWriter sync.Once
	defer releaseWriter.Do(func() { close(writer.proceed) })
	args := map[string]any{"id": boxIDs[0]}
	if explicitNotebook {
		args["notebook"] = boxIDs[0]
	}
	endpoint := "/api/block/getBlockKramdown"
	if batch {
		delete(args, "id")
		args["ids"] = boxIDs
		endpoint += "s"
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
	if strings.Count(string(body), "REVIEW-SECRET-CONTENT") != count {
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
}
