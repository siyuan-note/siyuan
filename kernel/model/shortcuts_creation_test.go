// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestLocalShorthandCreationRecovery(t *testing.T) {
	for _, state := range []string{"committed", "missingBlock", "changedSource", "missingDocument"} {
		t.Run(state, func(t *testing.T) {
			fixture := setupFileOperationTest(t)
			original := util.ShortcutsPath
			util.ShortcutsPath = t.TempDir()
			t.Cleanup(func() { util.ShortcutsPath = original })
			directory := filepath.Join(util.ShortcutsPath, "shorthands")
			if err := os.MkdirAll(directory, 0755); err != nil {
				t.Fatal(err)
			}
			filename := filepath.Join(directory, "1234567890123.md")
			source := []byte("keep original source")
			if err := os.WriteFile(filename, source, 0644); err != nil {
				t.Fatal(err)
			}
			block := fixture.childID
			if state == "missingBlock" {
				block = ast.NewNodeID()
			}
			if err := beginLocalShorthandCreation(fixture.box.ID, fixture.sourceID, fixture.sourcePath,
				[]string{block}, map[string][]byte{filename: source}); err != nil {
				t.Fatal(err)
			}
			if state == "changedSource" {
				if err := os.WriteFile(filename, []byte("new user input"), 0644); err != nil {
					t.Fatal(err)
				}
			} else if state == "missingDocument" {
				if err := os.Remove(filepath.Join(util.DataDir, fixture.box.ID, fixture.sourcePath)); err != nil {
					t.Fatal(err)
				}
			}
			id, err := recoverLocalShorthandCreation(fixture.box.ID)
			if state == "committed" {
				if err != nil || id != fixture.sourceID {
					t.Fatalf("committed recovery failed: %s, %v", id, err)
				}
				for _, name := range []string{filename, localShorthandCreationPath()} {
					if _, err := os.Stat(name); !os.IsNotExist(err) {
						t.Fatalf("confirmed source or journal was not consumed: %s, %v", name, err)
					}
				}
				if id, err = recoverLocalShorthandCreation(fixture.box.ID); err != nil || id != "" {
					t.Fatal("repeated recovery was not idempotent", id, err)
				}
			} else {
				if err == nil {
					t.Fatal("unverified outcome was accepted")
				}
				for _, name := range []string{filename, localShorthandCreationPath()} {
					if _, err := os.Stat(name); err != nil {
						t.Fatal("recovery discarded unresolved data", err)
					}
				}
			}
		})
	}
}
