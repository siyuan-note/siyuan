// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package flashcard

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/riff"
)

func TestLegacyMigrationWithoutDecksPreservesLogs(t *testing.T) {
	for _, empty := range []bool{false, true} {
		name := "history"
		if empty {
			name = "empty-log-file"
		}
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			root := t.TempDir()
			path := filepath.Join(root, "logs", "202608.msgpack")
			logs := []*riff.Log{}
			if !empty {
				logs = append(logs, &riff.Log{ID: "removed-card-review", CardID: "removed-card", Rating: riff.Good, Reviewed: 1785900000, State: riff.Review})
			}
			writeMsgpack(t, path, logs)
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			options := preparingMigrationTestOptions()
			plan, err := PrepareLegacyMigration(ctx, root, options)
			if err != nil {
				t.Fatal(err)
			}
			if !plan.Report.Complete || plan.Report.LegacyDecks != 0 || plan.Report.LegacyCards != 0 || plan.Report.ReviewSets != 0 || plan.Report.ReviewEvents != len(logs) || plan.Report.ArchivedCards != len(logs) {
				t.Fatalf("unexpected logs-only report: %+v", plan.Report)
			}
			if len(plan.InputFiles) != 1 {
				t.Fatalf("lost log fingerprint: %+v", plan.InputFiles)
			}
			again, err := PrepareLegacyMigration(ctx, root, options)
			if err != nil || again.MigrationID != plan.MigrationID {
				t.Fatalf("non-deterministic prepare: %v", err)
			}
			workspace := t.TempDir()
			store, err := OpenStore(ctx, filepath.Join(workspace, "v2"), filepath.Join(workspace, "temp", "flashcards.db"), "device-a", &JournalOptions{WriterID: testWriterA})
			if err != nil {
				t.Fatal(err)
			}
			defer store.Close()
			first, err := store.ActivateLegacyMigration(ctx, root, plan)
			if err != nil {
				t.Fatal(err)
			}
			if first.Status.State != MigrationStateActive {
				t.Fatalf("migration not active: %+v", first.Status)
			}
			retry, err := store.ActivateLegacyMigration(ctx, root, again)
			if err != nil {
				t.Fatal(err)
			}
			if retry.ActivationBatch.BatchID != first.ActivationBatch.BatchID {
				t.Fatal("retry duplicated activation")
			}
			var count int
			if err = store.Projection().db.QueryRowContext(ctx, "SELECT COUNT(*) FROM review_events").Scan(&count); err != nil || count != len(logs) {
				t.Fatalf("history lost or duplicated: %d, %v", count, err)
			}
			after, err := os.ReadFile(path)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatalf("legacy log changed: %v", err)
			}
		})
	}
}

func TestLegacyMigrationWithoutDecksRejectsCorruptLogs(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "logs")
	if err := os.MkdirAll(path, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(path, "202608.msgpack"), []byte{0xc1}, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := PrepareLegacyMigration(context.Background(), root, preparingMigrationTestOptions()); err == nil {
		t.Fatal("corrupt log was treated as an empty workspace")
	}
}
