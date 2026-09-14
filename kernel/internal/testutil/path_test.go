// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package testutil

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestPublicDataDirIgnoresAmbientTemp(t *testing.T) {
	ambient := t.TempDir()
	for _, goTemp := range []string{"", ambient} {
		t.Run("GOTMPDIR="+goTemp, func(t *testing.T) {
			t.Setenv("TMPDIR", ambient)
			t.Setenv("GOTMPDIR", goTemp)
			var dir string
			t.Run("fixture", func(t *testing.T) {
				dir = PublicDataDir(t)
				if filepath.Dir(dir) == ambient || util.IsSensitivePath(dir) {
					t.Fatalf("fixture depends on ambient temporary directory: %q", dir)
				}
				if err := os.WriteFile(filepath.Join(dir, "note.md"), []byte("note"), 0600); err != nil {
					t.Fatal(err)
				}
			})
			if _, err := os.Stat(dir); !os.IsNotExist(err) {
				t.Fatalf("fixture was not cleaned up: %q, %v", dir, err)
			}
		})
	}
}
