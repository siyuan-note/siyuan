package model

import (
	"slices"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestGetAttributeViewBacklinkMatches(t *testing.T) {
	srcAttrView := &av.AttributeView{
		ID: "source-av",
		KeyValues: []*av.KeyValues{
			{
				Key: &av.Key{ID: "primary", Type: av.KeyTypeBlock},
				Values: []*av.Value{
					{ID: "primary-value-1", BlockID: "source-item-1", Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "Source 1"}},
					{ID: "primary-value-2", BlockID: "source-item-2", Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "Source 2"}},
				},
			},
			{
				Key: &av.Key{ID: "relation-1", Name: "One-way", Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: "target-av"}},
				Values: []*av.Value{
					{BlockID: "source-item-1", Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{"target-item"}}},
					{BlockID: "source-item-1", Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{"target-item"}}},
					{BlockID: "source-item-2", Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{"other-item"}}},
				},
			},
			{
				Key: &av.Key{ID: "relation-2", Name: "Two-way", Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: "target-av", IsTwoWay: true}},
				Values: []*av.Value{
					{BlockID: "source-item-1", Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{"target-item"}}},
				},
			},
			{
				Key: &av.Key{ID: "relation-3", Name: "Other database", Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: "other-av"}},
				Values: []*av.Value{
					{BlockID: "source-item-2", Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{"target-item"}}},
				},
			},
		},
	}

	matches := getAttributeViewBacklinkMatches(srcAttrView, &attributeViewBacklinkTarget{avID: "target-av", itemID: "target-item"})
	if 1 != len(matches) {
		t.Fatalf("expected one source item, got %d", len(matches))
	}
	relations := matches["source-item-1"]
	if 2 != len(relations) {
		t.Fatalf("expected two relation fields, got %d", len(relations))
	}
	if "relation-1" != relations[0].KeyID || "relation-2" != relations[1].KeyID {
		t.Fatalf("unexpected relation fields: %+v", relations)
	}

	blockValues := getAttributeViewBacklinkBlockValues(srcAttrView)
	if 2 != len(blockValues) || "primary-value-1" != blockValues["source-item-1"].ID {
		t.Fatalf("unexpected primary value index: %+v", blockValues)
	}
	if "source-item-1" != resolveAttributeViewBacklinkItemID(srcAttrView, "source-item-1", "") {
		t.Fatal("failed to resolve a valid item ID")
	}
	if "source-item-2" != resolveAttributeViewBacklinkItemID(srcAttrView, "missing-item", "primary-value-2") {
		t.Fatal("failed to resolve an item ID from its primary value ID")
	}
	if "" != resolveAttributeViewBacklinkItemID(srcAttrView, "missing-item", "missing-value") {
		t.Fatal("unexpected item ID for invalid input")
	}
}

func TestSortAttributeViewBacklinkBlockIDs(t *testing.T) {
	blockIDs := []string{"missing-z", "block-b", "block-a", "missing-a", "block-c"}
	blockTrees := map[string]*treenode.BlockTree{
		"block-a": {ID: "block-a", BoxID: "box-2", HPath: "/a"},
		"block-b": {ID: "block-b", BoxID: "box-1", HPath: "/z"},
		"block-c": {ID: "block-c", BoxID: "box-1", HPath: "/a"},
	}

	sortAttributeViewBacklinkBlockIDs(blockIDs, blockTrees)
	expected := []string{"block-c", "block-a", "block-b", "missing-a", "missing-z"}
	if !slices.Equal(expected, blockIDs) {
		t.Fatalf("expected %v, got %v", expected, blockIDs)
	}
}
