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

package util

import (
	"os"
	"path/filepath"
	"testing"
)

// TestIsEmptyDirIgnoresDSStore 校验判空忽略 .DS_Store，但仍会计入真实文件。
func TestIsEmptyDirIgnoresDSStore(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "dir")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	if !IsEmptyDir(dir) {
		t.Fatal("空目录应判为空")
	}

	if err := os.WriteFile(filepath.Join(dir, ".DS_Store"), nil, 0644); err != nil {
		t.Fatal(err)
	}
	if !IsEmptyDir(dir) {
		t.Fatal("仅含 .DS_Store 的目录应判为空")
	}

	if err := os.WriteFile(filepath.Join(dir, "plugin.json"), []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}
	if IsEmptyDir(dir) {
		t.Fatal("含真实文件的目录不应判为空")
	}
}

// TestRemoveEmptyDir 校验删除仅含 .DS_Store 的目录，并保留含真实文件的目录。
func TestRemoveEmptyDir(t *testing.T) {
	root := t.TempDir()

	onlyDSStore := filepath.Join(root, "only-dsstore")
	if err := os.MkdirAll(onlyDSStore, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(onlyDSStore, ".DS_Store"), nil, 0644); err != nil {
		t.Fatal(err)
	}
	if err := RemoveEmptyDir(onlyDSStore); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(onlyDSStore); !os.IsNotExist(err) {
		t.Fatalf("仅含 .DS_Store 的目录应被删除：%v", err)
	}

	nonEmpty := filepath.Join(root, "non-empty")
	if err := os.MkdirAll(nonEmpty, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nonEmpty, ".DS_Store"), nil, 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nonEmpty, "plugin.json"), []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := RemoveEmptyDir(nonEmpty); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(nonEmpty, "plugin.json")); err != nil {
		t.Fatalf("含真实文件的目录不应被删除：%s", err)
	}

	if err := RemoveEmptyDir(filepath.Join(root, "missing")); err != nil {
		t.Fatalf("目录不存在时应返回 nil：%s", err)
	}
}

func TestMetadataNamedDirectoryIsPreserved(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, ".DS_Store")
	if err := os.Mkdir(dir, 0755); err != nil {
		t.Fatal(err)
	}
	if IsEmptyDir(root) {
		t.Fatal("metadata-named directory must count as content")
	}
	if err := RemoveEmptyDir(root); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dir); err != nil {
		t.Fatal(err)
	}
}

func TestRemoveEmptyDirPreservesSymlinkTarget(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "target")
	if err := os.Mkdir(target, 0755); err != nil {
		t.Fatal(err)
	}
	metadata := filepath.Join(target, ".DS_Store")
	if err := os.WriteFile(metadata, nil, 0644); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(root, "link")
	if err := os.Symlink(target, link); err != nil {
		t.Skipf("symlinks unavailable: %s", err)
	}
	if IsEmptyDir(link) {
		t.Fatal("symlink must not be treated as an empty directory")
	}
	if err := RemoveEmptyDir(link); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(metadata); err != nil {
		t.Fatal(err)
	}
}
