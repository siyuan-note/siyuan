// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestPathsAffectSync(t *testing.T) {
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = oldDataDir
	})

	outsideDir := t.TempDir()
	outsideFile := filepath.Join(outsideDir, "export.zip")
	writeSyncPathTestFile(t, outsideFile)
	if PathsAffectSync(outsideFile) {
		t.Fatal("workspace path outside data should not affect sync")
	}
	if _, err := os.Stat(filepath.Join(util.DataDir, ".siyuan", "syncignore")); !os.IsNotExist(err) {
		t.Fatal("checking a path outside data should not create syncignore")
	}

	syncIgnorePath := filepath.Join(util.DataDir, ".siyuan", "syncignore")
	if err := os.MkdirAll(filepath.Dir(syncIgnorePath), 0755); nil != err {
		t.Fatal(err)
	}
	ignoreData := []byte("/ignored/**/*\n!/ignored/keep.txt\n/ignored-only/**/*\n")
	if err := os.WriteFile(syncIgnorePath, ignoreData, 0644); nil != err {
		t.Fatal(err)
	}

	trackedFile := filepath.Join(util.DataDir, "assets", "tracked.txt")
	writeSyncPathTestFile(t, trackedFile)
	if !PathsAffectSync(trackedFile) {
		t.Fatal("tracked data file should affect sync")
	}

	ignoredFile := filepath.Join(util.DataDir, "ignored", "drop.txt")
	writeSyncPathTestFile(t, ignoredFile)
	if PathsAffectSync(ignoredFile) {
		t.Fatal("syncignore path should not affect sync")
	}

	unignoredFile := filepath.Join(util.DataDir, "ignored", "keep.txt")
	writeSyncPathTestFile(t, unignoredFile)
	if !PathsAffectSync(unignoredFile) {
		t.Fatal("negated syncignore path should affect sync")
	}

	ignoredDir := filepath.Join(util.DataDir, "ignored-only")
	writeSyncPathTestFile(t, filepath.Join(ignoredDir, "drop.txt"))
	if PathsAffectSync(ignoredDir) {
		t.Fatal("directory containing only ignored files should not affect sync")
	}
	if !PathsAffectSync(filepath.Join(util.DataDir, "ignored")) {
		t.Fatal("directory containing an unignored file should affect sync")
	}

	if !PathsAffectSync(syncIgnorePath) {
		t.Fatal("syncignore changes should affect sync")
	}
	if !PathsAffectSync(filepath.Dir(syncIgnorePath)) {
		t.Fatal("directory containing syncignore should affect sync")
	}
	for _, ignored := range []string{
		filepath.Join(util.DataDir, ".hidden", "file.txt"),
		filepath.Join(util.DataDir, "assets", "upload.tmp"),
		filepath.Join(util.DataDir, "filesys_status_check", "status"),
		filepath.Join(util.DataDir, "storage", "local.json"),
		filepath.Join(util.DataDir, "storage", "recent-doc.json"),
		filepath.Join(util.DataDir, "storage", "ref-used.json"),
		filepath.Join(util.DataDir, "storage", "view-state.json"),
	} {
		writeSyncPathTestFile(t, ignored)
		if PathsAffectSync(ignored) {
			t.Fatalf("repository ignored path should not affect sync: %s", ignored)
		}
	}
}

func TestPathsAffectSyncResolvesSymlinks(t *testing.T) {
	oldDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = oldDataDir
	})

	trackedDir := filepath.Join(util.DataDir, "assets")
	trackedFile := filepath.Join(trackedDir, "tracked.txt")
	writeSyncPathTestFile(t, trackedFile)
	outsideDir := t.TempDir()
	incomingLink := filepath.Join(outsideDir, "data-link")
	if err := os.Symlink(trackedDir, incomingLink); nil != err {
		t.Skipf("create symlink failed: %s", err)
	}
	if !PathsAffectSync(filepath.Join(incomingLink, "tracked.txt")) {
		t.Fatal("path resolving into data should affect sync")
	}

	externalTargetDir := t.TempDir()
	externalTarget := filepath.Join(externalTargetDir, "external.txt")
	writeSyncPathTestFile(t, externalTarget)
	outgoingLink := filepath.Join(util.DataDir, "external-link")
	if err := os.Symlink(externalTargetDir, outgoingLink); nil != err {
		t.Skipf("create symlink failed: %s", err)
	}
	if PathsAffectSync(filepath.Join(outgoingLink, "external.txt")) {
		t.Fatal("path resolving outside data should not affect sync")
	}
}

func writeSyncPathTestFile(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); nil != err {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("test"), 0644); nil != err {
		t.Fatal(err)
	}
}
