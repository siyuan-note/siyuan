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

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRollbackRepoDocumentPreservesCurrentOnWriteFailure(t *testing.T) {
	if os.Getenv("SIYUAN_TEST_REPO_ROLLBACK") != "1" {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestRollbackRepoDocumentPreservesCurrentOnWriteFailure$", "-test.v")
		cmd.Env = append(os.Environ(), "SIYUAN_TEST_REPO_ROLLBACK=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("snapshot rollback subprocess: %v\n%s", err, output)
		}
		return
	}
	prepareHPathRefreshTest(t)
	util.RepoDir = filepath.Join(util.WorkspaceDir, "repo")
	Conf.Repo.Store(conf.NewRepo())
	Conf.Repo.Load().Key = []byte("0123456789abcdef0123456789abcdef")
	Conf.System.Store(conf.NewSystem())
	box := &Box{ID: ast.NewNodeID()}
	boxConf := conf.NewBoxConf()
	boxConf.Closed = false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	tree := newHPathTestDoc(t, box.ID, "/", "Original", 1)
	sql.FlushQueue()
	docPath := filepath.Join(util.DataDir, box.ID, tree.Path)
	historical, err := os.ReadFile(docPath)
	if err != nil {
		t.Fatal(err)
	}
	snapshotID, _, err := CreateRepoSnapshotWithFullCheck("original", true)
	if err != nil {
		t.Fatal(err)
	}
	repo, err := newRepository()
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := repo.GetIndex(snapshotID)
	if err != nil {
		t.Fatal(err)
	}
	files, err := repo.GetFiles(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	fileID := ""
	for _, file := range files {
		if file.Path == "/"+box.ID+tree.Path {
			fileID = file.ID
		}
	}
	if fileID == "" {
		t.Fatal("document snapshot missing")
	}
	tree.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("current content")})
	if err = writeTreeUpsertQueue(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	sql.FlushQueue()
	current, err := os.ReadFile(docPath)
	if err != nil {
		t.Fatal(err)
	}
	seedDocumentHistory(t, tree.ID)
	provider := filesys.DEKProvider
	defer func() { filesys.DEKProvider = provider }()
	injected := errors.New("injected restored document write failure")
	filesys.DEKProvider = func(id string) ([]byte, error) {
		if id == box.ID {
			return nil, injected
		}
		return provider(id)
	}
	if err = RollbackRepoSnapshotFile(fileID); !errors.Is(err, injected) {
		t.Fatalf("write failure was not returned: %v", err)
	}
	if after, readErr := os.ReadFile(docPath); readErr != nil || !bytes.Equal(after, current) {
		t.Fatalf("failed rollback changed working document: %v", readErr)
	}
	if treenode.GetBlockTreeInBox(tree.ID, box.ID) == nil || sql.GetBlockInBox(tree.ID, box.ID) == nil {
		t.Fatal("failed rollback removed current indexes")
	}
	if undo, redo, _ := GlobalUndoLog.State(tree.ID); !undo || !redo {
		t.Fatal("failed rollback discarded working history")
	}
	filesys.DEKProvider = provider
	if err = RollbackRepoSnapshotFile(fileID); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	if after, readErr := os.ReadFile(docPath); readErr != nil || !bytes.Equal(after, historical) {
		t.Fatalf("successful rollback did not restore snapshot: %v", readErr)
	}
	if treenode.GetBlockTreeInBox(tree.ID, box.ID) == nil || sql.GetBlockInBox(tree.ID, box.ID) == nil {
		t.Fatal("successful rollback did not recreate indexes")
	}
	if undo, redo, _ := GlobalUndoLog.State(tree.ID); undo || redo {
		t.Fatal("successful rollback kept stale working history")
	}
}
