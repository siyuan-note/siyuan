//go:build fts5

package model

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSyncCheckoutCancellationRefreshesDocumentIndex(t *testing.T) {
	const childEnv = "SIYUAN_TEST_CHECKOUT_CANCEL_INDEX"
	if os.Getenv(childEnv) == "" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestSyncCheckoutCancellationRefreshesDocumentIndex$", "-test.v")
		cmd.Env = append(os.Environ(), childEnv+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("isolated index test failed: %v\n%s", err, output)
		}
		return
	}
	fixture, _, repo, _ := prepareAssetDownloadDocumentTest(t)
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath = filepath.Join(util.TempDir, util.DBName)
	util.HistoryDBPath = filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath = filepath.Join(util.TempDir, "asset_content.db")
	if err := os.MkdirAll(util.TempDir, 0755); err != nil {
		t.Fatal(err)
	}
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	t.Cleanup(sql.CloseDatabase)
	tree := treenode.NewTree(fixture.box.ID, "/20261020220000-cancel1.sy", "/BeforeCancel", "BeforeCancel")
	writeAssetDownloadDocumentTest(t, tree)
	doc := filepath.Join(util.DataDir, tree.Box, tree.Path)
	oldData, err := os.ReadFile(doc)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = filesys.LoadTree(tree.Box, tree.Path, util.NewLute()); err != nil {
		t.Fatal(err)
	}
	after := bytes.ReplaceAll(oldData, []byte("BeforeCancel"), []byte("AfterCancel"))
	if err = os.WriteFile(doc, after, 0644); err != nil {
		t.Fatal(err)
	}
	task := startSyncCheckout(repo)
	if task == nil {
		t.Fatal("missing checkout task")
	}
	file := entity.NewFile("/"+tree.Box+tree.Path, int64(len(after)), time.Now().UnixMilli())
	task.upserts[file.Path] = file
	operationErr := context.Canceled
	task.finish(repo, &operationErr)
	if block := sql.GetBlock(tree.ID); block == nil || block.Content != "AfterCancel" {
		t.Fatalf("retained file not indexed: %+v", block)
	}
	read, err := filesys.LoadTree(tree.Box, tree.Path, util.NewLute())
	if err != nil || read.Root.IALAttr("title") != "AfterCancel" {
		t.Fatalf("stale document cache: %v", err)
	}
	if CancelSyncCheckout(task.id) {
		t.Fatal("completed task still active")
	}
}
