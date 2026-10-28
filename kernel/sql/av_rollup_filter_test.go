// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestFilterAttributeViewItemIDs(t *testing.T) {
	blockKey := &av.Key{ID: "block", Type: av.KeyTypeBlock}
	statusKey := &av.Key{ID: "status", Type: av.KeyTypeText}
	itemA := "20260101000000-aaaaaaa"
	itemB := "20260101000001-bbbbbbb"
	attrView := &av.AttributeView{
		ID:                "target",
		RenderedViewables: map[string]av.Viewable{},
		KeyValues: []*av.KeyValues{
			{
				Key: blockKey,
				Values: []*av.Value{
					{
						ID: itemA + "-block", KeyID: blockKey.ID, BlockID: itemA, Type: av.KeyTypeBlock,
						IsDetached: true, Block: &av.ValueBlock{Content: "A"},
					},
					{
						ID: itemB + "-block", KeyID: blockKey.ID, BlockID: itemB, Type: av.KeyTypeBlock,
						IsDetached: true, Block: &av.ValueBlock{Content: "B"},
					},
				},
			},
			{
				Key: statusKey,
				Values: []*av.Value{
					{
						ID: itemA + "-status", KeyID: statusKey.ID, BlockID: itemA,
						Type: av.KeyTypeText, Text: &av.ValueText{Content: "open"},
					},
					{
						ID: itemB + "-status", KeyID: statusKey.ID, BlockID: itemB,
						Type: av.KeyTypeText, Text: &av.ValueText{Content: "closed"},
					},
				},
			},
		},
	}
	filters := []*av.ViewFilter{{
		Combination: av.FilterCombinationAnd,
		Filters: []*av.ViewFilter{{
			Column:   statusKey.ID,
			Operator: av.FilterOperatorIsEqual,
			Value:    &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "open"}},
		}},
	}}
	depth := 1

	eligible := filterAttributeViewItemIDs(attrView, filters, &depth,
		map[string]*av.AttributeView{attrView.ID: attrView}, NewAttributeViewRenderContext())

	if 1 != len(eligible) || !eligible[itemA] {
		t.Fatalf("unexpected eligible items: %+v", eligible)
	}
}

func TestFilterAttributeViewItemIDsWithRollupDependency(t *testing.T) {
	sourceItem := "20260101000000-aaaaaaa"
	targetItem := "20260101000001-bbbbbbb"
	sourceBlockKey := &av.Key{ID: "source-block", Type: av.KeyTypeBlock}
	relationKey := &av.Key{
		ID: "relation", Type: av.KeyTypeRelation, Relation: &av.Relation{AvID: "target"},
	}
	rollupKey := &av.Key{
		ID: "rollup", Type: av.KeyTypeRollup,
		Rollup: &av.Rollup{
			RelationKeyID: relationKey.ID,
			KeyID:         "target-text",
			Calc:          &av.RollupCalc{Operator: av.CalcOperatorNone},
		},
	}
	sourceView := &av.AttributeView{
		ID:                "source",
		RenderedViewables: map[string]av.Viewable{},
		KeyValues: []*av.KeyValues{
			{
				Key: sourceBlockKey,
				Values: []*av.Value{{
					ID: sourceItem + "-block", KeyID: sourceBlockKey.ID, BlockID: sourceItem,
					Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "Source"},
				}},
			},
			{
				Key: relationKey,
				Values: []*av.Value{{
					ID: sourceItem + "-relation", KeyID: relationKey.ID, BlockID: sourceItem,
					Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: []string{targetItem}},
				}},
			},
			{Key: rollupKey},
		},
	}
	targetBlockKey := &av.Key{ID: "target-block", Type: av.KeyTypeBlock}
	targetTextKey := &av.Key{ID: "target-text", Type: av.KeyTypeText}
	targetView := &av.AttributeView{
		ID:                "target",
		RenderedViewables: map[string]av.Viewable{},
		KeyValues: []*av.KeyValues{
			{
				Key: targetBlockKey,
				Values: []*av.Value{{
					ID: targetItem + "-block", KeyID: targetBlockKey.ID, BlockID: targetItem,
					Type: av.KeyTypeBlock, IsDetached: true, Block: &av.ValueBlock{Content: "Target"},
				}},
			},
			{
				Key: targetTextKey,
				Values: []*av.Value{{
					ID: targetItem + "-text", KeyID: targetTextKey.ID, BlockID: targetItem,
					Type: av.KeyTypeText, Text: &av.ValueText{Content: "match"},
				}},
			},
		},
	}
	filters := []*av.ViewFilter{{
		Combination: av.FilterCombinationAnd,
		Filters: []*av.ViewFilter{{
			Column: rollupKey.ID, Qualifier: av.FilterQuantifierAny, Operator: av.FilterOperatorIsEqual,
			Value: &av.Value{Type: av.KeyTypeRollup, Rollup: &av.ValueRollup{Contents: []*av.Value{{
				Type: av.KeyTypeText, Text: &av.ValueText{Content: "match"},
			}}}},
		}},
	}}
	depth := 1

	eligible := filterAttributeViewItemIDs(sourceView, filters, &depth, map[string]*av.AttributeView{
		sourceView.ID: sourceView,
		targetView.ID: targetView,
	}, NewAttributeViewRenderContext())

	if 1 != len(eligible) || !eligible[sourceItem] {
		t.Fatalf("unexpected eligible items: %+v", eligible)
	}
}
