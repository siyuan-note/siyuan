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
	"slices"
	"strings"
	"testing"
)

func TestValidEmbedBlockIDs(t *testing.T) {
	firstID := "20260721120000-block01"
	secondID := "20260721120001-block02"
	thirdID := "20260721120002-block03"
	ids := validEmbedBlockIDs([]string{firstID, "invalid", firstID, secondID, thirdID}, 2)
	if !slices.Equal(ids, []string{firstID, secondID}) {
		t.Fatalf("嵌入块 ID 应保持顺序、去重并限制数量：%v", ids)
	}
}

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

func TestBuildRootIDExclusionFilter(t *testing.T) {
	rootIDs := []string{"20260716120000-abcdefg", "20260716120001-hijklmn"}
	clause, args := buildRootIDExclusionFilter(rootIDs, "b.")
	if " AND b.root_id NOT IN (?, ?)" != clause {
		t.Fatalf("unexpected root ID exclusion filter: %q", clause)
	}
	if countPlaceholder(clause) != len(args) || len(rootIDs) != len(args) {
		t.Fatalf("root ID filter placeholder/arg mismatch: %q vs %d args", clause, len(args))
	}
	for i, arg := range args {
		if rootIDs[i] != arg {
			t.Fatalf("root ID arg %d should be %q, got %v", i, rootIDs[i], arg)
		}
	}

	clause, args = buildRootIDExclusionFilter(nil)
	if "" != clause || 0 != len(args) {
		t.Fatalf("empty root IDs should not generate a filter: %q, %v", clause, args)
	}
}

func TestNormalizeBoxName(t *testing.T) {
	name := "  notebook/name\x00  "
	if normalized := normalizeBoxName(name); "notebookname" != normalized {
		t.Fatalf("unexpected normalized notebook name: %q", normalized)
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

func TestBuildRefUsedOrderBy(t *testing.T) {
	newestID := "20260714120000-newest1"
	olderID := "20260714110000-older01"
	invalidID := "invalid-id' OR 1=1 --"
	orderBy := buildRefUsedOrderBy(map[string]int64{
		olderID:   100,
		newestID:  200,
		invalidID: 300,
	})

	newestPos := strings.Index(orderBy, newestID)
	olderPos := strings.Index(orderBy, olderID)
	if 0 > newestPos || 0 > olderPos || newestPos >= olderPos {
		t.Fatalf("最近引用块应排在较早引用块之前：%q", orderBy)
	}
	if strings.Contains(orderBy, invalidID) {
		t.Fatalf("排序语句不应包含非法块 ID：%q", orderBy)
	}
	if !strings.HasSuffix(orderBy, "END ASC, ") {
		t.Fatalf("排序语句格式错误：%q", orderBy)
	}
}

func TestBuildRefUsedOrderByEmpty(t *testing.T) {
	if orderBy := buildRefUsedOrderBy(nil); "" != orderBy {
		t.Fatalf("空记录不应生成排序语句：%q", orderBy)
	}
}

func TestBuildOrderByPrioritizesExactDocumentAndHeading(t *testing.T) {
	orderBy := buildOrderBy("数学", 0, 0)
	assertOrderBySequence(t, orderBy,
		"content = '数学' AND type = 'd'",
		"content LIKE '%数学%' AND type = 'd'",
		"content = '数学' AND type = 'h'",
		"content LIKE '%数学%' AND type = 'h'",
		"sort ASC",
	)

	orderBy = buildOrderBy("数学", 0, 7)
	assertOrderBySequence(t, orderBy,
		"content = '数学' AND type = 'd'",
		"content = '数学' AND type = 'h'",
		"rank",
	)

	orderBy = buildOrderBy("数学", 0, 6)
	if strings.Contains(orderBy, "content = '数学'") {
		t.Fatalf("按相关度升序不应将完全命中结果置顶：%q", orderBy)
	}
}

func TestBuildOrderByEscapesKeyword(t *testing.T) {
	orderBy := buildOrderBy("O'Reilly", 0, 7)
	if !strings.Contains(orderBy, "content = 'O''Reilly'") {
		t.Fatalf("排序语句中的关键词未正确转义：%q", orderBy)
	}
}

func assertOrderBySequence(t *testing.T, orderBy string, fragments ...string) {
	t.Helper()
	previous := -1
	for _, fragment := range fragments {
		current := strings.Index(orderBy, fragment)
		if 0 > current {
			t.Fatalf("排序语句缺少 %q：%q", fragment, orderBy)
		}
		if current <= previous {
			t.Fatalf("排序优先级顺序错误，%q 未出现在预期位置：%q", fragment, orderBy)
		}
		previous = current
	}
}
