// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
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

func TestSyncCheckoutCompletesIndexesBeforeResuming(t *testing.T) {
	const childEnv = "SIYUAN_TEST_CHECKOUT_COMPLETE_INDEX"
	if os.Getenv(childEnv) == "" {
		for _, scenario := range []string{"move", "notebook"} {
			t.Run(scenario, func(t *testing.T) {
				cmd := exec.Command(os.Args[0], "-test.run=^TestSyncCheckoutCompletesIndexesBeforeResuming$", "-test.v")
				cmd.Env = append(os.Environ(), childEnv+"="+scenario)
				if output, err := cmd.CombinedOutput(); err != nil {
					t.Fatalf("isolated index test failed: %v\n%s", err, output)
				}
			})
		}
		return
	}
	fixture, _, repo, _ := prepareAssetDownloadDocumentTest(t)
	boxConf := conf.NewBoxConf()
	boxConf.Closed = false
	if err := fixture.box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
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
	const parentID, movedID = "20261021090000-parent1", "20261021090001-moved01"
	parent := treenode.NewTree(fixture.box.ID, "/"+parentID+".sy", "/Parent", "Parent")
	tree := treenode.NewTree(fixture.box.ID, "/"+movedID+".sy", "/Moved", "Moved")
	writeAssetDownloadDocumentTest(t, parent)
	writeAssetDownloadDocumentTest(t, tree)
	checkout := startSyncCheckout(repo)
	if checkout == nil {
		t.Fatal("missing checkout task")
	}
	t.Cleanup(func() { var err error; checkout.finish(repo, &err) })
	if err := checkout.prepareApply(); err != nil {
		t.Fatal(err)
	}
	wantPath := tree.Path
	if os.Getenv(childEnv) == "move" {
		oldPath := "/" + tree.Box + tree.Path
		upsertIndexes([]string{"/" + parent.Box + parent.Path, oldPath})
		sql.FlushQueue()
		wantPath = "/" + parentID + tree.Path
		newPath := "/" + tree.Box + wantPath
		if err := os.MkdirAll(filepath.Dir(filepath.Join(util.DataDir, newPath)), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.Rename(filepath.Join(util.DataDir, oldPath), filepath.Join(util.DataDir, newPath)); err != nil {
			t.Fatal(err)
		}
		checkout.upserts[newPath] = entity.NewFile(newPath, 0, time.Now().UnixMilli())
		checkout.removes[oldPath] = entity.NewFile(oldPath, 0, time.Now().UnixMilli())
	} else {
		path := "/" + fixture.box.ID + "/.siyuan/conf.json"
		checkout.upserts[path] = entity.NewFile(path, 0, time.Now().UnixMilli())
	}
	releaseWrites := checkout.releaseWrites
	checkout.releaseWrites = func() {
		block := sql.GetBlock(movedID)
		if block == nil || block.Path != wantPath {
			t.Errorf("editing resumed before the document was indexed: %+v", block)
		}
		if task.ContainIndexTask() {
			t.Error("notebook indexing remained queued when editing resumed")
		}
		releaseWrites()
	}
	checkout.completeApply()
	snapshot := GetSyncCheckout("", "").Task
	if snapshot.Blocking || snapshot.Phase != "background" {
		t.Fatalf("completed indexing retained the editing guard: %+v", snapshot)
	}
	if os.Getenv(childEnv) == "move" &&
		(!slices.Contains(snapshot.UpsertRootIDs, movedID) || slices.Contains(snapshot.RemoveRootIDs, movedID)) {
		t.Fatalf("a moved document was reported as removed: %+v", snapshot)
	}
}
