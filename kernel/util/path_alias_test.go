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

// TestSensitivePathAliases 验证工作空间及家目录别名使用一致的敏感路径规则。
func TestSensitivePathAliases(t *testing.T) {
	realHome, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	alias := filepath.Join(t.TempDir(), "home")
	origHome, origWorkspace := HomeDir, WorkspaceDir
	t.Cleanup(func() { HomeDir, WorkspaceDir = origHome, origWorkspace })
	if err := os.MkdirAll(filepath.Join(realHome, "home"), 0755); err != nil {
		t.Fatal(err)
	}
	for _, layout := range []string{"SiYuan", ".config/SiYuan", "siyuan"} {
		for _, rel := range []string{"data/emojis/robot.svg", "conf/conf.json", "temp/private.txt", "temp/export/doc.html"} {
			p := filepath.Join(realHome, filepath.FromSlash(layout), filepath.FromSlash(rel))
			if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(p, []byte("fixture"), 0600); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := os.Symlink(realHome, alias); err != nil {
		t.Skipf("create directory symlink failed: %s", err)
	}
	for _, layout := range []string{"SiYuan", ".config/SiYuan", "siyuan"} {
		t.Run(layout, func(t *testing.T) {
			HomeDir = alias
			if layout == "siyuan" {
				HomeDir = filepath.Join(alias, "home")
			}
			WorkspaceDir = filepath.Join(alias, filepath.FromSlash(layout))
			resolved, err := filepath.EvalSymlinks(WorkspaceDir)
			if err != nil {
				t.Fatalf("resolve %q: %v", WorkspaceDir, err)
			}
			// 新导出目标尚不存在时也应保留相同的目录访问规则。
			for _, rel := range []string{"data/emojis/robot.svg", "conf/conf.json", "temp/private.txt", "temp/export/doc.html", "conf/new.json", "temp/export/new.html"} {
				want := layout == ".config/SiYuan" || rel == "conf/conf.json" || rel == "conf/new.json" || rel == "temp/private.txt"
				for _, home := range []string{alias, realHome} {
					HomeDir = home
					if layout == "siyuan" {
						HomeDir = filepath.Join(home, "home")
					}
					for _, root := range []string{WorkspaceDir, resolved} {
						p := filepath.Join(root, filepath.FromSlash(rel))
						if got := IsSensitivePath(p); got != want {
							t.Errorf("IsSensitivePath(%q) = %v, want %v (home %q)", p, got, want, home)
						}
					}
				}
			}
		})
	}
}
