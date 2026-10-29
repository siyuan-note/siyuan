// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
