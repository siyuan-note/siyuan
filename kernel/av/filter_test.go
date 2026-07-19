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

package av

import (
	"testing"
	"time"
)

// leaf 构造一个叶子过滤节点。
func leaf(column string) *ViewFilter {
	return &ViewFilter{Column: column, Operator: FilterOperatorIsEmpty, Value: &Value{Type: KeyTypeText}}
}

// group 构造一个分组节点。
func group(combination FilterCombination, filters ...*ViewFilter) *ViewFilter {
	return &ViewFilter{Combination: combination, Filters: filters}
}

func TestViewFilter_IsGroup(t *testing.T) {
	if (&ViewFilter{}).IsGroup() {
		t.Fatalf("empty filter should not be group")
	}
	if !group(FilterCombinationAnd).IsGroup() {
		t.Fatalf("filter with combination should be group")
	}
	// 只有子节点、无 combination 也算分组（容错）
	if !(&ViewFilter{Filters: []*ViewFilter{leaf("c1")}}).IsGroup() {
		t.Fatalf("filter with children should be group")
	}
	if leaf("c1").IsGroup() {
		t.Fatalf("leaf should not be group")
	}
}

func TestNormalizeFiltersAsRoot(t *testing.T) {
	// 空数组返回 nil
	if nil != normalizeFiltersAsRoot(nil) {
		t.Fatalf("nil filters should return nil root")
	}
	if nil != normalizeFiltersAsRoot([]*ViewFilter{}) {
		t.Fatalf("empty filters should return nil root")
	}

	// 已是根组：直接返回
	root := group(FilterCombinationOr, leaf("c1"))
	got := normalizeFiltersAsRoot([]*ViewFilter{root})
	if got != root {
		t.Fatalf("existing root group should be returned as-is")
	}

	// 扁平叶子数组：包成 AND 根组
	flat := []*ViewFilter{leaf("c1"), leaf("c2")}
	got = normalizeFiltersAsRoot(flat)
	if !got.IsGroup() || FilterCombinationAnd != got.Combination {
		t.Fatalf("flat filters should be wrapped as AND root")
	}
	if len(got.Filters) != 2 {
		t.Fatalf("wrapped root should keep all original leaves, got %d", len(got.Filters))
	}
}

func TestCollectLeafColumnIndexes(t *testing.T) {
	fields := []Field{
		&BaseInstanceField{ID: "c1"}, &BaseInstanceField{ID: "c2"}, &BaseInstanceField{ID: "c3"},
	}
	root := group(FilterCombinationAnd,
		leaf("c1"),
		group(FilterCombinationOr, leaf("c2"), leaf("c3")),
	)
	m := map[string]int{}
	collectLeafColumnIndexes([]*ViewFilter{root}, fields, m)
	if m["c1"] != 0 || m["c2"] != 1 || m["c3"] != 2 {
		t.Fatalf("column indexes not collected correctly: %v", m)
	}
}

func TestEvalNode_GroupSemantics(t *testing.T) {
	// 这些用例构造空 value 叶子或缺失列叶子，绕开 Value.Filter，专注分组组合语义。
	colIndex := map[string]int{"c1": 0}

	// 空分组：AND 恒真（不阻断），OR 空集恒假
	if !evalNode(group(FilterCombinationAnd), nil, colIndex, nil, "", nil, nil) {
		t.Fatalf("empty AND group should pass")
	}
	if evalNode(group(FilterCombinationOr), nil, colIndex, nil, "", nil, nil) {
		t.Fatalf("empty OR group should not pass")
	}

	// 空叶子（filter 未配置 Value/RelativeDate）：保留扁平时代 value.Filter 的原语义返回 true（视为通过）。
	// 需要单元格 values[index] 非 nil 才能走到 value.Filter 的早期返回分支。
	emptyLeaf := &ViewFilter{Column: "c1", Operator: FilterOperatorIsEqual}
	values := []*Value{{Type: KeyTypeText}}
	root := group(FilterCombinationAnd, emptyLeaf)
	if !evalNode(root, values, colIndex, nil, "", nil, nil) {
		t.Fatalf("AND group with unconfigured leaf should pass (preserve original value.Filter semantics)")
	}
	root = group(FilterCombinationOr, emptyLeaf)
	if !evalNode(root, values, colIndex, nil, "", nil, nil) {
		t.Fatalf("OR group with unconfigured leaf should pass")
	}

	// 缺失列叶子：列不存在返回 false
	missingCol := &ViewFilter{Column: "cx", Operator: FilterOperatorIsEqual, Value: &Value{Type: KeyTypeText}}
	root = group(FilterCombinationAnd, missingCol)
	if evalNode(root, values, colIndex, nil, "", nil, nil) {
		t.Fatalf("leaf referencing missing column should not pass")
	}
}

func TestIsRollupFilterValueEmpty(t *testing.T) {
	filter := &ViewFilter{
		Value: &Value{Type: KeyTypeRollup, Rollup: &ValueRollup{Contents: []*Value{{Type: KeyTypeDate}}}},
	}
	if !isRollupFilterValueEmpty(filter) {
		t.Fatalf("rollup filter without an absolute value should be empty")
	}

	filter.RelativeDate = &RelativeDate{Unit: RelativeDateUnitDay, Direction: RelativeDateDirectionThis}
	if isRollupFilterValueEmpty(filter) {
		t.Fatalf("rollup filter with a relative date should not be empty")
	}

	filter.RelativeDate = nil
	filter.Value.Rollup.Contents[0].Date = &ValueDate{Content: 1, IsNotEmpty: true}
	if isRollupFilterValueEmpty(filter) {
		t.Fatalf("rollup filter with an absolute date should not be empty")
	}

	filter.RelativeDate = &RelativeDate{Unit: RelativeDateUnitDay, Direction: RelativeDateDirectionThis}
	filter.Value.Rollup.Contents[0] = &Value{Type: KeyTypeNumber}
	if !isRollupFilterValueEmpty(filter) {
		t.Fatalf("relative date should not configure a non-date rollup filter")
	}
}

func TestRollupRelativeDateFilter(t *testing.T) {
	relationKey := NewKey("relation", "关联", "", KeyTypeRelation)
	relationKey.Relation = &Relation{AvID: "target"}
	rollupKey := NewKey("rollup", "汇总", "", KeyTypeRollup)
	rollupKey.Rollup = &Rollup{RelationKeyID: relationKey.ID, KeyID: "date"}
	attrView := &AttributeView{KeyValues: []*KeyValues{
		{Key: relationKey, Values: []*Value{{
			KeyID: relationKey.ID, BlockID: "source-item", Type: KeyTypeRelation,
			Relation: &ValueRelation{BlockIDs: []string{"target-item"}},
		}}},
		{Key: rollupKey},
	}}

	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	targetDate := &Value{
		KeyID: "date", BlockID: "target-item", Type: KeyTypeDate,
		Date: &ValueDate{Content: today.AddDate(0, 0, -1).UnixMilli(), IsNotEmpty: true},
	}
	targetView := &AttributeView{KeyValues: []*KeyValues{{Key: NewKey("date", "日期", "", KeyTypeDate), Values: []*Value{targetDate}}}}
	value := &Value{KeyID: rollupKey.ID, BlockID: "source-item", Type: KeyTypeRollup, Rollup: &ValueRollup{}}
	filter := &ViewFilter{
		Qualifier:    FilterQuantifierAny,
		Operator:     FilterOperatorIsLess,
		Value:        &Value{Type: KeyTypeRollup, Rollup: &ValueRollup{Contents: []*Value{{Type: KeyTypeDate}}}},
		RelativeDate: &RelativeDate{Count: 1, Unit: RelativeDateUnitDay, Direction: RelativeDateDirectionThis},
	}

	if !value.Filter(filter, attrView, "source-item", map[string]Collection{}, map[string]*AttributeView{"target": targetView}) {
		t.Fatalf("rollup date before today should pass the relative date filter")
	}
	targetDate.Date.Content = today.AddDate(0, 0, 1).UnixMilli()
	if value.Filter(filter, attrView, "source-item", map[string]Collection{}, map[string]*AttributeView{"target": targetView}) {
		t.Fatalf("future rollup date should not pass the before-today filter")
	}
}

func TestRemoveFiltersByColumn(t *testing.T) {
	// 树结构：root(AND) → [leaf(c1), group(OR) → [leaf(c2), leaf(c1)]]
	root := group(FilterCombinationAnd, leaf("c1"), group(FilterCombinationOr, leaf("c2"), leaf("c1")))
	got := RemoveFiltersByColumn([]*ViewFilter{root}, "c1")
	if len(got) != 1 {
		t.Fatalf("root should survive, got %d", len(got))
	}
	root = got[0]
	// 顶层 c1 叶子被删，root 只剩 OR 组（其内 c1 也被删，只剩 c2）
	if len(root.Filters) != 1 {
		t.Fatalf("root should have 1 child after prune, got %d", len(root.Filters))
	}
	if !root.Filters[0].IsGroup() {
		t.Fatalf("remaining child should still be group")
	}
	if len(root.Filters[0].Filters) != 1 || root.Filters[0].Filters[0].Column != "c2" {
		t.Fatalf("OR group should retain only c2 leaf")
	}

	// 删除导致分组变空 → 分组被裁剪
	root2 := group(FilterCombinationAnd, leaf("c1"), group(FilterCombinationOr, leaf("c1")))
	got = RemoveFiltersByColumn([]*ViewFilter{root2}, "c1")
	if len(got) != 0 {
		t.Fatalf("root whose all children pruned should be dropped, got %d", len(got))
	}
}

func TestRemoveSelectOptionFromFilters(t *testing.T) {
	sel := &ViewFilter{Column: "c1", Operator: FilterOperatorContains, Value: &Value{
		Type:    KeyTypeSelect,
		MSelect: []*ValueSelect{{Content: "A", Color: "1"}, {Content: "B", Color: "2"}},
	}}
	root := group(FilterCombinationAnd, sel)
	got := RemoveSelectOptionFromFilters([]*ViewFilter{root}, "c1", "A")
	if len(got) != 1 || len(got[0].Filters) != 1 {
		t.Fatalf("filter should survive after removing one option")
	}
	remaining := got[0].Filters[0].Value.MSelect
	if len(remaining) != 1 || remaining[0].Content != "B" {
		t.Fatalf("option A should be removed, got %v", remaining)
	}

	// 删除最后一个选项 → 叶子被移除
	got = RemoveSelectOptionFromFilters([]*ViewFilter{root}, "c1", "A")
	got = RemoveSelectOptionFromFilters(got, "c1", "B")
	if len(got) != 0 {
		t.Fatalf("filter with no options left should be removed, got %d", len(got))
	}
}

func TestRenameSelectOptionInFilters(t *testing.T) {
	sel := &ViewFilter{Column: "c1", Operator: FilterOperatorContains, Value: &Value{
		Type:    KeyTypeMSelect,
		MSelect: []*ValueSelect{{Content: "old", Color: "1"}},
	}}
	nestedSel := &ViewFilter{Column: "c1", Value: &Value{Type: KeyTypeSelect, MSelect: []*ValueSelect{{Content: "old", Color: "1"}}}}
	root := group(FilterCombinationAnd, sel, group(FilterCombinationOr, nestedSel))
	RenameSelectOptionInFilters([]*ViewFilter{root}, "c1", "old", "new", "3")
	if root.Filters[0].Value.MSelect[0].Content != "new" || root.Filters[0].Value.MSelect[0].Color != "3" {
		t.Fatalf("top-level leaf option not renamed")
	}
	nested := root.Filters[1].Filters[0].Value.MSelect[0]
	if nested.Content != "new" || nested.Color != "3" {
		t.Fatalf("nested leaf option not renamed")
	}
}

func TestCloneFilters(t *testing.T) {
	original := []*ViewFilter{group(FilterCombinationAnd, leaf("c1"), group(FilterCombinationOr, leaf("c2")))}
	cloned := CloneFilters(original)
	if len(cloned) != len(original) {
		t.Fatalf("clone length mismatch")
	}
	// 修改克隆不应影响原对象
	cloned[0].Filters[0].Column = "mutated"
	if original[0].Filters[0].Column == "mutated" {
		t.Fatalf("clone should be deep: original leaf column should not change")
	}
	// 嵌套分组也应深拷贝
	if len(cloned[0].Filters[1].Filters) != 1 {
		t.Fatalf("nested group children not cloned")
	}
}

func TestPruneInvalidColumnFilters(t *testing.T) {
	valid := map[string]bool{"c1": true, "c2": true}
	root := group(FilterCombinationAnd,
		leaf("c1"),
		leaf("cx"), // 失效列
		group(FilterCombinationOr, leaf("c2"), leaf("cy")), // cy 失效
	)
	got, changed := PruneInvalidColumnFilters([]*ViewFilter{root}, valid)
	if !changed {
		t.Fatalf("should report changed")
	}
	if len(got) != 1 {
		t.Fatalf("root should survive")
	}
	root = got[0]
	if len(root.Filters) != 2 {
		t.Fatalf("invalid leaf should be pruned, got %d children", len(root.Filters))
	}
	// OR 组只剩 c2
	if len(root.Filters[1].Filters) != 1 || root.Filters[1].Filters[0].Column != "c2" {
		t.Fatalf("OR group should retain only valid c2")
	}

	// 整组失效 → 被裁剪
	root2 := group(FilterCombinationAnd, leaf("cx"), group(FilterCombinationOr, leaf("cy")))
	got, changed = PruneInvalidColumnFilters([]*ViewFilter{root2}, valid)
	if len(got) != 0 || !changed {
		t.Fatalf("fully-invalid root should be dropped")
	}

	// 原本就是空的根组（无筛选条件视图的合法状态）不应报告 changed，否则会误触发保存
	emptyRoot := group(FilterCombinationAnd) // Filters 为 nil
	got, changed = PruneInvalidColumnFilters([]*ViewFilter{emptyRoot}, valid)
	if changed {
		t.Fatalf("originally empty group should not report changed")
	}
	if len(got) != 0 {
		t.Fatalf("empty group should be pruned, got %d", len(got))
	}
}

func TestRemapFilterColumns(t *testing.T) {
	keyIDMap := map[string]string{"c1": "n1", "c2": "n2"}
	root := group(FilterCombinationAnd, leaf("c1"), group(FilterCombinationOr, leaf("c2")))
	remapFilterColumns([]*ViewFilter{root}, keyIDMap)
	if root.Filters[0].Column != "n1" {
		t.Fatalf("top-level leaf column not remapped")
	}
	if root.Filters[1].Filters[0].Column != "n2" {
		t.Fatalf("nested leaf column not remapped")
	}
}

func TestUpgradeSpec5(t *testing.T) {
	// spec 4 + 扁平叶子 → 包装成根组
	av4 := &AttributeView{Spec: 4, Views: []*View{{Filters: []*ViewFilter{leaf("c1"), leaf("c2")}}}}
	UpgradeSpec(av4)
	if av4.Spec != CurrentSpec {
		t.Fatalf("spec should be upgraded to %d, got %d", CurrentSpec, av4.Spec)
	}
	filters := av4.Views[0].Filters
	if len(filters) != 1 || !filters[0].IsGroup() || FilterCombinationAnd != filters[0].Combination {
		t.Fatalf("flat filters should be wrapped as AND root")
	}
	if len(filters[0].Filters) != 2 {
		t.Fatalf("original leaves should be preserved, got %d", len(filters[0].Filters))
	}

	// 已是 spec 5 + 根组 → 不再处理
	existingRoot := group(FilterCombinationOr, leaf("c1"))
	av5 := &AttributeView{Spec: 5, Views: []*View{{Filters: []*ViewFilter{existingRoot}}}}
	UpgradeSpec(av5)
	if av5.Views[0].Filters[0] != existingRoot {
		t.Fatalf("already-rooted spec5 should not be re-wrapped")
	}

	// 空 filters → 包装成空 AND 根组
	avEmpty := &AttributeView{Spec: 4, Views: []*View{{Filters: []*ViewFilter{}}}}
	UpgradeSpec(avEmpty)
	filters = avEmpty.Views[0].Filters
	if len(filters) != 1 || !filters[0].IsGroup() {
		t.Fatalf("empty filters should become empty AND root group")
	}
}
