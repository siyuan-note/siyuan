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

func TestIsSameOrSubPath(t *testing.T) {
	root := filepath.Join(t.TempDir(), "iCloud")
	tests := []struct {
		name   string
		target string
		want   bool
	}{
		{name: "same", target: root, want: true},
		{name: "same cleaned", target: root + string(os.PathSeparator) + ".", want: true},
		{name: "child", target: filepath.Join(root, "workspace"), want: true},
		{name: "sibling prefix", target: root + "-other", want: false},
		{name: "parent", target: filepath.Dir(root), want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isSameOrSubPath(root, test.target); got != test.want {
				t.Fatalf("isSameOrSubPath(%q, %q) = %v, want %v", root, test.target, got, test.want)
			}
		})
	}
}

func TestLongestExistingPath(t *testing.T) {
	existing := filepath.Join(t.TempDir(), "existing")
	if err := os.MkdirAll(existing, 0755); nil != err {
		t.Fatal(err)
	}
	path := filepath.Join(existing, "missing", "workspace")
	if got := longestExistingPath(path); got != existing {
		t.Fatalf("longestExistingPath(%q) = %q, want %q", path, got, existing)
	}
}

func TestMatchICloudRoot(t *testing.T) {
	home := t.TempDir()
	iCloudRoot := filepath.Join(home, "Library", "Mobile Documents")
	if err := os.MkdirAll(iCloudRoot, 0755); nil != err {
		t.Fatal(err)
	}

	tests := []struct {
		name      string
		workspace string
		want      bool
	}{
		{name: "same", workspace: iCloudRoot, want: true},
		{name: "child", workspace: filepath.Join(iCloudRoot, "workspace"), want: true},
		{name: "outside", workspace: filepath.Join(home, "workspace"), want: false},
		{name: "sibling prefix", workspace: iCloudRoot + "-other", want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, got := matchICloudRoot(home, iCloudRoot, test.workspace)
			if got != test.want {
				t.Fatalf("matchICloudRoot(%q, %q, %q) = %v, want %v", home, iCloudRoot, test.workspace, got, test.want)
			}
		})
	}
}

func TestMatchICloudRootRejectsBroadRoots(t *testing.T) {
	home := t.TempDir()
	workspace := filepath.Join(home, "workspace")
	if _, matched := matchICloudRoot(home, filepath.VolumeName(home)+string(os.PathSeparator), workspace); matched {
		t.Fatal("partition root must not be treated as an iCloud root")
	}
	if _, matched := matchICloudRoot(home, home, workspace); matched {
		t.Fatal("home directory must not be treated as an iCloud root")
	}

	otherHome := t.TempDir()
	otherRoot := filepath.Join(otherHome, "Library", "Mobile Documents")
	if err := os.MkdirAll(otherRoot, 0755); nil != err {
		t.Fatal(err)
	}
	if _, matched := matchICloudRoot(home, otherRoot, filepath.Join(otherRoot, "workspace")); matched {
		t.Fatal("a directory outside home must not be treated as an iCloud root")
	}
}

func TestMatchICloudRootResolvesWorkspaceSymlinks(t *testing.T) {
	home := t.TempDir()
	iCloudRoot := filepath.Join(home, "Library", "Mobile Documents")
	iCloudWorkspace := filepath.Join(iCloudRoot, "workspace")
	localWorkspace := filepath.Join(home, "local-workspace")
	if err := os.MkdirAll(iCloudWorkspace, 0755); nil != err {
		t.Fatal(err)
	}
	if err := os.MkdirAll(localWorkspace, 0755); nil != err {
		t.Fatal(err)
	}

	linkIntoICloud := filepath.Join(home, "link-into-icloud")
	if err := os.Symlink(iCloudWorkspace, linkIntoICloud); nil != err {
		t.Skipf("create symlink failed: %s", err)
	}
	if _, matched := matchICloudRoot(home, iCloudRoot, linkIntoICloud); !matched {
		t.Fatal("workspace symlink pointing into iCloud must be detected")
	}

	linkOutOfICloud := filepath.Join(iCloudRoot, "link-out-of-icloud")
	if err := os.Symlink(localWorkspace, linkOutOfICloud); nil != err {
		t.Fatal(err)
	}
	if _, matched := matchICloudRoot(home, iCloudRoot, linkOutOfICloud); matched {
		t.Fatal("workspace symlink pointing out of iCloud must not be detected")
	}
}

func TestMatchICloudRootIgnoresNestedRootSymlink(t *testing.T) {
	home := t.TempDir()
	iCloudRoot := filepath.Join(home, "Library", "Mobile Documents")
	workspace := filepath.Join(home, "workspace")
	if err := os.MkdirAll(iCloudRoot, 0755); nil != err {
		t.Fatal(err)
	}
	if err := os.MkdirAll(workspace, 0755); nil != err {
		t.Fatal(err)
	}

	rootLink := filepath.Join(iCloudRoot, "root-link")
	if err := os.Symlink(filepath.VolumeName(home)+string(os.PathSeparator), rootLink); nil != err {
		t.Skipf("create symlink failed: %s", err)
	}
	if _, matched := matchICloudRoot(home, iCloudRoot, workspace); matched {
		t.Fatal("a symlink to the partition root inside iCloud must not affect detection")
	}
}
