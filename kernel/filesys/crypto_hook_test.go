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

package filesys

import (
	"strings"
	"testing"
)

// TestSyObjectBase 校验稳定文件基名的提取与合法性。
// .sy 的 AAD 绑定 <rootID>.sy，父目录不参与，因此提取器必须正确剥离目录前缀并严格校验。
func TestSyObjectBase(t *testing.T) {
	validBase := "20240101120000-1a2b3c4.sy"

	cases := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{"bare valid", validBase, validBase, false},
		{"leading slash", "/20240101120000-1a2b3c4.sy", validBase, false},
		{"with parent dir", "/20240101120000-aaa/20240101120000-1a2b3c4.sy", validBase, false},
		{"deep parent dir", "20240101120000-aaa/20240101120000-bbb/20240101120000-1a2b3c4.sy", validBase, false},
		{"windows backslash", "\\20240101120000-aaa\\20240101120000-1a2b3c4.sy", validBase, false},
		{"non-sy extension", "/20240101120000-1a2b3c4.json", "", true},
		{"no extension", "/20240101120000-1a2b3c4", "", true},
		{"bad stem not node id", "/notanid.sy", "", true},
		{"stem too short", "/2024010-abc.sy", "", true},
		{"empty", "", "", true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := SyObjectBase(c.input)
			if c.wantErr {
				if err == nil {
					t.Fatalf("expected error for input %q, got %q", c.input, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error for input %q: %v", c.input, err)
			}
			if got != c.want {
				t.Fatalf("SyObjectBase(%q) = %q, want %q", c.input, got, c.want)
			}
		})
	}
}

// TestSyAADIndependentOfParentDir 校验 AAD 只依赖稳定文件基名，不依赖父目录。
// 这是「同 box 内文件名不变的移动可原样 Rename 密文」的密码学前提：
// 同一基名、不同父目录构造出的 AAD 必须完全相同。
func TestSyAADIndependentOfParentDir(t *testing.T) {
	boxID := "20240101120000-boxid01"
	base := "20240101120000-1a2b3c4.sy"

	aadBare, err := SyAAD(boxID, base)
	if err != nil {
		t.Fatal(err)
	}
	aadWithDir, err := SyAAD(boxID, "/20240101120000-parent/"+base)
	if err != nil {
		t.Fatal(err)
	}
	aadDeepDir, err := SyAAD(boxID, "20240101120000-a/20240101120000-b/"+base)
	if err != nil {
		t.Fatal(err)
	}

	if aadBare != aadWithDir || aadBare != aadDeepDir {
		t.Fatalf("AAD must be independent of parent dir: bare=%q dir=%q deep=%q", aadBare, aadWithDir, aadDeepDir)
	}
	// AAD 不应包含目录分隔符，只含基名
	if strings.Contains(strings.TrimPrefix(aadBare, "siyuan:v1:file:"+boxID+":"), "/") {
		t.Fatalf("AAD must not contain path separator: %q", aadBare)
	}
}

// TestSyAADRejectsInvalidBase 校验非法基名直接报错，不产生可用于加密的 AAD。
func TestSyAADRejectsInvalidBase(t *testing.T) {
	if _, err := SyAAD("20240101120000-boxid01", "random.txt"); err == nil {
		t.Fatal("should reject non-.sy base")
	}
	if _, err := SyAAD("20240101120000-boxid01", "notanid.sy"); err == nil {
		t.Fatal("should reject non-node-id stem")
	}
}
