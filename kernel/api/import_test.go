// SiYuan - Refactor your thinking
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

package api

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestIsValidSYImportToken(t *testing.T) {
	tests := []struct {
		name  string
		token string
		want  bool
	}{
		{name: "valid", token: "0123456789abcdefghijklmnopqrstuv", want: true},
		{name: "too short", token: "0123456789abcdefghijklmnopqrstu"},
		{name: "path traversal", token: "../23456789abcdefghijklmnopqrstuv"},
		{name: "separator", token: "0123456789abcdefghij/klmnopqrstu"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isValidSYImportToken(test.token); got != test.want {
				t.Fatalf("isValidSYImportToken() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestStageAndClaimSYImport(t *testing.T) {
	tempDir := t.TempDir()
	originalTempDir := util.TempDir
	util.TempDir = tempDir
	t.Cleanup(func() {
		util.TempDir = originalTempDir
	})

	srcPath := filepath.Join(tempDir, "document.sy.zip")
	data := []byte("archive")
	if err := os.WriteFile(srcPath, data, 0644); err != nil {
		t.Fatal(err)
	}
	token, err := stageSYImport(srcPath)
	if err != nil {
		t.Fatal(err)
	}
	if !isValidSYImportToken(token) {
		t.Fatalf("invalid staged token %q", token)
	}
	if _, err = os.Stat(srcPath); !os.IsNotExist(err) {
		t.Fatalf("source archive still exists: %v", err)
	}

	claimedPath, err := claimStagedSYImport(token)
	if err != nil {
		t.Fatal(err)
	}
	claimedData, err := os.ReadFile(claimedPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(claimedData) != string(data) {
		t.Fatalf("claimed archive data = %q, want %q", claimedData, data)
	}
	if _, err = claimStagedSYImport(token); err == nil {
		t.Fatal("claimed import should not be claimable again")
	}
}
