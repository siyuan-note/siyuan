// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestNotebookDocumentSourceJournalPath(t *testing.T) {
	box := ast.NewNodeID()
	for _, file := range []*documentSourceFile{
		{Kind: "notebook", Box: box, Path: "/.siyuan/conf.json"},
		{Kind: "notebook", Box: "../" + box, Path: "/.siyuan/conf.json"},
		{Kind: "notebook", Box: box, Path: "/.siyuan/../conf.json"},
		{Kind: "notebook", Box: box, Path: "/.siyuan/crypt-backup.json"},
		{Kind: "notebook", Box: "", Path: "/.siyuan/conf.json"},
	} {
		filename, err := file.filename()
		valid := file.Box == box && file.Path == "/.siyuan/conf.json"
		if valid != (err == nil) || valid && filename != filepath.Join(util.DataDir, box, ".siyuan", "conf.json") {
			t.Fatalf("unexpected notebook recovery path: %+v, %q, %v", file, filename, err)
		}
	}
}

func TestDocumentSourceJournalConcurrentScanAndWrites(t *testing.T) {
	oldQueue := util.QueueDir
	util.QueueDir = t.TempDir()
	t.Cleanup(func() { util.QueueDir = oldQueue })
	j := &documentSourceJournal{Version: 1, ID: ast.NewNodeID(), State: "pending", Files: []*documentSourceFile{
		{Box: ast.NewNodeID(), Path: "/" + ast.NewNodeID() + ".sy", Before: []byte("before"), After: []byte("after")},
	}}
	if err := j.save(); err != nil {
		t.Fatal(err)
	}
	done := make(chan struct{})
	result := make(chan error, 1)
	go func() {
		for {
			select {
			case <-done:
				result <- nil
				return
			default:
				if _, err := readDocumentSourceJournals(); err != nil {
					result <- fmt.Errorf("scan: %w", err)
					return
				}
			}
		}
	}()
	var writeErr error
	for i := 0; i < 100 && writeErr == nil; i++ {
		if writeErr = j.save(); writeErr == nil {
			writeErr = j.remove()
		}
		if writeErr == nil {
			writeErr = j.save()
		}
	}
	close(done)
	if err := <-result; err != nil {
		t.Error(err)
	}
	if writeErr != nil {
		t.Fatal(writeErr)
	}
}

func TestDocumentSourceRecoveryPreservesConflictsAndCorruptRecords(t *testing.T) {
	for _, corrupt := range []bool{false, true} {
		t.Run(map[bool]string{false: "newer-source", true: "corrupt-record"}[corrupt], func(t *testing.T) {
			fixture := setupFileOperationTest(t)
			oldQueue := util.QueueDir
			util.QueueDir = t.TempDir()
			t.Cleanup(func() { util.QueueDir = oldQueue })
			filename := filepath.Join(util.DataDir, fixture.box.ID, fixture.sourcePath)
			original, err := os.ReadFile(filename)
			if err != nil {
				t.Fatal(err)
			}
			j := &documentSourceJournal{Version: 1, ID: ast.NewNodeID(), State: "pending", Files: []*documentSourceFile{
				{Box: fixture.box.ID, Path: fixture.sourcePath, Before: original, After: []byte("expected replacement")},
			}}
			if err = j.save(); err != nil {
				t.Fatal(err)
			}
			originalJournal, err := os.ReadFile(j.filename())
			if err != nil {
				t.Fatal(err)
			}
			newer := append(append([]byte{}, original...), '\n')
			if err = os.WriteFile(filename, newer, 0600); err != nil {
				t.Fatal(err)
			}
			if corrupt {
				if err = os.WriteFile(j.filename(), []byte(`{"data":{},"sha256":"corrupt"}`), 0600); err != nil {
					t.Fatal(err)
				}
			}
			err = recoverDocumentSources()
			if corrupt && err == nil || !corrupt && err != nil {
				t.Fatalf("unexpected recovery result: %v", err)
			}
			current, readErr := os.ReadFile(filename)
			if readErr != nil || !bytes.Equal(current, newer) {
				t.Fatal("unsafe recovery changed the source", readErr)
			}
			if _, statErr := os.Stat(j.filename()); statErr != nil {
				t.Fatal("unsafe recovery discarded recovery evidence", statErr)
			}
			if !corrupt {
				archived, err := os.ReadFile(documentSourceArchivePath(j.ID))
				if err != nil || !bytes.Equal(archived, originalJournal) {
					t.Fatal("archive did not preserve exact recovery bytes", err)
				}
			}
		})
	}
}
