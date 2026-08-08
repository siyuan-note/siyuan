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
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestRemoveAttributeViewBoundBlocks(t *testing.T) {
	deletedValue1 := &av.Value{Block: &av.ValueBlock{ID: "20260805000000-deleted1"}}
	keptValue := &av.Value{Block: &av.ValueBlock{ID: "20260805000000-kept"}}
	deletedValue2 := &av.Value{Block: &av.ValueBlock{ID: "20260805000000-deleted2"}}
	nilBlockValue := &av.Value{}
	attrView := &av.AttributeView{KeyValues: []*av.KeyValues{{
		Key: &av.Key{Type: av.KeyTypeBlock},
		Values: []*av.Value{
			deletedValue1,
			keptValue,
			deletedValue2,
			nil,
			nilBlockValue,
		},
	}}}

	changed := removeAttributeViewBoundBlocks(attrView, map[string]struct{}{
		"20260805000000-deleted1": {},
		"20260805000000-deleted2": {},
	})

	if !changed {
		t.Fatal("expected bound blocks to be removed")
	}
	values := attrView.GetBlockKeyValues().Values
	if 3 != len(values) || keptValue != values[0] || nil != values[1] || nilBlockValue != values[2] {
		t.Fatalf("unexpected remaining values: %#v", values)
	}
	if removeAttributeViewBoundBlocks(attrView, map[string]struct{}{"20260805000000-missing": {}}) {
		t.Fatal("an unrelated block ID should not change the attribute view")
	}
}

func TestCollectDeletedAttributeViewBlocks(t *testing.T) {
	avID1 := "20260805000000-av1"
	avID2 := "20260805000000-av2"
	root := treenode.NewParagraph(ast.NewNodeID())
	root.SetIALAttr(av.NodeAttrNameAvs, avID1)
	child := treenode.NewParagraph(ast.NewNodeID())
	child.SetIALAttr(av.NodeAttrNameAvs, avID1+","+avID2)
	root.AppendChild(child)

	deletedAttrViewBlockIDs := map[string]map[string]struct{}{}
	collectDeletedAttributeViewBlocks(root, true, deletedAttrViewBlockIDs)
	if 2 != len(deletedAttrViewBlockIDs) {
		t.Fatalf("expected 2 attribute views, got %d", len(deletedAttrViewBlockIDs))
	}
	if blockIDs, ok := deletedAttrViewBlockIDs[avID1]; !ok || 2 != len(blockIDs) {
		t.Fatalf("expected 2 blocks bound to [%s], got %#v", avID1, blockIDs)
	}
	if blockIDs, ok := deletedAttrViewBlockIDs[avID2]; !ok || 1 != len(blockIDs) {
		if _, ok := blockIDs[child.ID]; !ok {
			t.Fatalf("expected child block bound to [%s], got %#v", avID2, blockIDs)
		}
	}

	deletedAttrViewBlockIDs = map[string]map[string]struct{}{}
	collectDeletedAttributeViewBlocks(root, false, deletedAttrViewBlockIDs)
	if blockIDs, ok := deletedAttrViewBlockIDs[avID1]; !ok || 1 != len(blockIDs) {
		if _, ok := blockIDs[root.ID]; !ok {
			t.Fatalf("expected only root block bound to [%s], got %#v", avID1, blockIDs)
		}
	}
	if _, ok := deletedAttrViewBlockIDs[avID2]; ok {
		t.Fatal("child block should not be collected when delChildrenWhenDelParent is false")
	}
}

func TestGroupDeletedAttributeViewBlocks(t *testing.T) {
	deletedAttrViewBlockIDs := groupDeletedAttributeViewBlocks(map[string][]string{
		"20260807000000-block1": {"20260807000000-av1", "20260807000000-av2", "20260807000000-av1"},
		"20260807000000-block2": {"20260807000000-av1", ""},
		"":                      {"20260807000000-av3"},
	})

	if 2 != len(deletedAttrViewBlockIDs) {
		t.Fatalf("expected 2 attribute views, got %#v", deletedAttrViewBlockIDs)
	}
	if blockIDs := deletedAttrViewBlockIDs["20260807000000-av1"]; 2 != len(blockIDs) {
		t.Fatalf("expected 2 blocks for av1, got %#v", blockIDs)
	}
	if blockIDs := deletedAttrViewBlockIDs["20260807000000-av2"]; 1 != len(blockIDs) {
		t.Fatalf("expected 1 block for av2, got %#v", blockIDs)
	}
	if _, exists := deletedAttrViewBlockIDs["20260807000000-av3"]; exists {
		t.Fatal("an empty block ID should be ignored")
	}
}
