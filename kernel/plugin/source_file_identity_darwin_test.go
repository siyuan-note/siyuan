// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build darwin

package plugin

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestReadPluginSourceFileIdentityDetectsInPlaceWrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "kernel.js")
	if err := os.WriteFile(path, []byte("initial"), 0644); err != nil {
		t.Fatal(err)
	}
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	beforeDevice, beforeInode, beforeCTime := readPluginSourceFileIdentity(before)

	time.Sleep(10 * time.Millisecond)
	if err = os.WriteFile(path, []byte("changed"), 0644); err != nil {
		t.Fatal(err)
	}
	after, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	afterDevice, afterInode, afterCTime := readPluginSourceFileIdentity(after)

	if beforeDevice != afterDevice || beforeInode != afterInode {
		t.Fatal("in-place write must preserve the file identity")
	}
	if beforeCTime == afterCTime {
		t.Fatal("in-place write must update ctime")
	}
}
