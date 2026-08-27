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

func TestApplyRelatedCustomColorRenderContext(t *testing.T) {
	historicalColor := customColorForContextTest("#010203", "#040506", "#070809", "#0a0b0c")
	context := &av.CustomColorRenderContext{ResolveRelatedCustomColors: func(string) (
		[]*av.AttributeViewCustomColor, []string, bool,
	) {
		return []*av.AttributeViewCustomColor{historicalColor}, []string{"15", "1"}, true
	}}
	source := &av.AttributeView{CustomColorRenderContext: context}
	target, key, value := relatedCustomColorTargetForContextTest(t)

	applyRelatedCustomColorRenderContext(source, target)

	if target.CustomColorRenderContext != context {
		t.Fatal("related render context was not propagated")
	}
	if target.KeyValues[0].Key != key || target.KeyValues[0].Values[0] != value || "Current value" != value.MSelect[0].Content {
		t.Fatal("applying a historical palette changed the current target value source")
	}
	if 1 != len(target.Palette()) || "#010203" != target.Palette()[0].Light.Color {
		t.Fatalf("unexpected historical palette: %+v", target.Palette())
	}
	if nil == key.Options[0].ResolvedColor || "#010203" != key.Options[0].ResolvedColor.Light.Color {
		t.Fatalf("option did not use the historical target palette: %+v", key.Options[0].ResolvedColor)
	}
	if nil == value.MSelect[0].ResolvedColor || "#0a0b0c" != value.MSelect[0].ResolvedColor.Dark.BackgroundColor {
		t.Fatalf("value did not use the historical target palette: %+v", value.MSelect[0].ResolvedColor)
	}
}

func TestApplyRelatedCustomColorRenderContextMissingPalette(t *testing.T) {
	target, key, value := relatedCustomColorTargetForContextTest(t)
	if nil == key.Options[0].ResolvedColor || nil == value.MSelect[0].ResolvedColor {
		t.Fatal("test target was not initialized with its current palette")
	}
	source := &av.AttributeView{CustomColorRenderContext: &av.CustomColorRenderContext{
		ResolveRelatedCustomColors: func(string) ([]*av.AttributeViewCustomColor, []string, bool) {
			return nil, nil, false
		},
	}}

	applyRelatedCustomColorRenderContext(source, target)

	if 0 != len(target.Palette()) {
		t.Fatalf("missing historical palette retained current colors: %+v", target.Palette())
	}
	if nil != key.Options[0].ResolvedColor || nil != value.MSelect[0].ResolvedColor {
		t.Fatal("missing historical palette retained a derived current color")
	}
}

func TestApplyRelatedCustomColorRenderContextOrdinaryRenderDoesNotLeak(t *testing.T) {
	target, key, value := relatedCustomColorTargetForContextTest(t)
	applyRelatedCustomColorRenderContext(&av.AttributeView{}, target)

	if 1 != len(target.Palette()) || "#111213" != target.Palette()[0].Light.Color {
		t.Fatalf("ordinary render palette changed: %+v", target.Palette())
	}
	if nil == key.Options[0].ResolvedColor || nil == value.MSelect[0].ResolvedColor {
		t.Fatal("ordinary render lost its current derived color")
	}
}

func relatedCustomColorTargetForContextTest(t *testing.T) (target *av.AttributeView, key *av.Key, value *av.Value) {
	t.Helper()
	currentColor := customColorForContextTest("#111213", "#141516", "#171819", "#1a1b1c")
	key = &av.Key{ID: "select", Type: av.KeyTypeSelect, Options: []*av.SelectOption{{Name: "Current", Color: "15"}}}
	value = &av.Value{Type: av.KeyTypeSelect, MSelect: []*av.ValueSelect{{Content: "Current value", Color: "15"}}}
	target = &av.AttributeView{
		ID:        "target",
		KeyValues: []*av.KeyValues{{Key: key, Values: []*av.Value{value}}},
	}
	old := av.LoadWorkspacePalette
	t.Cleanup(func() { av.LoadWorkspacePalette = old })
	av.LoadWorkspacePalette = func() ([]*av.AttributeViewCustomColor, []string) {
		return []*av.AttributeViewCustomColor{currentColor}, nil
	}
	target.ResolveDirectColors()
	return
}

func customColorForContextTest(lightColor, lightBackground, darkColor, darkBackground string) *av.AttributeViewCustomColor {
	return &av.AttributeViewCustomColor{
		Index: 15,
		AttributeViewColor: av.AttributeViewColor{
			Light: av.AttributeViewColorTheme{Color: lightColor, BackgroundColor: lightBackground},
			Dark:  av.AttributeViewColorTheme{Color: darkColor, BackgroundColor: darkBackground},
		},
	}
}
