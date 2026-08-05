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
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
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
