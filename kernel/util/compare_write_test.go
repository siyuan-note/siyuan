// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAssetRelinkCompareWrite(t *testing.T) {
	abs := filepath.Join(t.TempDir(), "source")
	if err := WriteFileIfUnchanged(abs, nil, []byte("original")); err != nil {
		t.Fatal(err)
	}
	for _, original := range [][]byte{nil, []byte("stale")} {
		if err := WriteFileIfUnchanged(abs, original, []byte("replacement")); err == nil {
			t.Fatal("concurrent change overwritten")
		}
		data, _ := os.ReadFile(abs)
		if string(data) != "original" {
			t.Fatal("original changed")
		}
	}
	if err := WriteFileIfUnchanged(abs, []byte("original"), []byte("replacement")); err != nil {
		t.Fatal(err)
	}
}
