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

	"github.com/emirpasic/gods/sets/hashset"
)

func TestRemoveEmptyPackageDirs(t *testing.T) {
	basePath := t.TempDir()
	emptyPath := filepath.Join(basePath, "empty", "i18n")
	nonEmptyPath := filepath.Join(basePath, "non-empty", "i18n")
	if err := os.MkdirAll(emptyPath, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(nonEmptyPath, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nonEmptyPath, "en_US.json"), nil, 0644); err != nil {
		t.Fatal(err)
	}

	removeEmptyPackageDirs(basePath, hashset.New("empty", "non-empty", "missing"))

	if _, err := os.Stat(filepath.Join(basePath, "empty")); !os.IsNotExist(err) {
		t.Fatalf("expected empty package directory to be removed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(nonEmptyPath, "en_US.json")); err != nil {
		t.Fatalf("expected non-empty package directory to be preserved: %s", err)
	}
}
