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
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestGetAttrViewTableAligns(t *testing.T) {
	table := &av.Table{Columns: []*av.TableColumn{
		{BaseInstanceField: &av.BaseInstanceField{ID: "default"}},
		{BaseInstanceField: &av.BaseInstanceField{ID: "left"}, Align: av.TableColumnAlignLeft},
		{BaseInstanceField: &av.BaseInstanceField{ID: "center"}, Align: av.TableColumnAlignCenter},
		{BaseInstanceField: &av.BaseInstanceField{ID: "right"}, Align: av.TableColumnAlignRight},
		{BaseInstanceField: &av.BaseInstanceField{ID: "hidden", Hidden: true}, Align: av.TableColumnAlignRight},
	}}

	if actual, expected := getAttrViewTableAligns(table, false), []int{0, 1, 2, 3, 3}; !reflect.DeepEqual(actual, expected) {
		t.Fatalf("expected table aligns %v, got %v", expected, actual)
	}
	if actual, expected := getAttrViewTableAligns(table, true), []int{0, 1, 2, 3}; !reflect.DeepEqual(actual, expected) {
		t.Fatalf("expected visible table aligns %v, got %v", expected, actual)
	}
}

func TestGetAttrViewCSVRenderedValue(t *testing.T) {
	const keyID = "rendered"
	table := &av.Table{Columns: []*av.TableColumn{{BaseInstanceField: &av.BaseInstanceField{
		ID: keyID, RenderTemplate: ".action{.Value}",
	}}}}
	value := &av.Value{KeyID: keyID, Type: av.KeyTypeText, Text: &av.ValueText{Content: "stored"}}

	if actual, ok := getAttrViewCSVRenderedValue(table, value); !ok || "" != actual {
		t.Fatalf("empty rendered content should not fall back to the stored value: %q, %v", actual, ok)
	}
	value.RenderedContent = "rendered"
	if actual, ok := getAttrViewCSVRenderedValue(table, value); !ok || "rendered" != actual {
		t.Fatalf("unexpected rendered CSV value: %q, %v", actual, ok)
	}
	table.Columns[0].RenderTemplate = ""
	if _, ok := getAttrViewCSVRenderedValue(table, value); ok {
		t.Fatal("a field without a display template should use its stored CSV formatting")
	}
}
