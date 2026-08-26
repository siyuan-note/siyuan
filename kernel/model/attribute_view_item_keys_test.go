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
