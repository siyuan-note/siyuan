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
	"errors"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestAttributeViewRenderContextAggregatesTemplateErrors(t *testing.T) {
	blockKey := av.NewKey("block-key", "Primary Key", "", av.KeyTypeBlock)
	templateKey1 := av.NewKey("template-key-1", "Template 1", "", av.KeyTypeTemplate)
	templateKey1.Template = ".action{if}"
	templateKey2 := av.NewKey("template-key-2", "Template 2", "", av.KeyTypeTemplate)
	templateKey2.Template = ".action{if}"
	attrView := &av.AttributeView{
		ID:   "attribute-view",
		Name: "Tasks",
		KeyValues: []*av.KeyValues{
			{Key: blockKey, Values: []*av.Value{
				newTemplateErrorTestBlockValue(blockKey.ID, "item-b", "Beta"),
				newTemplateErrorTestBlockValue(blockKey.ID, "item-a", "Alpha"),
			}},
			{Key: templateKey1},
			{Key: templateKey2},
		},
	}
	view := &av.View{ID: "view"}
	renderContext := NewAttributeViewRenderContext()

	fillAttributeViewTemplateValues(attrView, view,
		newTemplateErrorTestTable(blockKey, []*av.Key{templateKey1, templateKey2}), nil, renderContext)
	// 模拟父视图和分组子视图重复渲染相同条目。
	fillAttributeViewTemplateValues(attrView, view,
		newTemplateErrorTestTable(blockKey, []*av.Key{templateKey1, templateKey2}), nil, renderContext)

	templateErrors := renderContext.sortedTemplateErrors()
	if 2 != len(templateErrors) {
		t.Fatalf("expected two template field errors, got %d", len(templateErrors))
	}
	for _, templateErr := range templateErrors {
		if 2 != len(templateErr.itemIDs) {
			t.Fatalf("expected two affected items, got %d", len(templateErr.itemIDs))
		}
		if "item-a" != templateErr.itemID || "Alpha" != templateErr.itemName {
			t.Fatalf("unexpected first affected item: id=%q name=%q", templateErr.itemID, templateErr.itemName)
		}
	}

	firstItem := newTemplateErrorTestTable(blockKey, []*av.Key{templateKey1}).Rows[0]
	renderContext.addTemplateError(attrView, templateKey1, firstItem, errors.New("different error"))
	if 3 != len(renderContext.sortedTemplateErrors()) {
		t.Fatal("different errors from the same template field should not be merged")
	}
}

func newTemplateErrorTestBlockValue(keyID, itemID, content string) *av.Value {
	return &av.Value{
		ID:         itemID + "-block-value",
		KeyID:      keyID,
		BlockID:    itemID,
		Type:       av.KeyTypeBlock,
		IsDetached: true,
		Block:      &av.ValueBlock{Content: content},
	}
}

func newTemplateErrorTestTable(blockKey *av.Key, templateKeys []*av.Key) *av.Table {
	ret := &av.Table{}
	for _, item := range []struct {
		id      string
		content string
	}{{id: "item-b", content: "Beta"}, {id: "item-a", content: "Alpha"}} {
		row := &av.TableRow{ID: item.id}
		blockValue := newTemplateErrorTestBlockValue(blockKey.ID, item.id, item.content)
		row.Cells = append(row.Cells, &av.TableCell{BaseValue: &av.BaseValue{
			ID: blockValue.ID, Value: blockValue, ValueType: av.KeyTypeBlock,
		}})
		for _, templateKey := range templateKeys {
			templateValue := &av.Value{
				ID:      item.id + "-" + templateKey.ID,
				KeyID:   templateKey.ID,
				BlockID: item.id,
				Type:    av.KeyTypeTemplate,
				Template: &av.ValueTemplate{
					Content: templateKey.Template,
				},
			}
			row.Cells = append(row.Cells, &av.TableCell{BaseValue: &av.BaseValue{
				ID: templateValue.ID, Value: templateValue, ValueType: av.KeyTypeTemplate,
			}})
		}
		ret.Rows = append(ret.Rows, row)
	}
	return ret
}
