// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"testing"

	"github.com/88250/lute/ast"
)

func subItemsFixture(count int) (*AttributeView, []string) {
	a := &AttributeView{ID: ast.NewNodeID(), Spec: SubItemsSpec}
	a.SubItems = &SubItemsConfig{Enabled: true, ParentKeyID: ast.NewNodeID(), ChildrenKeyID: ast.NewNodeID()}
	primary := &KeyValues{Key: &Key{ID: ast.NewNodeID(), Type: KeyTypeBlock}}
	a.KeyValues = []*KeyValues{primary,
		{Key: &Key{ID: a.SubItems.ParentKeyID, Type: KeyTypeRelation, Relation: &Relation{AvID: a.ID, IsTwoWay: true, BackKeyID: a.SubItems.ChildrenKeyID}}},
		{Key: &Key{ID: a.SubItems.ChildrenKeyID, Type: KeyTypeRelation, Relation: &Relation{AvID: a.ID, IsTwoWay: true, BackKeyID: a.SubItems.ParentKeyID}}}}
	ids := make([]string, count)
	for i := range ids {
		ids[i] = fmt.Sprintf("item-%d", i)
		primary.Values = append(primary.Values, &Value{ID: ast.NewNodeID(), KeyID: primary.Key.ID, BlockID: ids[i], Type: KeyTypeBlock, IsDetached: true, Block: &ValueBlock{Content: ids[i]}})
	}
	a.Views = []*View{{ID: ast.NewNodeID(), ItemIDs: slices.Clone(ids)}}
	return a, ids
}

func TestSubItemsBatchGraphConstraints(t *testing.T) {
	a, ids := subItemsFixture(5)
	if err := a.SetSubItemsParents(map[string]string{ids[1]: ids[0], ids[2]: ids[1], ids[3]: ids[0]}); err != nil {
		t.Fatal(err)
	}
	before, _ := json.Marshal(a)
	if err := a.SetSubItemsParents(map[string]string{ids[0]: ids[2]}); err == nil {
		t.Fatal("accepted cycle")
	}
	after, _ := json.Marshal(a)
	if string(before) != string(after) {
		t.Fatal("failed move changed source")
	}
	if err := a.SetSubItemsParents(map[string]string{ids[1]: ids[2], ids[2]: ids[0]}); err != nil {
		t.Fatalf("rejected valid final graph: %v", err)
	}
	if err := a.SetSubItemsParents(map[string]string{ids[2]: ids[4]}); err != nil {
		t.Fatal(err)
	}
	index, err := a.BuildSubItemsIndex()
	if err != nil {
		t.Fatal(err)
	}
	if index.Parents[ids[2]] != ids[4] || slices.Contains(index.Children[ids[0]], ids[2]) || index.Parents[ids[1]] != ids[2] {
		t.Fatal("move did not preserve the entire subtree", index)
	}
}

func TestSubItemsRejectInvalidSources(t *testing.T) {
	for _, name := range []string{"multiple", "self", "missing", "inverse", "field", "nil-field", "nil-view", "duplicate-row"} {
		t.Run(name, func(t *testing.T) {
			a, ids := subItemsFixture(3)
			if err := a.SetSubItemsParents(map[string]string{ids[1]: ids[0]}); err != nil {
				t.Fatal(err)
			}
			parents, _ := a.GetKeyValues(a.SubItems.ParentKeyID)
			switch name {
			case "multiple":
				parents.Values[0].Relation.BlockIDs = []string{ids[0], ids[2]}
			case "self":
				parents.Values[0].Relation.BlockIDs = []string{ids[1]}
			case "missing":
				parents.Values[0].Relation.BlockIDs = []string{"missing"}
			case "inverse":
				a.KeyValues[2].Values = nil
			case "field":
				parents.Key.Relation.IsTwoWay = false
			case "nil-field":
				a.KeyValues = append(a.KeyValues, nil)
			case "nil-view":
				a.Views = append(a.Views, nil)
			case "duplicate-row":
				a.KeyValues[0].Values = append(a.KeyValues[0].Values, a.KeyValues[0].Values[0])
			}
			if err := a.ValidateSubItems(); err == nil {
				t.Fatal("accepted corrupt hierarchy")
			}
		})
	}
}

func TestSubItemsPromotionAndFormat(t *testing.T) {
	a, ids := subItemsFixture(5)
	if err := a.SetSubItemsParents(map[string]string{ids[1]: ids[0], ids[2]: ids[1], ids[3]: ids[2], ids[4]: ids[0]}); err != nil {
		t.Fatal(err)
	}
	if err := a.PromoteSubItemsForRemoval([]string{ids[1], ids[2]}); err != nil {
		t.Fatal(err)
	}
	for _, kv := range a.KeyValues {
		kv.Values = slices.DeleteFunc(kv.Values, func(v *Value) bool { return v.BlockID == ids[1] || v.BlockID == ids[2] })
	}
	index, err := a.BuildSubItemsIndex()
	if err != nil {
		t.Fatal(err)
	}
	if index.Parents[ids[3]] != ids[0] || !reflect.DeepEqual(a.Views[0].ItemIDs, []string{ids[0], ids[3], ids[4]}) {
		t.Fatal("deletion did not promote children in place")
	}
	a.Spec = PlainTextSpec
	if err = CheckSpec(a); err == nil {
		t.Fatal("accepted hierarchy in legacy format")
	}
	UpgradeSpec(a)
	if a.Spec != SubItemsSpec {
		t.Fatal(a.Spec)
	}
	a.SubItems.Enabled = false
	UpgradeSpec(a)
	if a.Spec != SubItemsSpec {
		t.Fatal("disabled database format was downgraded")
	}
	old, _ := subItemsFixture(0)
	old.Spec, old.SubItems = PlainTextSpec, nil
	UpgradeSpec(old)
	if old.Spec != PlainTextSpec {
		t.Fatal("unrelated database was upgraded")
	}
}

func TestSubItemsPromotionUsesParentPositionAcrossViews(t *testing.T) {
	a, ids := subItemsFixture(5)
	if err := a.SetSubItemsParents(map[string]string{ids[2]: ids[0], ids[3]: ids[0], ids[4]: ids[2]}); err != nil {
		t.Fatal(err)
	}
	a.Views[0].ItemIDs = []string{ids[2], ids[1], ids[0], ids[3], ids[4]}
	second := *a.Views[0]
	second.ID = ast.NewNodeID()
	second.ItemIDs = []string{ids[3], ids[4], ids[1], ids[0], ids[2]}
	a.Views = append(a.Views, &second)
	if err := a.PromoteSubItemsForRemoval([]string{ids[0]}); err != nil {
		t.Fatal(err)
	}
	want := [][]string{{ids[1], ids[2], ids[3], ids[4]}, {ids[4], ids[1], ids[3], ids[2]}}
	for i, view := range a.Views {
		if !slices.Equal(view.ItemIDs, want[i]) {
			t.Fatalf("view %d: promoted order %v, want %v", i, view.ItemIDs, want[i])
		}
	}
	index, err := a.BuildSubItemsIndex()
	if err != nil || index.Parents[ids[4]] != ids[2] {
		t.Fatalf("surviving subtree changed: %v", err)
	}
}

func TestSubItemsDeepAndWideTrees(t *testing.T) {
	for _, shape := range []string{"deep", "wide"} {
		t.Run(shape, func(t *testing.T) {
			a, ids := subItemsFixture(12000)
			changes := make(map[string]string, len(ids))
			for i := 1; i < len(ids); i++ {
				parent := ids[0]
				if shape == "deep" {
					parent = ids[i-1]
				}
				changes[ids[i]] = parent
			}
			if err := a.SetSubItemsParents(changes); err != nil {
				t.Fatal(err)
			}
			if err := a.PromoteSubItemsForRemoval(ids[:len(ids)-1]); err != nil {
				t.Fatal(err)
			}
			index, err := a.BuildSubItemsIndex()
			if err != nil || index.Parents[ids[len(ids)-1]] != "" {
				t.Fatal("deep promotion failed", err)
			}
		})
	}
}

func TestSubItemsTemplateClone(t *testing.T) {
	a, ids := subItemsFixture(3)
	if err := a.SetSubItemsParents(map[string]string{ids[1]: ids[0], ids[2]: ids[1]}); err != nil {
		t.Fatal(err)
	}
	clone := a.Clone()
	if clone == nil || clone.ID == a.ID || clone.SubItems.ParentKeyID == a.SubItems.ParentKeyID || clone.SubItems.ChildrenKeyID == a.SubItems.ChildrenKeyID {
		t.Fatal("template clone did not remap hierarchy fields")
	}
	if err := clone.ValidateSubItems(); err != nil {
		t.Fatal(err)
	}
	index, err := clone.BuildSubItemsIndex()
	if err != nil || len(index.Parents) != 0 {
		t.Fatal("template clone copied source entries", err)
	}
}
