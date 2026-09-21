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

package av

import (
	"encoding/json"
	"math"
	"os"
	"reflect"
	"testing"
)

func TestUpgradeSpec6CardConfiguration(t *testing.T) {
	attrView := &AttributeView{
		Spec: 5,
		Views: []*View{{
			Gallery: &LayoutGallery{
				CardSize:        CardSizeSmall,
				CardAspectRatio: CardAspectRatio3_4,
			},
			Kanban: &LayoutKanban{
				CardSize:        CardSizeLarge,
				CardAspectRatio: CardAspectRatio2_3,
			},
		}},
	}

	UpgradeSpec(attrView)

	if PlainTextSpec != attrView.Spec {
		t.Fatalf("expected spec %d, got %d", PlainTextSpec, attrView.Spec)
	}
	if 180 != attrView.Views[0].Gallery.CardWidth {
		t.Fatalf("expected gallery width 180, got %d", attrView.Views[0].Gallery.CardWidth)
	}
	if math.Abs(3.0/4.0-attrView.Views[0].Gallery.CardAspectRatioValue) > 1e-9 {
		t.Fatalf("unexpected gallery aspect ratio %v", attrView.Views[0].Gallery.CardAspectRatioValue)
	}
	if 320 != attrView.Views[0].Kanban.CardWidth {
		t.Fatalf("expected kanban width 320, got %d", attrView.Views[0].Kanban.CardWidth)
	}
	if math.Abs(2.0/3.0-attrView.Views[0].Kanban.CardAspectRatioValue) > 1e-9 {
		t.Fatalf("unexpected kanban aspect ratio %v", attrView.Views[0].Kanban.CardAspectRatioValue)
	}
}

func TestUpgradeSpec7RemovesPersistedCurrentView(t *testing.T) {
	attrView := &AttributeView{}
	if err := json.Unmarshal([]byte(`{"spec":6,"viewID":"legacy-view","views":[]}`), attrView); nil != err {
		t.Fatal(err)
	}
	UpgradeSpec(attrView)
	if PlainTextSpec != attrView.Spec {
		t.Fatalf("expected spec %d, got %d", PlainTextSpec, attrView.Spec)
	}
	data, err := json.Marshal(attrView)
	if nil != err {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err = json.Unmarshal(data, &fields); nil != err {
		t.Fatal(err)
	}
	if _, ok := fields["viewID"]; ok {
		t.Fatalf("legacy viewID was persisted: %s", data)
	}
}

func TestUpgradeSpec8(t *testing.T) {
	attrView := &AttributeView{Spec: 7}
	UpgradeSpec(attrView)
	if PlainTextSpec != attrView.Spec {
		t.Fatalf("expected spec %d, got %d", PlainTextSpec, attrView.Spec)
	}
}

func TestUpgradeSpec10PreservesLegacyLayouts(t *testing.T) {
	data, err := os.ReadFile("testdata/spec9-layouts.json")
	if nil != err {
		t.Fatal(err)
	}
	attrView, err := ParseAttributeViewData("20260921000000-layouts", data)
	if nil != err || 9 != attrView.Spec {
		t.Fatalf("legacy layout read failed: %v", err)
	}
	before, _ := json.Marshal(attrView)
	UpgradeSpec(attrView)
	if 10 != attrView.Spec || nil != CheckSpec(attrView) {
		t.Fatalf("layouts require spec 10: %d", attrView.Spec)
	}
	upgraded, _ := json.Marshal(attrView)
	readBack, err := ParseAttributeViewData(attrView.ID, upgraded)
	if nil != err || !reflect.DeepEqual(attrView, readBack) {
		t.Fatalf("upgraded layout read failed: %v", err)
	}
	attrView.Spec = 9
	after, _ := json.Marshal(attrView)
	if string(before) != string(after) {
		t.Fatal("upgrade changed layout or item data")
	}

	for _, layout := range attrView.Views[1:] {
		for _, grouped := range []bool{false, true} {
			view := &View{LayoutType: LayoutTypeTable, List: layout.List, Calendar: layout.Calendar}
			if grouped {
				view = &View{LayoutType: LayoutTypeTable, Groups: []*View{view}}
			}
			candidate := &AttributeView{Spec: PlainTextSpec, Views: []*View{nil, view}}
			UpgradeSpec(candidate)
			if 10 != candidate.Spec {
				t.Fatal("inactive or grouped layout was not protected")
			}
			candidate.Views = nil
			UpgradeSpec(candidate)
			if 10 != candidate.Spec {
				t.Fatal("removing layouts downgraded the database")
			}
		}
	}
	for _, spec := range []int{PlainTextSpec, RichTextSpec, CurrentSpec + 1} {
		candidate := &AttributeView{Spec: spec, Views: attrView.Views[:1]}
		UpgradeSpec(candidate)
		if spec != candidate.Spec {
			t.Fatalf("unrelated database spec changed from %d to %d", spec, candidate.Spec)
		}
		if spec > CurrentSpec && CheckSpec(candidate) != ErrSpecTooNew {
			t.Fatal("unknown format was accepted")
		}
	}
}

func TestUpgradeSpec9OnlyForRichText(t *testing.T) {
	plain := &AttributeView{Spec: PlainTextSpec, KeyValues: []*KeyValues{{Values: []*Value{{
		Type: KeyTypeText,
		Text: &ValueText{Content: "**literal**"},
	}}}}}
	UpgradeSpec(plain)
	if PlainTextSpec != plain.Spec {
		t.Fatalf("plain text unexpectedly upgraded to spec %d", plain.Spec)
	}

	rich := &AttributeView{Spec: PlainTextSpec, KeyValues: []*KeyValues{{Values: []*Value{{
		Type: KeyTypeText,
		Text: &ValueText{Rich: &ValueTextRich{
			Spec:    ValueTextRichSpec,
			Format:  ValueTextRichFormatKramdown,
			Content: "**rich**",
		}},
	}}}}}
	UpgradeSpec(rich)
	if RichTextSpec != rich.Spec {
		t.Fatalf("expected rich text spec %d, got %d", RichTextSpec, rich.Spec)
	}

	rich.KeyValues[0].Values[0].Text.Rich = nil
	UpgradeSpec(rich)
	if RichTextSpec != rich.Spec {
		t.Fatalf("rich text spec was downgraded to %d", rich.Spec)
	}

	templateRich := &AttributeView{
		Spec: PlainTextSpec,
		NewItemTemplates: []*NewItemTemplate{{
			FieldValues: map[string]*NewItemFieldValue{
				"text": {
					Value: &Value{
						Type: KeyTypeText,
						Text: &ValueText{Rich: &ValueTextRich{
							Spec:    ValueTextRichSpec,
							Format:  ValueTextRichFormatKramdown,
							Content: "**template**",
						}},
					},
				},
			},
		}},
	}
	UpgradeSpec(templateRich)
	if RichTextSpec != templateRich.Spec {
		t.Fatalf("persisted template rich text did not upgrade spec: %d", templateRich.Spec)
	}

	mismatched := &AttributeView{Spec: PlainTextSpec, KeyValues: rich.KeyValues}
	mismatched.KeyValues[0].Values[0].Text.Rich = &ValueTextRich{
		Spec: ValueTextRichSpec, Format: ValueTextRichFormatKramdown, Content: "rich",
	}
	if err := CheckSpec(mismatched); ErrRichTextSpecMismatch != err {
		t.Fatalf("rich text in plain storage spec was accepted: %v", err)
	}
}
