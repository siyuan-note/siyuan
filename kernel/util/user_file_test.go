// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"os"
	"path/filepath"
	"testing"
)

func TestUserFileAccessOutsideWorkspace(t *testing.T) {
	previous := WorkspaceDir
	WorkspaceDir = t.TempDir()
	t.Cleanup(func() { WorkspaceDir = previous })
	external := t.TempDir()
	source, destination := filepath.Join(external, "source"), filepath.Join(external, "copy")
	if isManagedWorkspaceFile(source) || !isManagedWorkspaceFile(filepath.Join(WorkspaceDir, "data", "file")) {
		t.Fatal("incorrect workspace boundary")
	}
	if err := WriteUserFile(source, []byte("content")); err != nil {
		t.Fatal(err)
	}
	if err := CopyUserFile(source, destination); err != nil {
		t.Fatal(err)
	}
	data, err := ReadUserFile(destination)
	if err != nil || string(data) != "content" {
		t.Fatal(string(data), err)
	}
	denySkillSourceRead(t, source)
	if _, err = ReadUserFile(source); !os.IsPermission(err) {
		t.Fatal("unreadable external file did not return its error", err)
	}
	if err = CopyUserFile(source, filepath.Join(external, "denied-copy")); err == nil {
		t.Fatal("copy of unreadable external file succeeded")
	}
	if _, ok := GetMimeTypeByPath(source); ok {
		t.Fatal("MIME detection succeeded for an unreadable file")
	}
}
