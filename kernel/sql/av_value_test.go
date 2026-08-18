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

package sql

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestFillAttributeViewKeyValuesSkipsMissingKey(t *testing.T) {
	const existingKeyID = "20260806000000-existing"
	attrView := &av.AttributeView{
		ID: "20260806000001-avtest1",
		KeyValues: []*av.KeyValues{{
			Key: &av.Key{ID: existingKeyID, Type: av.KeyTypeText},
		}},
	}
	table := &av.Table{Rows: []*av.TableRow{{
		ID: "20260806000002-item001",
		Cells: []*av.TableCell{{BaseValue: &av.BaseValue{Value: &av.Value{
			ID:      "20260806000003-value01",
			KeyID:   "20260806000004-missing",
			BlockID: "20260806000002-item001",
			Type:    av.KeyTypeText,
			Text:    &av.ValueText{Content: "source"},
		}}}},
	}}}

	fillAttributeViewKeyValues(attrView, table)
	if 0 != len(attrView.KeyValues[0].Values) {
		t.Fatalf("value for a missing key was added to the existing key: %+v", attrView.KeyValues[0].Values)
	}
}

func TestFillAttributeViewBlockRefSubtypes(t *testing.T) {
	const avID = "20260814000000-avtest1"
	dynamic := &av.Value{
		Type: av.KeyTypeBlock,
		Block: &av.ValueBlock{
			ID: "20260814000001-dynamic", Content: "Dynamic",
		},
	}
	static := &av.Value{
		Type: av.KeyTypeBlock,
		Block: &av.ValueBlock{
			ID: "20260814000002-static1", Content: "Old",
		},
	}
	detached := &av.Value{
		Type:       av.KeyTypeBlock,
		IsDetached: true,
		Block:      &av.ValueBlock{Content: "Detached", RefSubtype: av.BlockRefSubtypeStatic},
	}
	attrView := &av.AttributeView{
		ID: avID,
		KeyValues: []*av.KeyValues{{
			Key:    &av.Key{ID: "20260814000003-primary", Type: av.KeyTypeBlock},
			Values: []*av.Value{dynamic, static, detached},
		}},
	}
	attrs := map[string]map[string]string{
		dynamic.Block.ID: {},
		static.Block.ID: {
			av.NodeAttrViewStaticText + "-" + avID: "Static",
		},
	}

	fillAttributeViewBlockRefSubtypes(attrView, attrs)

	if av.BlockRefSubtypeDynamic != dynamic.Block.RefSubtype || "Dynamic" != dynamic.Block.Content {
		t.Fatalf("unexpected dynamic block value: %+v", dynamic.Block)
	}
	if av.BlockRefSubtypeStatic != static.Block.RefSubtype || "Static" != static.Block.Content {
		t.Fatalf("unexpected static block value: %+v", static.Block)
	}
	if "" != detached.Block.RefSubtype {
		t.Fatalf("detached block value retained a reference subtype: %+v", detached.Block)
	}
}
