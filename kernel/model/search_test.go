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

import "testing"

// TestIsValidSearchBoxPath 覆盖搜索入参的笔记本 ID 与文档路径校验，阻止 SQL 元字符进入语句拼接。
// 回归用例参考 /api/search/fullTextSearchBlock 的 SQL 注入报告（paths[] 投毒）。
func TestIsValidSearchBoxPath(t *testing.T) {
	validBox := "20210808180117-6v0mkxr"

	validCases := []struct {
		name string
		box  string
		path string
	}{
		{"仅笔记本范围", validBox, ""},
		{"仅斜杠", validBox, "/"},
		{"具体文档", validBox, "/20210808180117-6v0mkxr.sy"},
		{"子树目录范围", validBox, "/20210808180117-6v0mkxr"},
		{"子文档完整路径", validBox, "/20210808180117-6v0mkxr/20210808180530-a1b2c3d.sy"},
	}
	for _, tc := range validCases {
		t.Run("valid/"+tc.name, func(t *testing.T) {
			if !IsValidSearchBoxPath(tc.box, tc.path) {
				t.Fatalf("expected valid: box=%q path=%q", tc.box, tc.path)
			}
		})
	}

	invalidCases := []struct {
		name string
		box  string
		path string
	}{
		// 报告中的 UNION 投毒 payload
		{
			"SQL注入UNION投影",
			validBox,
			"/x%') UNION SELECT id,parent_id FROM blocks WHERE path='/hidden.sy' -- ",
		},
		{"单引号断字符串", validBox, "/doc'secret.sy"},
		{"百分号前导", validBox, "/%abc"},
		{"注释标记", validBox, "/doc -- "},
		{"非法box短数字", "123", ""},
		{"非法box大写", "20210808180117-6V0MKXR", ""},
		{"非法box空", "", "/20210808180117-6v0mkxr.sy"},
		{"path缺少前导斜杠", validBox, "20210808180117-6v0mkxr.sy"},
		{"path段非法", validBox, "/notanid.sy"},
		{"path中段非法", validBox, "/20210808180117-6v0mkxr/notanid.sy"},
	}
	for _, tc := range invalidCases {
		t.Run("invalid/"+tc.name, func(t *testing.T) {
			if IsValidSearchBoxPath(tc.box, tc.path) {
				t.Fatalf("expected invalid: box=%q path=%q", tc.box, tc.path)
			}
		})
	}
}

// TestBuildBoxesPathFiltersArgCount 验证参数化过滤器产出的 "?" 数量与 args 长度一致。
func TestBuildBoxesPathFiltersArgCount(t *testing.T) {
	boxes := []string{"20210808180117-6v0mkxr", "20210808180117-a1b2c3d"}
	clause, args := buildBoxesFilter(boxes)
	if countPlaceholder(clause) != len(args) {
		t.Fatalf("box filter placeholder/arg mismatch: %q vs %d args", clause, len(args))
	}
	if len(args) != 2 {
		t.Fatalf("expected 2 box args, got %d", len(args))
	}

	paths := []string{"/20210808180117-6v0mkxr", "/20210808180117-a1b2c3d/20210808180530-e5f6g7h.sy"}
	clause, args = buildPathsFilter(paths)
	if countPlaceholder(clause) != len(args) {
		t.Fatalf("path filter placeholder/arg mismatch: %q vs %d args", clause, len(args))
	}
	if len(args) != 2 {
		t.Fatalf("expected 2 path args, got %d", len(args))
	}
	for i, a := range args {
		s, ok := a.(string)
		if !ok || s != paths[i]+"%" {
			t.Fatalf("path arg %d should be %q%%, got %v", i, paths[i], a)
		}
	}
}

func countPlaceholder(s string) (n int) {
	for i := 0; i < len(s); i++ {
		if s[i] == '?' {
			n++
		}
	}
	return
}
