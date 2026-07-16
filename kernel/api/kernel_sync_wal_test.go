// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRecoverKernelSyncCommitWALAfterPartialFilePublication(t *testing.T) {
	workspace := t.TempDir()
	previousWorkspace, previousData, previousTemp := util.WorkspaceDir, util.DataDir, util.TempDir
	previousReload, previousIncSync := kernelSyncReloadFiletree, kernelSyncIncSync
	util.WorkspaceDir = workspace
	util.DataDir = filepath.Join(workspace, "data")
	util.TempDir = filepath.Join(workspace, "temp")
	reloaded, incremented := 0, 0
	kernelSyncReloadFiletree = func() { reloaded++ }
	kernelSyncIncSync = func() { incremented++ }
	defer func() {
		util.WorkspaceDir, util.DataDir, util.TempDir = previousWorkspace, previousData, previousTemp
		kernelSyncReloadFiletree, kernelSyncIncSync = previousReload, previousIncSync
	}()
	assetsDir := filepath.Join(util.DataDir, "assets")
	if err := os.MkdirAll(assetsDir, 0755); err != nil {
		t.Fatal(err)
	}
	writeTarget := filepath.Join(assetsDir, "write.bin")
	deleteTarget := filepath.Join(assetsDir, "delete.bin")
	if err := os.WriteFile(writeTarget, []byte("old write"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(deleteTarget, []byte("old delete"), 0644); err != nil {
		t.Fatal(err)
	}

	newContent := []byte("published before the simulated crash")
	newHash := sha256.Sum256(newContent)
	changes := []struct {
		operation string
		path      string
		content   []byte
	}{
		{operation: "write", path: "/data/assets/write.bin", content: newContent},
		{operation: "delete", path: "/data/assets/delete.bin"},
	}
	prepared := make([]*preparedKernelSyncChange, 0, len(changes))
	for _, change := range changes {
		guard, err := resolveWorkspacePath(change.path, true)
		if err != nil {
			t.Fatal(err)
		}
		workspaceRoot, relativePath, err := guard.openWorkspaceRoot()
		if err != nil {
			t.Fatal(err)
		}
		parent, targetName, err := openRootParentForCommit(workspaceRoot, relativePath, change.operation == "write")
		_ = workspaceRoot.Close()
		if err != nil {
			t.Fatal(err)
		}
		item := &preparedKernelSyncChange{
			change: &kernelSyncChange{Operation: change.operation, Path: change.path}, guard: guard,
			parent: parent, targetName: targetName, existed: true,
		}
		item.backupName, err = newKernelSyncSiblingName(".siyuan-sync-backup-")
		if err == nil {
			err = parent.Link(targetName, item.backupName)
		}
		if err != nil {
			t.Fatal(err)
		}
		if change.operation == "write" {
			item.change.Size = int64(len(change.content))
			item.change.Hash = fmt.Sprintf("sha256:%x", newHash[:])
			item.stagedName, err = stageFileForRootCommit(parent, bytes.NewReader(change.content), 0644, time.Unix(1700000000, 0))
			if err != nil {
				t.Fatal(err)
			}
		}
		prepared = append(prepared, item)
	}
	sessionID := "0123456789abcdef0123456789abcdef0123456789abcdef"
	walPath, err := writeKernelSyncCommitWAL(sessionID, prepared)
	if err != nil {
		t.Fatal(err)
	}
	if err = commitRootStagedFile(prepared[0].parent, prepared[0].stagedName, prepared[0].targetName, false); err != nil {
		t.Fatal(err)
	}
	for _, item := range prepared {
		if err = item.parent.Close(); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = os.Stat(deleteTarget); err != nil {
		t.Fatalf("unpublished deletion changed before recovery: %v", err)
	}
	if _, err = os.Stat(walPath); err != nil {
		t.Fatalf("commit WAL was not durable: %v", err)
	}

	if err = RecoverKernelSyncCommits(); err != nil {
		t.Fatal(err)
	}
	after, err := os.ReadFile(writeTarget)
	if err != nil || !bytes.Equal(after, newContent) {
		t.Fatalf("published write was not recovered: %q %v", after, err)
	}
	if _, err = os.Stat(deleteTarget); !os.IsNotExist(err) {
		t.Fatalf("pending deletion was not recovered: %v", err)
	}
	if _, err = os.Stat(walPath); !os.IsNotExist(err) {
		t.Fatalf("completed WAL was not removed: %v", err)
	}
	for _, item := range prepared {
		backupPath := filepath.Join(assetsDir, item.backupName)
		if _, err = os.Stat(backupPath); !os.IsNotExist(err) {
			t.Fatalf("recovery backup was not removed: %s: %v", item.backupName, err)
		}
	}
	if reloaded != 1 || incremented != 1 {
		t.Fatalf("recovery notifications mismatch: reload=%d incSync=%d", reloaded, incremented)
	}
}

func TestRecoverKernelSyncCommitWALKeepsCorruptSource(t *testing.T) {
	workspace := t.TempDir()
	previousWorkspace, previousData, previousTemp := util.WorkspaceDir, util.DataDir, util.TempDir
	util.WorkspaceDir = workspace
	util.DataDir = filepath.Join(workspace, "data")
	util.TempDir = filepath.Join(workspace, "temp")
	defer func() { util.WorkspaceDir, util.DataDir, util.TempDir = previousWorkspace, previousData, previousTemp }()
	if err := os.MkdirAll(filepath.Join(util.DataDir, "assets"), 0755); err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(util.DataDir, "assets", "test.bin")
	if err := os.WriteFile(target, []byte("old"), 0644); err != nil {
		t.Fatal(err)
	}
	guard, err := resolveWorkspacePath("/data/assets/test.bin", true)
	if err != nil {
		t.Fatal(err)
	}
	root, relativePath, err := guard.openWorkspaceRoot()
	if err != nil {
		t.Fatal(err)
	}
	parent, targetName, err := openRootParentForCommit(root, relativePath, true)
	_ = root.Close()
	if err != nil {
		t.Fatal(err)
	}
	desired := []byte("desired")
	digest := sha256.Sum256(desired)
	stagedName, err := stageFileForRootCommit(parent, bytes.NewReader(desired), 0644, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	item := &preparedKernelSyncChange{
		change: &kernelSyncChange{Operation: "write", Path: "/data/assets/test.bin", Size: int64(len(desired)), Hash: fmt.Sprintf("sha256:%x", digest[:])},
		guard:  guard, parent: parent, targetName: targetName, stagedName: stagedName,
	}
	walPath, err := writeKernelSyncCommitWAL("abcdef0123456789abcdef0123456789abcdef0123456789", []*preparedKernelSyncChange{item})
	if err != nil {
		t.Fatal(err)
	}
	corrupt, err := parent.OpenFile(stagedName, os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = corrupt.Write([]byte("corrupt")); err != nil {
		t.Fatal(err)
	}
	if err = corrupt.Close(); err != nil {
		t.Fatal(err)
	}
	if err = parent.Close(); err != nil {
		t.Fatal(err)
	}
	if err = RecoverKernelSyncCommits(); err == nil {
		t.Fatal("corrupt recovery source must fail")
	}
	if _, err = os.Stat(walPath); err != nil {
		t.Fatalf("failed recovery removed its WAL: %v", err)
	}
	after, err := os.ReadFile(target)
	if err != nil || string(after) != "old" {
		t.Fatalf("failed recovery changed target: %q %v", after, err)
	}
}
