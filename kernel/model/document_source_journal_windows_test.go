// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/internal/testutil"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/sys/windows"
)

func TestDocumentSourceJournalRenameRetriesAfterTargetReleased(t *testing.T) {
	dir := t.TempDir()
	source, target := filepath.Join(dir, ".source-test"), filepath.Join(dir, "transaction.json")
	if err := os.WriteFile(source, []byte("committed"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(target, []byte("pending"), 0600); err != nil {
		t.Fatal(err)
	}
	release := testutil.LockUserFile(t, target)
	attempts := 0
	err := retryDocumentSourceJournalRename(func() error {
		attempts++
		err := os.Rename(source, target)
		if attempts == 1 {
			if !errors.Is(err, windows.ERROR_ACCESS_DENIED) {
				t.Fatalf("expected access denied with the target open, got %v", err)
			}
			release()
		}
		return err
	})
	if err != nil || attempts != 2 {
		t.Fatalf("expected replacement on the second attempt, got %d attempts and %v", attempts, err)
	}
	if data, err := os.ReadFile(target); err != nil || string(data) != "committed" {
		t.Fatalf("expected the replacement at the target, got %q and %v", data, err)
	}
}

func TestDocumentSourceJournalRenameReturnsUnrelatedError(t *testing.T) {
	attempts := 0
	err := retryDocumentSourceJournalRename(func() error {
		attempts++
		return os.ErrNotExist
	})
	if !errors.Is(err, os.ErrNotExist) || attempts != 1 {
		t.Fatalf("expected file not found after one attempt, got %d attempts and %v", attempts, err)
	}
}

func TestDocumentSourceJournalCommitPreservesPendingRecordWhenTargetRemainsOpen(t *testing.T) {
	oldQueue := util.QueueDir
	util.QueueDir = t.TempDir()
	t.Cleanup(func() { util.QueueDir = oldQueue })
	journal := &documentSourceJournal{Version: 1, ID: ast.NewNodeID(), State: "pending", Files: []*documentSourceFile{
		{Box: ast.NewNodeID(), Path: "/" + ast.NewNodeID() + ".sy"},
	}}
	if err := journal.save(); err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(journal.filename())
	if err != nil {
		t.Fatal(err)
	}
	release := testutil.LockUserFile(t, journal.filename())
	tx := &Transaction{sourceJournal: journal}
	commitErr := tx.commitDocumentSources()
	release()
	if !errors.Is(commitErr, windows.ERROR_ACCESS_DENIED) || journal.State != "pending" {
		t.Fatalf("expected access denied and pending state, got %v and %s", commitErr, journal.State)
	}
	if data, err := os.ReadFile(journal.filename()); err != nil || !bytes.Equal(data, original) {
		t.Fatalf("expected the original recovery record, read error: %v", err)
	}
	entries, err := os.ReadDir(documentSourceJournalBase())
	if err != nil || len(entries) != 1 || entries[0].Name() != filepath.Base(journal.filename()) {
		t.Fatalf("expected only the original recovery record, got %v and %v", entries, err)
	}
}
