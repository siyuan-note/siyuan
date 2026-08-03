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

package model

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestIsSYNotebookExport(t *testing.T) {
	tests := []struct {
		name          string
		hasBoxConf    bool
		hasBoxDocMeta bool
		want          bool
	}{
		{name: "document export", want: false},
		{name: "notebook export with conf", hasBoxConf: true, want: true},
		{name: "notebook export with document metadata", hasBoxDocMeta: true, want: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isSYNotebookExport(test.hasBoxConf, test.hasBoxDocMeta); got != test.want {
				t.Fatalf("isSYNotebookExport() = %v, want %v", got, test.want)
			}
		})
	}
}

func TestImportFromLocalPathRejectsClosedNotebookBeforeWriting(t *testing.T) {
	fixture := setupFileOperationTest(t)
	boxConf := fixture.box.GetConf()
	boxConf.Closed = true
	if err := fixture.box.SaveConf(boxConf); err != nil {
		t.Fatalf("close test notebook failed: %v", err)
	}

	markdownPath := filepath.Join(t.TempDir(), "document.md")
	if err := os.WriteFile(markdownPath, []byte("# Document"), 0644); err != nil {
		t.Fatalf("write Markdown fixture failed: %v", err)
	}
	pattern := filepath.Join(util.DataDir, fixture.box.ID, "*.sy")
	before, err := filepath.Glob(pattern)
	if err != nil {
		t.Fatalf("list documents before import failed: %v", err)
	}

	err = ImportFromLocalPath(fixture.box.ID, markdownPath, "/")
	if !errors.Is(err, ErrBoxClosed) {
		t.Fatalf("expected closed notebook import to return ErrBoxClosed, got [%v]", err)
	}
	after, err := filepath.Glob(pattern)
	if err != nil {
		t.Fatalf("list documents after import failed: %v", err)
	}
	if len(after) != len(before) {
		t.Fatalf("closed notebook import wrote documents: before=%d, after=%d", len(before), len(after))
	}
}

func TestReplaceAssetNamePreservesExistingQuery(t *testing.T) {
	assetNameMap := map[string]string{"document.pdf": "encrypted.pdf"}
	boxSuffix := "?box=20260731190414-j45dgmm"
	tests := []struct {
		path string
		want string
	}{
		{
			path: "assets/document.pdf",
			want: "assets/encrypted.pdf?box=20260731190414-j45dgmm",
		},
		{
			path: "assets/document.pdf?page=2",
			want: "assets/encrypted.pdf?page=2&box=20260731190414-j45dgmm",
		},
		{
			path: "assets/document.pdf?box=20260731190414-j45dgmm",
			want: "assets/encrypted.pdf?box=20260731190414-j45dgmm",
		},
	}

	for _, test := range tests {
		if got := replaceAssetName(test.path, assetNameMap, boxSuffix); got != test.want {
			t.Fatalf("replaceAssetName(%q) = %q, want %q", test.path, got, test.want)
		}
	}
}
