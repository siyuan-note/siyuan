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
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRenderAttributeViewRejectsInvalidIDBeforeLookup(t *testing.T) {
	invalidIDs := []string{"../outside", `..\outside`}
	for _, invalidID := range invalidIDs {
		t.Run(invalidID, func(t *testing.T) {
			_, _, err := RenderAttributeView("", invalidID, "", "", 1, -1, nil, false, false)
			if !errors.Is(err, ErrInvalidID) {
				t.Fatalf("invalid attribute view ID [%s] returned error [%v]", invalidID, err)
			}
		})
	}
}

func TestGetRenderAttributeViewViewUsesExplicitView(t *testing.T) {
	firstView := &av.View{ID: "20260731000000-current"}
	requestedView := &av.View{ID: "20260731000000-request"}
	attrView := &av.AttributeView{
		ID:    "20260731000000-avtesta",
		Views: []*av.View{firstView, requestedView},
	}

	view, err := getRenderAttributeViewView(attrView, requestedView.ID, "", "", false)
	if nil != err {
		t.Fatal(err)
	}
	if view != requestedView {
		t.Fatalf("got view [%s], want [%s]", view.ID, requestedView.ID)
	}
	if _, err = getRenderAttributeViewView(attrView, "20260731000000-missing", "", "", false); !errors.Is(err, av.ErrViewNotFound) {
		t.Fatalf("missing explicit view returned error [%v]", err)
	}
}

func TestResolveAttributeViewViewFallbacks(t *testing.T) {
	firstView := &av.View{ID: "20260731000000-first"}
	carrierView := &av.View{ID: "20260731000000-carrier"}
	attrView := &av.AttributeView{Views: []*av.View{firstView, carrierView}}

	view, err := resolveAttributeViewView(attrView, "", carrierView.ID, "")
	if nil != err || view != carrierView {
		t.Fatalf("carrier view resolution failed: %+v, %v", view, err)
	}
	view, err = resolveAttributeViewView(attrView, "", "20260731000000-missing", "")
	if nil != err || view != firstView {
		t.Fatalf("invalid carrier view should fall back to first view: %+v, %v", view, err)
	}
}

func TestImmutableAttributeViewRenderDoesNotWrite(t *testing.T) {
	setupAttributeViewValidationTest(t)

	attrView := av.NewAttributeView("20260731000000-readonly")
	attrView.Spec = 6
	view, err := renderAttributeView(attrView, "", "", attrView.Views[0].ID, "", 1, -1, nil, true, false, nil, "")
	if nil != err {
		t.Fatal(err)
	}
	if view.GetID() != attrView.Views[0].ID || attrView.Spec != av.CurrentSpec {
		t.Fatalf("unexpected immutable render result: %s, spec %d", view.GetID(), attrView.Spec)
	}
	path := filepath.Join(util.DataDir, "storage", "av", attrView.ID+".json")
	if _, err = os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("immutable render wrote attribute view file [%s]: %v", path, err)
	}
}

func TestAttributeViewDataCompatibilityViewID(t *testing.T) {
	firstView := &av.View{ID: "20260731000000-first"}
	data, err := json.Marshal(NewAttributeViewData(&av.AttributeView{Views: []*av.View{nil, firstView}}))
	if nil != err {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(data, &fields); nil != err {
		t.Fatal(err)
	}
	var viewID string
	if err = json.Unmarshal(fields["viewID"], &viewID); nil != err || viewID != firstView.ID {
		t.Fatalf("unexpected compatibility viewID: %s, %v", viewID, err)
	}
}

func TestAttributeViewExternalOutput(t *testing.T) {
	selectKey := &av.Key{
		ID:      "20260806000000-select1",
		Name:    "State",
		Type:    av.KeyTypeSelect,
		Options: []*av.SelectOption{{Name: "Todo", Color: "1", Desc: "Pending work"}},
	}
	view := &av.View{
		ID:         "20260806000000-view001",
		Name:       "Table",
		LayoutType: av.LayoutTypeTable,
		PageSize:   25,
	}
	attrView := &av.AttributeView{
		ID:        "20260806000000-avtest1",
		Name:      "Tasks",
		KeyValues: []*av.KeyValues{{Key: selectKey}},
		Views:     []*av.View{view},
	}

	metadata := NewAttributeViewMetadata(attrView)
	if metadata.ID != attrView.ID || len(metadata.Keys) != 1 || len(metadata.Keys[0].Options) != 1 ||
		metadata.Keys[0].Options[0].Name != "Todo" {
		t.Fatalf("unexpected attribute view metadata: %+v", metadata)
	}
	if len(metadata.Views) != 1 || metadata.Views[0].ID != view.ID || metadata.Views[0].PageSize != view.PageSize {
		t.Fatalf("unexpected attribute view metadata views: %+v", metadata.Views)
	}

	table := &av.Table{BaseInstance: &av.BaseInstance{ID: view.ID, Name: view.Name}}
	rendered := NewAttributeViewRenderData(attrView, table, "todo", 2, 10)
	if rendered.ID != attrView.ID || rendered.ViewID != view.ID || rendered.ViewType != av.LayoutTypeTable ||
		rendered.Query != "todo" || rendered.Page != 2 || rendered.PageSize != 10 || rendered.View != table {
		t.Fatalf("unexpected attribute view render data: %+v", rendered)
	}
}

func TestNewAttributeViewWithLayout(t *testing.T) {
	oldLang, oldAttrViewLangs := util.Lang, util.AttrViewLangs
	util.Lang = "en"
	util.AttrViewLangs = map[string]map[string]any{
		"en": {
			"key":     "Key",
			"select":  "Select",
			"table":   "Table",
			"gallery": "Gallery",
			"kanban":  "Kanban",
		},
	}
	defer func() {
		util.Lang, util.AttrViewLangs = oldLang, oldAttrViewLangs
	}()

	tests := []struct {
		name     string
		layout   av.LayoutType
		expected av.LayoutType
	}{
		{name: "default", expected: av.LayoutTypeTable},
		{name: "table", layout: av.LayoutTypeTable, expected: av.LayoutTypeTable},
		{name: "gallery", layout: av.LayoutTypeGallery, expected: av.LayoutTypeGallery},
		{name: "kanban", layout: av.LayoutTypeKanban, expected: av.LayoutTypeKanban},
		{name: "invalid", layout: av.LayoutType("invalid"), expected: av.LayoutTypeTable},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			attrView := newAttributeViewWithLayout("20260726120000-abcdefg", test.layout)
			if len(attrView.Views) != 1 {
				t.Fatalf("expected one view, got [%d]", len(attrView.Views))
			}
			view := attrView.Views[0]
			if view.LayoutType != test.expected {
				t.Fatalf("expected layout [%s], got [%s]", test.expected, view.LayoutType)
			}
			blockKeyID := attrView.KeyValues[0].Key.ID
			selectKeyID := attrView.KeyValues[1].Key.ID
			switch test.expected {
			case av.LayoutTypeTable:
				if len(view.Table.Columns) != 2 || view.Table.Columns[0].ID != blockKeyID || view.Table.Columns[1].ID != selectKeyID {
					t.Fatalf("unexpected table fields: %+v", view.Table.Columns)
				}
			case av.LayoutTypeGallery:
				if len(view.Gallery.CardFields) != 2 || view.Gallery.CardFields[0].ID != blockKeyID || view.Gallery.CardFields[1].ID != selectKeyID {
					t.Fatalf("unexpected gallery fields: %+v", view.Gallery.CardFields)
				}
			case av.LayoutTypeKanban:
				if len(view.Kanban.Fields) != 2 || view.Kanban.Fields[0].ID != blockKeyID || view.Kanban.Fields[1].ID != selectKeyID {
					t.Fatalf("unexpected kanban fields: %+v", view.Kanban.Fields)
				}
				if nil == view.Group || view.Group.Field != selectKeyID {
					t.Fatalf("expected kanban group field [%s], got [%+v]", selectKeyID, view.Group)
				}
				if len(view.Groups) == 0 {
					t.Fatal("expected kanban groups to be initialized")
				}
			}

			data, err := json.Marshal(attrView)
			if err != nil {
				t.Fatalf("marshal attribute view failed: %s", err)
			}
			restored := &av.AttributeView{}
			if err = json.Unmarshal(data, restored); err != nil {
				t.Fatalf("unmarshal attribute view failed: %s", err)
			}
			if len(restored.Views) != 1 || restored.Views[0].LayoutType != test.expected {
				t.Fatalf("unexpected persisted layout: %+v", restored.Views)
			}
		})
	}
}
