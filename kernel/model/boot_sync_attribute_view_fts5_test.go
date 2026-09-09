//go:build fts5

package model

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBootSyncAttributeViewIndex(t *testing.T) {
	const childEnv = "SIYUAN_TEST_BOOT_SYNC_AV_INDEX"
	if os.Getenv(childEnv) == "" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestBootSyncAttributeViewIndex$", "-test.timeout=30s")
		cmd.Env = append(os.Environ(), childEnv+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("boot sync subprocess failed: %v\n%s", err, output)
		}
		return
	}
	fixture, _, _, _ := prepareAssetDownloadDocumentTest(t)
	setupAttributeViewRefI18n(t)
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
	const avID = "20260909170000-av00001"
	if err := av.SaveAttributeView(av.NewAttributeView(avID)); err != nil {
		t.Fatal(err)
	}
	tree := treenode.NewTree(fixture.box.ID, "/20260909170001-doc0001.sy", "/RemoteTitle", "RemoteTitle")
	tree.Root.AppendChild(&ast.Node{Type: ast.NodeAttributeView, ID: "20260909170002-db00001", AttributeViewID: avID})
	writeAssetDownloadDocumentTest(t, tree)

	// 启动同步标志只能在后处理返回后清除；超时解除等待，使回归失败能够正常报告。
	originalBootSyncing := isBootSyncing.Swap(true)
	var timedOut atomic.Bool
	watchdogDone := make(chan struct{})
	watchdog := time.AfterFunc(5*time.Second, func() {
		stack := make([]byte, 1024*1024)
		t.Logf("blocked boot sync stacks:\n%s", stack[:runtime.Stack(stack, true)])
		timedOut.Store(true)
		isBootSyncing.Store(false)
		close(watchdogDone)
	})
	stopWatchdog := sync.OnceFunc(func() {
		if !watchdog.Stop() {
			<-watchdogDone
		}
		isBootSyncing.Store(originalBootSyncing)
	})
	t.Cleanup(stopWatchdog)
	processSyncMergeResult(false, false, &dejavu.MergeResult{Upserts: []*entity.File{
		{Path: "/" + tree.Box + tree.Path},
		{Path: "/storage/av/" + avID + ".json"},
	}}, &dejavu.TrafficStat{}, "a", 0, true)
	// 数据库定义变更追加的引用索引也必须在启动同步期间完成。
	sql.FlushQueue()
	stopWatchdog()
	if timedOut.Load() {
		t.Fatal("attribute view indexing waited for boot synchronization to finish")
	}
	if block := sql.GetBlock(tree.ID); block == nil || block.Content != "RemoteTitle" {
		t.Fatalf("synced document was not indexed: %+v", block)
	}
}
