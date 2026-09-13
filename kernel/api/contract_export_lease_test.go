//go:build (sqlcipher || libsqlcipher) && cgo

package api

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractExportNotebookResponseLease(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_EXPORT_RESPONSE_LEASE") != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestAPIContractExportNotebookResponseLease$", "-test.v")
		command.Env = append(os.Environ(), "SIYUAN_TEST_EXPORT_RESPONSE_LEASE=1")
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("export lease subprocess failed: %v\n%s", err, output)
		}
		return
	}
	root := t.TempDir()
	util.ServerURL = &url.URL{Scheme: "http"}
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
	if err := model.EnableEncryptedNotebook("export-password"); err != nil {
		t.Fatal(err)
	}
	boxID, err := model.CreateEncryptedBox("Export lease", "export-password")
	if err != nil {
		t.Fatal(err)
	}
	defer model.LockBox(boxID)
	tree, err := filesys.LoadTree(boxID, "/"+boxID+".sy", util.NewLute())
	if err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	engine := gin.New()
	engine.Use(boxLeaseMiddleware)
	engine.POST("/api/export/exportTempContent", exportTempContent)
	writer := &blockedBlockResponseWriter{ResponseRecorder: httptest.NewRecorder(), ready: make(chan []byte, 1), proceed: make(chan struct{})}
	var release sync.Once
	defer release.Do(func() { close(writer.proceed) })
	request := httptest.NewRequest("POST", "/api/export/exportTempContent", strings.NewReader(`{"id":"`+boxID+`","content":"EXPORT-SECRET"}`))
	done := make(chan struct{})
	go func() { engine.ServeHTTP(writer, request); close(done) }()
	var body []byte
	select {
	case body = <-writer.ready:
	case <-time.After(5 * time.Second):
		t.Fatal("export response never reached writer")
	}
	var response struct {
		Code int                       `json:"code"`
		Data apicontract.ExportURLData `json:"data"`
	}
	if err = json.Unmarshal(body, &response); err != nil || response.Code != 0 || !strings.Contains(response.Data.URL, boxID+"/temp/") {
		t.Fatalf("managed export was not produced: %s %v", body, err)
	}
	locked := make(chan struct{})
	go func() { model.LockBox(boxID); close(locked) }()
	early := false
	select {
	case <-locked:
		early = true
	case <-time.After(300 * time.Millisecond):
	}
	release.Do(func() { close(writer.proceed) })
	<-done
	select {
	case <-locked:
	case <-time.After(5 * time.Second):
		t.Fatal("locking did not complete after response")
	}
	if early {
		t.Fatal("encrypted export lease ended before response serialization")
	}
	requireAPIContract(t, "POST", "/api/export/exportTempContent", writer.ResponseRecorder)
	entries, err := os.ReadDir(filepath.Join(util.TempDir, "export", boxID, "temp"))
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatal("locking retained plaintext export artifacts")
	}
}
