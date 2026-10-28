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
			if err == nil || (!corrupt && !errors.Is(err, util.ErrFileChanged)) {
				t.Fatalf("unsafe recovery was not rejected: %v", err)
			}
			current, readErr := os.ReadFile(filename)
			if readErr != nil || !bytes.Equal(current, newer) {
				t.Fatal("unsafe recovery changed the source", readErr)
			}
			if _, statErr := os.Stat(j.filename()); statErr != nil {
				t.Fatal("unsafe recovery discarded recovery evidence", statErr)
			}
		})
	}
}
