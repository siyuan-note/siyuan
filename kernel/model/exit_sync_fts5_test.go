// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"context"
	"errors"
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

func TestExitSyncCancellationRestoresRetainedDocumentIndex(t *testing.T) {
	const childEnv = "SIYUAN_TEST_EXIT_CANCEL_INDEX"
	if os.Getenv(childEnv) == "" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestExitSyncCancellationRestoresRetainedDocumentIndex$", "-test.timeout=30s")
		cmd.Env = append(os.Environ(), childEnv+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("isolated exit cancellation test: %v\n%s", err, output)
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
	tree := treenode.NewTree(fixture.box.ID, "/20261026110000-exit001.sy", "/BeforeExit", "BeforeExit")
	writeAssetDownloadDocumentTest(t, tree)
	filename := filepath.Join(util.DataDir, tree.Box, tree.Path)
	before, err := os.ReadFile(filename)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = filesys.LoadTree(tree.Box, tree.Path, util.NewLute()); err != nil {
		t.Fatal(err)
	}
	after := bytes.ReplaceAll(before, []byte("BeforeExit"), []byte("RetainedAfterExitCancel"))
	if err = os.WriteFile(filename, after, 0644); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	hooks, finish := exitSyncHooks(repo, ctx)
	if hooks.Preflight == nil {
		t.Fatal("exit cancellation discarded document addressing validation")
	}
	repo.SetCheckoutHooks(hooks)
	hooks.Committed(entity.NewFile("/"+tree.Box+tree.Path, int64(len(after)), time.Now().UnixMilli()))
	cancel()
	operationErr := context.Canceled
	finish(&operationErr)
	if !errors.Is(operationErr, context.Canceled) {
		t.Fatal("canceled sync was reported as successful")
	}
	if block := sql.GetBlock(tree.ID); block == nil || block.Content != "RetainedAfterExitCancel" {
		t.Fatalf("retained source was not reindexed: %+v", block)
	}
	read, err := filesys.LoadTree(tree.Box, tree.Path, util.NewLute())
	if err != nil || read.Root.IALAttr("title") != "RetainedAfterExitCancel" {
		t.Fatalf("stale document cache after cancellation: %v", err)
	}
	retained, err := os.ReadFile(filename)
	if err != nil || !bytes.Equal(retained, after) {
		t.Fatalf("retained document changed: %v", err)
	}
}
