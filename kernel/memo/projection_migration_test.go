// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package memo

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func legacyProjection(t *testing.T, s *Store, name, text, fingerprint string) []byte {
	t.Helper()
	root, err := s.root(true)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	data, err := encode(projectionHeader{1, fingerprint}, text)
	if err != nil {
		t.Fatal(err)
	}
	if err = writeFile(root, name, data); err != nil {
		t.Fatal(err)
	}
	return data
}

func TestMemoryProjectionMigrationPreservesBothAndReentry(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	saveSample(t, s, "one")
	snapshot, _ := s.Snapshot(ctx, nil)
	user := legacyProjection(t, s, "USER.md", "Unique user preference", snapshot.Fingerprint)
	memory := legacyProjection(t, s, "MEMORY.md", "Unique project convention", snapshot.Fingerprint)
	if _, err := s.ReadProjection(ctx, "MEMORY.md", nil); !errors.Is(err, ErrInvalid) {
		t.Fatalf("legacy accepted as unified: %v", err)
	}
	if err := s.MigrateProjection(ctx, nil); err != nil {
		t.Fatal(err)
	}
	p, err := s.ReadProjection(ctx, "MEMORY.md", nil)
	if err != nil || p.Content != "Unique user preference\n\nUnique project convention" {
		t.Fatalf("merged content: %+v %v", p, err)
	}
	dir := filepath.Join(s.dataDir, "storage/ai/memos")
	if _, err = os.Stat(filepath.Join(dir, "USER.md")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("legacy entry remains")
	}
	for name, data := range map[string][]byte{"USER": user, "MEMORY": memory} {
		got, readErr := os.ReadFile(filepath.Join(dir, "legacy-projections", name+"-"+revision(data)+".md"))
		if readErr != nil || string(got) != string(data) {
			t.Fatalf("backup: %v", readErr)
		}
	}
	for i := 0; i < 2; i++ {
		legacyProjection(t, s, "USER.md", "Late legacy content", snapshot.Fingerprint)
		if err = s.MigrateProjection(ctx, nil); err != nil {
			t.Fatal(err)
		}
		next, _ := s.ReadProjection(ctx, "MEMORY.md", nil)
		if next.Content != p.Content {
			t.Fatal("legacy reentry duplicated or changed unified content")
		}
	}
}

func TestMemoryProjectionMigrationSingleFileAndInterruptedWrite(t *testing.T) {
	for _, name := range []string{"USER.md", "MEMORY.md"} {
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			s := newTestStore(t)
			saveSample(t, s, "one")
			snap, _ := s.Snapshot(ctx, nil)
			original := legacyProjection(t, s, name, "Only content", snap.Fingerprint)
			dir := filepath.Join(s.dataDir, "storage/ai/memos")
			blocker := filepath.Join(dir, "legacy-projections")
			if err := os.WriteFile(blocker, []byte("blocked"), 0600); err != nil {
				t.Fatal(err)
			}
			if err := s.MigrateProjection(ctx, nil); err == nil {
				t.Fatal("backup failure ignored")
			}
			got, _ := os.ReadFile(filepath.Join(dir, name))
			if string(got) != string(original) {
				t.Fatal("original lost before backup")
			}
			if err := os.Remove(blocker); err != nil {
				t.Fatal(err)
			}
			if err := s.MigrateProjection(ctx, nil); err != nil {
				t.Fatal(err)
			}
			p, err := s.ReadProjection(ctx, "MEMORY.md", nil)
			if err != nil || p.Content != "Only content" {
				t.Fatalf("retry %+v %v", p, err)
			}
		})
	}
}

func TestMemoryProjectionMigrationDoesNotReviveForgottenContent(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	entry := saveSample(t, s, "one")
	snap, _ := s.Snapshot(ctx, nil)
	legacyProjection(t, s, "USER.md", "Forgotten private fact", snap.Fingerprint)
	legacyProjection(t, s, "MEMORY.md", "Other stale summary", snap.Fingerprint)
	if _, err := s.Forget(ctx, entry.Record.ID, entry.Revision, "forget"); err != nil {
		t.Fatal(err)
	}
	if err := s.MigrateProjection(ctx, nil); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale migration: %v", err)
	}
	current, _ := s.Snapshot(ctx, nil)
	if err := s.SaveProjection(ctx, "MEMORY.md", "", current.Fingerprint, nil); err != nil {
		t.Fatal(err)
	}
	p, err := s.ReadProjection(ctx, "MEMORY.md", nil)
	if err != nil || p.Content != "" {
		t.Fatalf("revived: %+v %v", p, err)
	}
	legacyProjection(t, s, "USER.md", "Forgotten private fact", snap.Fingerprint)
	if err = s.MigrateProjection(ctx, nil); err != nil {
		t.Fatal(err)
	}
	p, _ = s.ReadProjection(ctx, "MEMORY.md", nil)
	if strings.Contains(p.Content, "Forgotten") {
		t.Fatal("legacy client revived withdrawn content")
	}
	files, _ := os.ReadDir(filepath.Join(s.dataDir, "storage/ai/memos/legacy-projections"))
	if len(files) != 2 {
		t.Fatalf("backup loss or duplication: %d", len(files))
	}
}

func TestMemoryProjectionMigrationRejectsUnknownFormatWithoutLoss(t *testing.T) {
	ctx := context.Background()
	s := newTestStore(t)
	saveSample(t, s, "one")
	snap, _ := s.Snapshot(ctx, nil)
	root, err := s.root(true)
	if err != nil {
		t.Fatal(err)
	}
	data, _ := encode(projectionHeader{99, snap.Fingerprint}, "Future content")
	if err = writeFile(root, "MEMORY.md", data); err != nil {
		t.Fatal(err)
	}
	root.Close()
	if err = s.MigrateProjection(ctx, nil); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
	if err = s.SaveProjection(ctx, "MEMORY.md", "replacement", snap.Fingerprint, nil); !errors.Is(err, ErrInvalid) {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(filepath.Join(s.dataDir, "storage/ai/memos/MEMORY.md"))
	if string(got) != string(data) {
		t.Fatal("future content overwritten")
	}
}
