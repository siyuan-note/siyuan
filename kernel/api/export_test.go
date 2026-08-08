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

package api

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCopyExportFileToDestination(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "source.zip")
	dest := filepath.Join(dir, "destination.zip")

	if err := os.WriteFile(src, []byte("new export"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(dest, []byte("old export"), 0644); err != nil {
		t.Fatal(err)
	}

	if err := copyExportFileToDestination(src, dest); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(dest)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(data), "new export"; got != want {
		t.Fatalf("destination content = %q, want %q", got, want)
	}
	assertNoExportTempFiles(t, dir)
}

func TestCopyExportFileToDestinationCreatesParent(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "source.zip")
	dest := filepath.Join(dir, "new", "destination.zip")

	if err := os.WriteFile(src, []byte("new export"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := copyExportFileToDestination(src, dest); err != nil {
		t.Fatal(err)
	}

	data, err := os.ReadFile(dest)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(data), "new export"; got != want {
		t.Fatalf("destination content = %q, want %q", got, want)
	}
	assertNoExportTempFiles(t, filepath.Dir(dest))
}

func TestCopyExportFileToDestinationReplaceFailure(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "source.zip")
	dest := filepath.Join(dir, "destination.zip")

	if err := os.WriteFile(src, []byte("new export"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(dest, 0755); err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(dest, "marker")
	if err := os.WriteFile(marker, []byte("old export"), 0644); err != nil {
		t.Fatal(err)
	}

	if err := copyExportFileToDestination(src, dest); err == nil {
		t.Fatal("expected replacing a directory to fail")
	}

	data, err := os.ReadFile(marker)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(data), "old export"; got != want {
		t.Fatalf("existing destination content = %q, want %q", got, want)
	}
	assertNoExportTempFiles(t, dir)
}

func assertNoExportTempFiles(t *testing.T, dir string) {
	t.Helper()

	matches, err := filepath.Glob(filepath.Join(dir, ".siyuan-export-*.tmp"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 0 {
		t.Fatalf("temporary export files were not cleaned up: %v", matches)
	}
}
