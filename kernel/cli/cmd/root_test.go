// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package cmd

import (
	"path/filepath"
	"testing"
)

func TestIsEncryptedNotebookWorkspacePathWith(t *testing.T) {
	workspace := filepath.Join(string(filepath.Separator), "workspace")
	data := filepath.Join(workspace, "data")
	isEncryptedBox := func(boxID string) bool { return boxID == "encrypted-box" }

	tests := []struct {
		name string
		path string
		want bool
	}{
		{name: "encrypted notebook root", path: filepath.Join("data", "encrypted-box"), want: true},
		{name: "encrypted notebook file", path: filepath.Join("data", "encrypted-box", "20240101000000-abcdefg.sy"), want: true},
		{name: "normal notebook", path: filepath.Join("data", "normal-box", "20240101000000-abcdefg.sy"), want: false},
		{name: "workspace data directory", path: "data", want: false},
		{name: "outside data directory", path: "temp", want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isEncryptedNotebookWorkspacePathWith(test.path, workspace, data, isEncryptedBox); got != test.want {
				t.Fatalf("isEncryptedNotebookWorkspacePathWith(%q) = %v, want %v", test.path, got, test.want)
			}
		})
	}
}
