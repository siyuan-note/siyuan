// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestGetAttributeViewItemKeyValuesPrefersRenderedValue(t *testing.T) {
	const (
		itemID        = "20260825000000-item001"
		templateKeyID = "20260825000001-template"
		textKeyID     = "20260825000002-textkey1"
		lineKeyID     = "20260825000003-linekey1"
	)
	staleTemplate := &av.Value{
		ID: "20260825000004-template", KeyID: templateKeyID, BlockID: itemID, Type: av.KeyTypeTemplate,
		Template: &av.ValueTemplate{Content: ".action{old}"},
	}
	storedText := &av.Value{
		ID: "20260825000005-textval1", KeyID: textKeyID, BlockID: itemID, Type: av.KeyTypeText,
		Text: &av.ValueText{Content: "stored"},
	}
	attrView := &av.AttributeView{KeyValues: []*av.KeyValues{
		{Key: &av.Key{ID: templateKeyID, Type: av.KeyTypeTemplate}, Values: []*av.Value{staleTemplate}},
		{Key: &av.Key{ID: textKeyID, Type: av.KeyTypeText}, Values: []*av.Value{storedText}},
		{Key: &av.Key{ID: lineKeyID, Type: av.KeyTypeLineNumber}},
	}}
	renderedTemplate := &av.Value{
		ID: staleTemplate.ID, KeyID: templateKeyID, BlockID: itemID, Type: av.KeyTypeTemplate,
		Template: &av.ValueTemplate{Content: "rendered"},
	}
	table := &av.Table{Rows: []*av.TableRow{{
		ID:    itemID,
		Cells: []*av.TableCell{{BaseValue: &av.BaseValue{Value: renderedTemplate}}},
	}}}

	keyValues := getAttributeViewItemKeyValues(attrView, table, itemID, false)
	if 2 != len(keyValues) {
		t.Fatalf("unexpected key values count: %d", len(keyValues))
	}
	if renderedTemplate != keyValues[0].Values[0] {
		t.Fatalf("rendered template value was not preferred: %+v", keyValues[0].Values[0])
	}
	if storedText != keyValues[1].Values[0] {
		t.Fatalf("stored text fallback was not used: %+v", keyValues[1].Values[0])
	}
}
