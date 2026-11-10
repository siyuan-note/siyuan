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
	"github.com/siyuan-note/siyuan/kernel/util"
)

func sourceArchiveFixture(t *testing.T) (*fileOperationTestFixture, *documentSourceJournal) {
	t.Helper()
	f := setupFileOperationTest(t)
	j := &documentSourceJournal{Version: 1, ID: ast.NewNodeID(), State: "pending"}
	for _, p := range []string{f.sourcePath, f.targetPath} {
		before, err := os.ReadFile(filepath.Join(util.DataDir, f.box.ID, p))
		if err != nil {
			t.Fatal(err)
		}
		j.Files = append(j.Files, &documentSourceFile{Box: f.box.ID, Path: p, Before: before, After: append(append([]byte{}, before...), '\n')})
	}
	if err := j.save(); err != nil {
		t.Fatal(err)
	}
	return f, j
}

func TestDocumentSourceArchiveKeepsWholeCurrentTransaction(t *testing.T) {
	for _, scenario := range []string{"modified", "deleted", "moved", "closed"} {
		t.Run(scenario, func(t *testing.T) {
			_, j := sourceArchiveFixture(t)
			first, _ := j.Files[0].filename()
			second, _ := j.Files[1].filename()
			if err := os.WriteFile(first, j.Files[0].After, 0600); err != nil {
				t.Fatal(err)
			}
			current := append(append([]byte{}, j.Files[1].After...), '\n')
			if scenario == "deleted" || scenario == "moved" {
				if scenario == "moved" {
					if err := os.Rename(second, second+".moved"); err != nil {
						t.Fatal(err)
					}
				} else if err := os.Remove(second); err != nil {
					t.Fatal(err)
				}
			} else if err := os.WriteFile(second, current, 0600); err != nil {
				t.Fatal(err)
			}
			if scenario == "closed" {
				box := Conf.Box(j.Files[0].Box)
				cfg := box.GetConf()
				cfg.Closed = true
				if err := box.SaveConf(cfg); err != nil {
					t.Fatal(err)
				}
			}
			raw, err := os.ReadFile(j.filename())
			if err != nil {
				t.Fatal(err)
			}
			for range 2 {
				if err = recoverDocumentSources(); err != nil {
					t.Fatal(err)
				}
			}
			actual, err := os.ReadFile(first)
			if err != nil || !bytes.Equal(actual, j.Files[0].After) {
				t.Fatal("conflict partially rolled back another source", err)
			}
			actual, err = os.ReadFile(second)
			if scenario == "deleted" || scenario == "moved" {
				if !os.IsNotExist(err) {
					t.Fatal("recovery resurrected removed source", err)
				}
			} else if err != nil || !bytes.Equal(actual, current) {
				t.Fatal("recovery overwrote newer source", err)
			}
			archived, err := os.ReadFile(documentSourceArchivePath(j.ID))
			if err != nil || !bytes.Equal(archived, raw) {
				t.Fatal("original journal lost", err)
			}
			if !hasDocumentSourceRecovery(j.Files[0].Box) {
				t.Fatal("index recovery was not durable")
			}
			if err = finishDocumentSourceRecovery(j.Files[0].Box); err != nil {
				t.Fatal(err)
			}
			if hasDocumentSourceRecovery(j.Files[0].Box) {
				t.Fatal("completed recovery repeats indexing")
			}
			if _, err = os.Stat(documentSourceArchivePath(j.ID)); err != nil {
				t.Fatal("index recovery removed archive", err)
			}
		})
	}
}

func TestDocumentSourceArchiveFailurePreservesActiveRecord(t *testing.T) {
	_, j := sourceArchiveFixture(t)
	name, _ := j.Files[0].filename()
	current := append(append([]byte{}, j.Files[0].After...), '\n')
	if err := os.WriteFile(name, current, 0600); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(j.filename())
	if err := os.WriteFile(filepath.Join(util.ConfDir, "document-source-recovery"), []byte("blocked"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := recoverDocumentSources(); err == nil {
		t.Fatal("archive failure reported successful recovery")
	}
	after, _ := os.ReadFile(j.filename())
	actual, _ := os.ReadFile(name)
	if !bytes.Equal(before, after) || !bytes.Equal(actual, current) {
		t.Fatal("failed archive changed source or evidence")
	}
}

func TestDocumentSourceArchiveInterruptedAdoptionDoesNotReplay(t *testing.T) {
	_, j := sourceArchiveFixture(t)
	name, _ := j.Files[0].filename()
	if err := os.WriteFile(name, j.Files[0].After, 0600); err != nil {
		t.Fatal(err)
	}
	if err := archiveDocumentSource(j); err != nil {
		t.Fatal(err)
	}
	if err := recoverDocumentSources(); err != nil {
		t.Fatal(err)
	}
	current, _ := os.ReadFile(name)
	if !bytes.Equal(current, j.Files[0].After) {
		t.Fatal("restart replayed an archived pending transaction")
	}
}

func TestDocumentSourceArchivePreservesOverlappingRecords(t *testing.T) {
	_, a := sourceArchiveFixture(t)
	b := &documentSourceJournal{Version: 1, ID: ast.NewNodeID(), State: "pending", Files: []*documentSourceFile{a.Files[1]}}
	if err := b.save(); err != nil {
		t.Fatal(err)
	}
	name, _ := a.Files[0].filename()
	if err := os.Remove(name); err != nil {
		t.Fatal(err)
	}
	second, _ := a.Files[1].filename()
	if err := os.WriteFile(second, a.Files[1].After, 0600); err != nil {
		t.Fatal(err)
	}
	if err := recoverDocumentSources(); err != nil {
		t.Fatal(err)
	}
	current, _ := os.ReadFile(second)
	if !bytes.Equal(current, a.Files[1].After) {
		t.Fatal("overlapping older record changed adopted source")
	}
	if _, err := os.Stat(documentSourceArchivePath(b.ID)); err != nil {
		t.Fatal("overlapping recovery not archived", err)
	}
}

func TestDocumentSourceRollbackPreservesChangesAfterPreflight(t *testing.T) {
	_, j := sourceArchiveFixture(t)
	file := j.Files[0]
	name, _ := file.filename()
	if err := os.WriteFile(name, file.After, 0600); err != nil {
		t.Fatal(err)
	}
	if err := j.checkSources(); err != nil {
		t.Fatal(err)
	}
	newer := append(append([]byte{}, file.After...), '\n')
	if err := util.WriteFileIfUnchanged(name, file.After, newer); err != nil {
		t.Fatal(err)
	}
	if err := restoreDocumentSource(file); !errors.Is(err, util.ErrFileChanged) {
		t.Fatal("late edit was not rejected", err)
	}
	current, _ := os.ReadFile(name)
	if !bytes.Equal(current, newer) {
		t.Fatal("rollback overwrote newer edit")
	}
}

func TestDocumentSourceRecoveryRejectsUnreadableSourceAfterConflict(t *testing.T) {
	_, j := sourceArchiveFixture(t)
	first, _ := j.Files[0].filename()
	second, _ := j.Files[1].filename()
	if err := os.Remove(first); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(second); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(second, 0700); err != nil {
		t.Fatal(err)
	}
	if err := recoverDocumentSources(); err == nil {
		t.Fatal("unreadable source was treated as a recoverable conflict")
	}
	if _, err := os.Stat(documentSourceArchivePath(j.ID)); !os.IsNotExist(err) {
		t.Fatal("unreadable batch was adopted", err)
	}
}
