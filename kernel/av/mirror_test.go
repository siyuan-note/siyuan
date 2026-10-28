// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestGetBlockRelsByAVIDsReturnsReadError(t *testing.T) {
	previousDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = previousDataDir
	})

	mirrorPath := mirrorBlocksPath("")
	if err := os.MkdirAll(filepath.Dir(mirrorPath), 0755); nil != err {
		t.Fatalf("create mirror directory failed: %v", err)
	}
	if err := os.WriteFile(mirrorPath, []byte("invalid"), 0644); nil != err {
		t.Fatalf("write invalid mirror index failed: %v", err)
	}

	if _, err := GetBlockRelsByAVIDs([]string{"20260804000000-viewerr"}); nil == err {
		t.Fatal("an unreadable mirror index should return an error")
	}
}
