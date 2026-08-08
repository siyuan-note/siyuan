// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package cmd

import (
	"bytes"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestWriteRenderedDatabaseView(t *testing.T) {
	stateKey := &av.Key{ID: "20260806000000-state01", Name: "State", Type: av.KeyTypeSelect}
	hiddenKey := &av.Key{ID: "20260806000000-hidden1", Name: "Hidden", Type: av.KeyTypeText}
	attrView := &av.AttributeView{
		KeyValues: []*av.KeyValues{{Key: stateKey}, {Key: hiddenKey}},
	}
	table := &av.Table{
		BaseInstance: &av.BaseInstance{ID: "20260806000000-view001", Name: "Table"},
		Columns: []*av.TableColumn{
			{BaseInstanceField: &av.BaseInstanceField{ID: stateKey.ID, Name: stateKey.Name, Type: stateKey.Type}},
			{BaseInstanceField: &av.BaseInstanceField{ID: hiddenKey.ID, Name: hiddenKey.Name, Type: hiddenKey.Type, Hidden: true}},
		},
		Rows: []*av.TableRow{{
			ID: "20260806000000-item001",
			Cells: []*av.TableCell{
				{BaseValue: &av.BaseValue{ValueType: av.KeyTypeSelect, Value: &av.Value{
					KeyID: stateKey.ID, BlockID: "20260806000000-item001", Type: av.KeyTypeSelect,
					MSelect: []*av.ValueSelect{{Content: "Todo", Color: "1"}},
				}}},
				{BaseValue: &av.BaseValue{ValueType: av.KeyTypeText, Value: &av.Value{
					KeyID: hiddenKey.ID, BlockID: "20260806000000-item001", Type: av.KeyTypeText,
					Text: &av.ValueText{Content: "secret"},
				}}},
			},
		}},
	}

	var output bytes.Buffer
	if count := writeRenderedView(&output, attrView, table, false); count != 1 {
		t.Fatalf("unexpected rendered item count: %d", count)
	}
	result := output.String()
	if !strings.Contains(result, "ITEM_ID") || !strings.Contains(result, stateKey.Name) ||
		!strings.Contains(result, "20260806000000-item001") || !strings.Contains(result, "Todo") {
		t.Fatalf("unexpected rendered database output: %q", result)
	}
	if strings.Contains(result, hiddenKey.Name) || strings.Contains(result, "secret") {
		t.Fatalf("hidden field leaked into rendered database output: %q", result)
	}
}

func TestWriteGroupedDatabaseView(t *testing.T) {
	key := &av.Key{ID: "20260806000000-key0001", Name: "Name", Type: av.KeyTypeText}
	attrView := &av.AttributeView{KeyValues: []*av.KeyValues{{Key: key}}}
	group := &av.Table{
		BaseInstance: &av.BaseInstance{ID: "20260806000000-group01", Name: "Todo"},
		Columns:      []*av.TableColumn{{BaseInstanceField: &av.BaseInstanceField{ID: key.ID, Name: key.Name, Type: key.Type}}},
		Rows: []*av.TableRow{{
			ID: "20260806000000-item001",
			Cells: []*av.TableCell{{BaseValue: &av.BaseValue{ValueType: av.KeyTypeText, Value: &av.Value{
				KeyID: key.ID, BlockID: "20260806000000-item001", Type: av.KeyTypeText, Text: &av.ValueText{Content: "Task"},
			}}}},
		}},
	}
	root := &av.Table{BaseInstance: &av.BaseInstance{
		ID: "20260806000000-view001", Name: "Table", Groups: []av.Viewable{group},
	}}

	var output bytes.Buffer
	if count := writeRenderedView(&output, attrView, root, false); count != 1 {
		t.Fatalf("unexpected grouped item count: %d", count)
	}
	if result := output.String(); !strings.Contains(result, "[Todo]") || !strings.Contains(result, "Task") {
		t.Fatalf("unexpected grouped database output: %q", result)
	}
}
