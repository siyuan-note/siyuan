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
	"fmt"
	"testing"

	"github.com/siyuan-note/dejavu/entity"
)

// files 构造 counts 指定的文件列表：扩展名 -> 文件数。
func files(counts map[string]int) (ret []*entity.File) {
	for ext, count := range counts {
		for i := 0; i < count; i++ {
			ret = append(ret, &entity.File{Path: fmt.Sprintf("/assets/%s-%d.%s", ext, i, ext)})
		}
	}
	return
}

// 第 11 项及之后的类型聚合为 Other，其计数应为这些类型的文件数之和（Issue #19398）。
func TestStatTypesByPathAggregatesOther(t *testing.T) {
	counts := map[string]int{
		"sy": 500, "png": 300, "jpg": 120, "pdf": 40, "mp3": 20,
		"md": 15, "webp": 10, "gif": 8, "zip": 5, "json": 4,
		// 前 10 项之外：
		"svg": 3, "mp4": 2,
	}
	total := 0
	for _, count := range counts {
		total += count
	}

	ret := statTypesByPath(files(counts))

	if 11 != len(ret) {
		t.Fatalf("len = %d, 期望 11（前 10 项 + Other）: %s", len(ret), format(ret))
	}
	other := ret[10]
	if "Other" != other.Type {
		t.Fatalf("ret[10].Type = %q，期望 Other: %s", other.Type, format(ret))
	}
	// svg 3 + mp4 2
	if 5 != other.Count {
		t.Errorf("Other.Count = %d，期望 5: %s", other.Count, format(ret))
	}

	// 各项之和应等于文件总数，用户看到的差额正是这里被漏掉的部分。
	sum := 0
	for _, tc := range ret {
		sum += tc.Count
	}
	if total != sum {
		t.Errorf("各项之和 = %d，文件总数 = %d: %s", sum, total, format(ret))
	}

	// 前 10 项自身的计数不应被聚合改动（util.Ext 返回带点的扩展名）。
	if 500 != ret[0].Count || ".sy" != ret[0].Type {
		t.Errorf("ret[0] = %s %d，期望 .sy 500", ret[0].Type, ret[0].Count)
	}
}

// 类型不超过 10 种时不应出现 Other。
func TestStatTypesByPathWithoutOther(t *testing.T) {
	ret := statTypesByPath(files(map[string]int{"sy": 3, "png": 2, "pdf": 1}))

	if 3 != len(ret) {
		t.Fatalf("len = %d，期望 3: %s", len(ret), format(ret))
	}
	for _, tc := range ret {
		if "Other" == tc.Type {
			t.Errorf("不应出现 Other: %s", format(ret))
		}
	}
}

// 正好 10 种类型时也不聚合（边界：10 < len(ret) 为假）。
func TestStatTypesByPathExactlyTenTypes(t *testing.T) {
	counts := map[string]int{
		"sy": 10, "png": 9, "jpg": 8, "pdf": 7, "mp3": 6,
		"md": 5, "webp": 4, "gif": 3, "zip": 2, "json": 1,
	}

	ret := statTypesByPath(files(counts))

	if 10 != len(ret) {
		t.Fatalf("len = %d，期望 10: %s", len(ret), format(ret))
	}
	sum := 0
	for _, tc := range ret {
		sum += tc.Count
	}
	if 55 != sum {
		t.Errorf("各项之和 = %d，期望 55: %s", sum, format(ret))
	}
}

// 无扩展名的文件归入 NoExt，并参与聚合。
func TestStatTypesByPathNoExt(t *testing.T) {
	ret := statTypesByPath([]*entity.File{
		{Path: "/data/.siyuan/conf"},
		{Path: "/data/widgets/README"},
		{Path: "/assets/a.png"},
	})

	found := false
	for _, tc := range ret {
		if "NoExt" == tc.Type {
			found = true
			if 2 != tc.Count {
				t.Errorf("NoExt.Count = %d，期望 2: %s", tc.Count, format(ret))
			}
		}
	}
	if !found {
		t.Errorf("未统计 NoExt: %s", format(ret))
	}
}

func format(ret []*TypeCount) string {
	s := ""
	for _, tc := range ret {
		s += fmt.Sprintf("%s=%d ", tc.Type, tc.Count)
	}
	return s
}
