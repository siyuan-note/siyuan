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
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	ignore "github.com/sabhiram/go-gitignore"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestInlineStylesCRUD(t *testing.T) {
	setupInlineStylesTest(t)

	styles, err := GetInlineStyles()
	if err != nil {
		t.Fatal(err)
	}
	if styles.Version != InlineStylesVersion || styles.Styles == nil || len(styles.Styles) != 0 ||
		styles.Builtin == nil || styles.Builtin.Colors == nil || styles.Builtin.Styles == nil ||
		styles.Builtin.Hidden == nil || styles.Builtin.Hidden.Color == nil ||
		styles.Builtin.Hidden.BackgroundColor == nil || styles.Builtin.Hidden.Style1 == nil ||
		styles.Builtin.Hidden.AV == nil || styles.Order == nil || len(styles.Order.Color) != maxBuiltinColorIndex ||
		len(styles.Order.Style1) != 4 || styles.AV == nil || styles.AV.Colors == nil ||
		len(styles.AV.Order) != av.BuiltinColorCount {
		t.Fatalf("unexpected empty inline styles: %#v", styles)
	}
	if _, err = os.Stat(inlineStylesPath()); !os.IsNotExist(err) {
		t.Fatalf("get created inline styles file: %v", err)
	}

	saved, changed, err := SetInlineStyles([]*InlineStyle{
		{
			Name:  "  Combined  ",
			Light: &InlineStyleTheme{Color: " #AABBCC ", BackgroundColor: "#DDEEFF"},
			Dark:  &InlineStyleTheme{Color: "#112233", BackgroundColor: "#445566"},
		},
		{
			ID:    "20260821000000-abcdefg",
			Name:  "Background",
			Light: &InlineStyleTheme{BackgroundColor: "#ABCDEF"},
			Dark:  &InlineStyleTheme{BackgroundColor: "#123456"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !changed || len(saved.Styles) != 2 || !ast.IsNodeIDPattern(saved.Styles[0].ID) {
		t.Fatalf("unexpected saved inline styles: %#v", saved)
	}
	if saved.Styles[0].Name != "Combined" || saved.Styles[0].Light.Color != "#aabbcc" ||
		saved.Styles[0].Light.BackgroundColor != "#ddeeff" || saved.Styles[1].Light.BackgroundColor != "#abcdef" {
		t.Fatalf("inline styles were not normalized: %#v", saved)
	}

	loaded, err := GetInlineStyles()
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.Styles) != 2 || loaded.Styles[0].ID != saved.Styles[0].ID ||
		loaded.Styles[1].ID != saved.Styles[1].ID {
		t.Fatalf("inline style order or IDs changed: %#v", loaded)
	}
	if loaded.Order == nil || loaded.Order.Style1[len(loaded.Order.Style1)-1] != saved.Styles[0].ID ||
		loaded.Order.BackgroundColor[len(loaded.Order.BackgroundColor)-1] != saved.Styles[1].ID {
		t.Fatalf("custom styles were not appended to order: %#v", loaded.Order)
	}
	if _, changed, err = SetInlineStyles(loaded.Styles); err != nil || changed {
		t.Fatalf("unchanged inline styles were rewritten: changed=%t, err=%v", changed, err)
	}
}

func TestInlineStylesBuiltinCRUD(t *testing.T) {
	setupInlineStylesTest(t)

	saved, changed, err := SetInlineStylesData(&InlineStyles{
		Version: InlineStylesVersion,
		Styles:  []*InlineStyle{},
		Builtin: &InlineStyleBuiltin{
			Colors: []*InlineStyleBuiltinColor{
				{
					Index: 13,
					Light: &InlineStyleTheme{BackgroundColor: " #ABCDEF "},
					Dark:  &InlineStyleTheme{BackgroundColor: "#123456"},
				},
				{
					Index: 2,
					Light: &InlineStyleTheme{Color: "#AABBCC", BackgroundColor: "#DDEEFF"},
					Dark:  &InlineStyleTheme{Color: "#112233", BackgroundColor: "#445566"},
				},
			},
			Styles: []*InlineStyleBuiltinStyle{
				{
					ID:    "success",
					Light: &InlineStyleTheme{Color: "#ABCDEF"},
					Dark:  &InlineStyleTheme{Color: "#123456"},
				},
				{
					ID:    " warning ",
					Light: &InlineStyleTheme{Color: "#AABBCC", BackgroundColor: "#DDEEFF"},
					Dark:  &InlineStyleTheme{Color: "#112233", BackgroundColor: "#445566"},
				},
			},
			Hidden: &InlineStyleBuiltinHidden{
				Color:           []int{13, 2, 2},
				BackgroundColor: []int{9, 1},
				Style1:          []string{"success", " warning ", "success"},
				AV:              []int{12, 3, 3},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !changed || len(saved.Builtin.Colors) != 2 || saved.Builtin.Colors[0].Index != 2 ||
		saved.Builtin.Colors[1].Index != 13 || saved.Builtin.Colors[0].Light.Color != "#aabbcc" ||
		len(saved.Builtin.Styles) != 2 || saved.Builtin.Styles[0].ID != "warning" ||
		saved.Builtin.Styles[1].ID != "success" {
		t.Fatalf("builtin colors were not normalized: %#v", saved.Builtin)
	}
	if !reflect.DeepEqual(saved.Builtin.Hidden.Color, []int{2, 13}) ||
		!reflect.DeepEqual(saved.Builtin.Hidden.BackgroundColor, []int{1, 9}) ||
		!reflect.DeepEqual(saved.Builtin.Hidden.Style1, []string{"warning", "success"}) ||
		!reflect.DeepEqual(saved.Builtin.Hidden.AV, []int{3, 12}) {
		t.Fatalf("hidden builtin colors were not normalized: %#v", saved.Builtin.Hidden)
	}
	if visible := getVisibleAVBuiltinColorIndexes(); !reflect.DeepEqual(visible,
		[]int{1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 13, neutralAVColorIndex}) {
		t.Fatalf("unexpected visible AV builtin colors: %#v", visible)
	}

	legacySaved, changed, err := SetInlineStyles([]*InlineStyle{{
		Name:  "Custom",
		Light: &InlineStyleTheme{Color: "#abcdef"},
		Dark:  &InlineStyleTheme{Color: "#123456"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if !changed || len(legacySaved.Styles) != 1 || !reflect.DeepEqual(legacySaved.Builtin, saved.Builtin) {
		t.Fatalf("legacy update did not preserve builtin colors: %#v", legacySaved)
	}

	reset, changed, err := SetInlineStylesData(&InlineStyles{Version: InlineStylesVersion, Styles: legacySaved.Styles})
	if err != nil {
		t.Fatal(err)
	}
	if !changed || len(reset.Builtin.Colors) != 0 || len(reset.Builtin.Styles) != 0 ||
		len(reset.Builtin.Hidden.Color) != 0 || len(reset.Builtin.Hidden.BackgroundColor) != 0 ||
		len(reset.Builtin.Hidden.Style1) != 0 || len(reset.Builtin.Hidden.AV) != 0 {
		t.Fatalf("missing builtin configuration was not normalized to empty: %#v", reset.Builtin)
	}
}

func TestInlineStylesOrder(t *testing.T) {
	setupInlineStylesTest(t)
	customID := "20260821000000-abcdefg"
	saved, _, err := SetInlineStylesData(&InlineStyles{
		Version: InlineStylesVersion,
		Styles: []*InlineStyle{{
			ID:    customID,
			Name:  "Accent",
			Light: &InlineStyleTheme{Color: "#abcdef"},
			Dark:  &InlineStyleTheme{Color: "#123456"},
		}},
		Builtin: newEmptyInlineStyleBuiltin(),
		Order: &InlineStyleOrder{
			Color:           []string{"2", customID, "1", "2", "unknown"},
			BackgroundColor: []string{"13"},
			Style1:          []string{"success"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(saved.Order.Color) < 3 || saved.Order.Color[0] != "2" || saved.Order.Color[1] != customID ||
		saved.Order.Color[2] != "1" || saved.Order.Color[len(saved.Order.Color)-1] != "13" {
		t.Fatalf("unexpected color order: %#v", saved.Order.Color)
	}
	if saved.Order.BackgroundColor[0] != "13" || saved.Order.BackgroundColor[1] != "1" {
		t.Fatalf("unexpected background color order: %#v", saved.Order.BackgroundColor)
	}
	if !reflect.DeepEqual(saved.Order.Style1, []string{"success", "error", "warning", "info"}) {
		t.Fatalf("unexpected style order: %#v", saved.Order.Style1)
	}
}

func TestInlineStylesAVPalette(t *testing.T) {
	setupInlineStylesTest(t)
	color := &av.AttributeViewCustomColor{
		Index:  15,
		Hidden: true,
		AttributeViewColor: av.AttributeViewColor{
			Light: av.AttributeViewColorTheme{Color: "#010203", BackgroundColor: "#040506"},
			Dark:  av.AttributeViewColorTheme{Color: "#070809", BackgroundColor: "#0a0b0c"},
		},
	}
	saved, _, err := SetInlineStylesData(&InlineStyles{
		Version: InlineStylesVersion,
		Styles:  []*InlineStyle{},
		AV: &InlineStyleAV{
			Colors: []*av.AttributeViewCustomColor{color},
			Order:  []string{"15", "1", "14"},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if 1 != len(saved.AV.Colors) || 15 != saved.AV.Colors[0].Index || !saved.AV.Colors[0].Hidden ||
		"#010203" != saved.AV.Colors[0].Light.Color || 15 != len(saved.AV.Order) ||
		"15" != saved.AV.Order[0] || "1" != saved.AV.Order[1] || "14" != saved.AV.Order[2] {
		t.Fatalf("unexpected attribute view palette: %#v", saved.AV)
	}

	loaded, err := GetInlineStyles()
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(saved.AV, loaded.AV) {
		t.Fatalf("attribute view palette was not persisted: %#v", loaded.AV)
	}
}

func TestWorkspaceAVPaletteRejectsColorsUsedByOtherAttributeViews(t *testing.T) {
	setupInlineStylesTest(t)
	color := &av.AttributeViewCustomColor{
		Index: 15,
		AttributeViewColor: av.AttributeViewColor{
			Light: av.AttributeViewColorTheme{Color: "#010203", BackgroundColor: "#040506"},
			Dark:  av.AttributeViewColorTheme{Color: "#070809", BackgroundColor: "#0a0b0c"},
		},
	}
	if _, _, err := SetInlineStylesData(&InlineStyles{
		Version: InlineStylesVersion,
		AV:      &InlineStyleAV{Colors: []*av.AttributeViewCustomColor{color}},
	}); err != nil {
		t.Fatal(err)
	}
	const otherAvID = "20260827000000-colors1"
	attrView := &av.AttributeView{Spec: av.CurrentSpec, ID: otherAvID}
	attrView.KeyValues = []*av.KeyValues{{Key: &av.Key{
		ID: "select", Type: av.KeyTypeSelect, Options: []*av.SelectOption{{Name: "Used", Color: "15"}},
	}}}
	data, err := json.Marshal(attrView)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(util.DataDir, "storage", "av", otherAvID+".json")
	if err = os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, data, 0644); err != nil {
		t.Fatal(err)
	}

	if _, _, err = SetWorkspaceAVPalette(&WorkspaceAVPaletteUpdate{}); err == nil ||
		!strings.Contains(err.Error(), otherAvID) {
		t.Fatalf("used workspace color was deleted: %v", err)
	}
	loaded, err := GetInlineStyles()
	if err != nil {
		t.Fatal(err)
	}
	if len(loaded.AV.Colors) != 1 || loaded.AV.Colors[0].Index != 15 {
		t.Fatalf("rejected palette update changed persisted colors: %#v", loaded.AV.Colors)
	}
}

func TestSetWorkspaceAVPalettePreservesUnrelatedInlineStyles(t *testing.T) {
	setupInlineStylesTest(t)
	styleID := "20260827000001-colors2"
	if _, _, err := SetInlineStylesData(&InlineStyles{
		Version: InlineStylesVersion,
		Styles: []*InlineStyle{{
			ID: styleID, Name: "Accent",
			Light: &InlineStyleTheme{Color: "#010203"},
			Dark:  &InlineStyleTheme{Color: "#040506"},
		}},
		Builtin: &InlineStyleBuiltin{Colors: []*InlineStyleBuiltinColor{{
			Index: 1,
			Light: &InlineStyleTheme{Color: "#111111"},
			Dark:  &InlineStyleTheme{Color: "#eeeeee"},
		}}},
	}); err != nil {
		t.Fatal(err)
	}
	color := &av.AttributeViewCustomColor{
		Index: 15,
		AttributeViewColor: av.AttributeViewColor{
			Light: av.AttributeViewColorTheme{Color: "#112233", BackgroundColor: "#445566"},
			Dark:  av.AttributeViewColorTheme{Color: "#778899", BackgroundColor: "#aabbcc"},
		},
	}
	saved, changed, err := SetWorkspaceAVPalette(&WorkspaceAVPaletteUpdate{
		Colors: []*av.AttributeViewCustomColor{color},
		Order:  []string{"15", "1"},
		BuiltinColors: []*WorkspaceAVBuiltinColorUpdate{{
			Index: 2, Customized: true,
			Light:  &InlineStyleTheme{BackgroundColor: "#abcdef"},
			Dark:   &InlineStyleTheme{BackgroundColor: "#123456"},
			Hidden: true,
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !changed || len(saved.Styles) != 1 || saved.Styles[0].ID != styleID {
		t.Fatalf("unrelated inline styles were changed: %#v", saved.Styles)
	}
	if len(saved.Builtin.Colors) != 2 || saved.Builtin.Colors[0].Index != 1 || saved.Builtin.Colors[1].Index != 2 ||
		!reflect.DeepEqual(saved.Builtin.Hidden.AV, []int{2}) {
		t.Fatalf("builtin color patch replaced unrelated configuration: %#v", saved.Builtin)
	}
	if len(saved.AV.Colors) != 1 || saved.AV.Order[0] != "15" {
		t.Fatalf("workspace palette was not saved: %#v", saved.AV)
	}
}

func TestInlineStylesVersion1Migration(t *testing.T) {
	setupInlineStylesTest(t)
	legacyData := []byte(`{"version":1,"styles":[{"id":"20260821000000-abcdefg","name":"Legacy","light":{"color":"#abcdef"},"dark":{"color":"#123456"}}]}`)
	if err := os.MkdirAll(filepath.Dir(inlineStylesPath()), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(inlineStylesPath(), legacyData, 0644); err != nil {
		t.Fatal(err)
	}

	migrated, err := GetInlineStyles()
	if err != nil {
		t.Fatal(err)
	}
	if migrated.Version != InlineStylesVersion || len(migrated.Styles) != 1 || migrated.Builtin == nil ||
		len(migrated.Builtin.Colors) != 0 || migrated.Builtin.Hidden == nil {
		t.Fatalf("legacy inline styles were not migrated: %#v", migrated)
	}
	currentData, err := os.ReadFile(inlineStylesPath())
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(currentData, legacyData) {
		t.Fatal("loading legacy inline styles rewrote the file")
	}

	if _, changed, err := SetInlineStyles(migrated.Styles); err != nil || !changed {
		t.Fatalf("saving migrated inline styles failed: changed=%t, err=%v", changed, err)
	}
	var persisted InlineStyles
	currentData, err = os.ReadFile(inlineStylesPath())
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(currentData, &persisted); err != nil {
		t.Fatal(err)
	}
	if persisted.Version != InlineStylesVersion || persisted.Builtin == nil {
		t.Fatalf("migrated inline styles were not persisted as version 2: %#v", persisted)
	}
}

func TestVisibleAVBuiltinColorIndexesAlwaysKeepsNeutralColor(t *testing.T) {
	setupInlineStylesTest(t)
	hidden := make([]int, 0, maxBuiltinColorIndex)
	for index := minBuiltinColorIndex; index <= maxBuiltinColorIndex; index++ {
		hidden = append(hidden, index)
	}
	if _, _, err := SetInlineStylesData(&InlineStyles{
		Version: InlineStylesVersion,
		Styles:  []*InlineStyle{},
		Builtin: &InlineStyleBuiltin{Hidden: &InlineStyleBuiltinHidden{AV: hidden}},
	}); err != nil {
		t.Fatal(err)
	}
	if visible := getVisibleAVBuiltinColorIndexes(); !reflect.DeepEqual(visible, []int{neutralAVColorIndex}) {
		t.Fatalf("unexpected visible AV builtin colors: %#v", visible)
	}
}

func TestInlineStylesValidation(t *testing.T) {
	validID := "20260821000000-abcdefg"
	valid := func() *InlineStyle {
		return &InlineStyle{
			ID:    validID,
			Name:  "Valid",
			Light: &InlineStyleTheme{Color: "#abcdef"},
			Dark:  &InlineStyleTheme{Color: "#123456"},
		}
	}
	tests := []struct {
		name   string
		styles func() []*InlineStyle
	}{
		{name: "null style", styles: func() []*InlineStyle { return []*InlineStyle{nil} }},
		{name: "invalid ID", styles: func() []*InlineStyle {
			style := valid()
			style.ID = "invalid"
			return []*InlineStyle{style}
		}},
		{name: "duplicate ID", styles: func() []*InlineStyle { return []*InlineStyle{valid(), valid()} }},
		{name: "empty name", styles: func() []*InlineStyle {
			style := valid()
			style.Name = "  "
			return []*InlineStyle{style}
		}},
		{name: "long name", styles: func() []*InlineStyle {
			style := valid()
			style.Name = strings.Repeat("界", maxInlineStyleNameRunes+1)
			return []*InlineStyle{style}
		}},
		{name: "missing theme", styles: func() []*InlineStyle {
			style := valid()
			style.Dark = nil
			return []*InlineStyle{style}
		}},
		{name: "empty fields", styles: func() []*InlineStyle {
			style := valid()
			style.Light = &InlineStyleTheme{}
			style.Dark = &InlineStyleTheme{}
			return []*InlineStyle{style}
		}},
		{name: "different fields", styles: func() []*InlineStyle {
			style := valid()
			style.Dark = &InlineStyleTheme{BackgroundColor: "#123456"}
			return []*InlineStyle{style}
		}},
		{name: "invalid color", styles: func() []*InlineStyle {
			style := valid()
			style.Light.Color = "#abc"
			return []*InlineStyle{style}
		}},
		{name: "too many styles", styles: func() []*InlineStyle {
			styles := make([]*InlineStyle, maxInlineStyles+1)
			for i := range styles {
				styles[i] = &InlineStyle{
					Name:  "Style",
					Light: &InlineStyleTheme{Color: "#abcdef"},
					Dark:  &InlineStyleTheme{Color: "#123456"},
				}
			}
			return styles
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			setupInlineStylesTest(t)
			if _, _, err := SetInlineStyles(test.styles()); err == nil {
				t.Fatal("expected validation error")
			}
			if _, err := os.Stat(inlineStylesPath()); !os.IsNotExist(err) {
				t.Fatalf("invalid inline styles were written: %v", err)
			}
		})
	}
}

func TestInlineStylesBuiltinValidation(t *testing.T) {
	valid := func() *InlineStyles {
		return &InlineStyles{
			Version: InlineStylesVersion,
			Styles:  []*InlineStyle{},
			Builtin: &InlineStyleBuiltin{
				Colors: []*InlineStyleBuiltinColor{{
					Index: 1,
					Light: &InlineStyleTheme{Color: "#abcdef"},
					Dark:  &InlineStyleTheme{Color: "#123456"},
				}},
				Styles: []*InlineStyleBuiltinStyle{{
					ID:    "error",
					Light: &InlineStyleTheme{Color: "#abcdef", BackgroundColor: "#fedcba"},
					Dark:  &InlineStyleTheme{Color: "#123456", BackgroundColor: "#654321"},
				}},
				Hidden: &InlineStyleBuiltinHidden{},
			},
		}
	}
	tests := []struct {
		name   string
		styles func() *InlineStyles
	}{
		{name: "null data", styles: func() *InlineStyles { return nil }},
		{name: "legacy version", styles: func() *InlineStyles {
			styles := valid()
			styles.Version = 1
			return styles
		}},
		{name: "null color", styles: func() *InlineStyles {
			styles := valid()
			styles.Builtin.Colors[0] = nil
			return styles
		}},
		{name: "low color index", styles: func() *InlineStyles {
			styles := valid()
			styles.Builtin.Colors[0].Index = 0
			return styles
		}},
		{name: "high color index", styles: func() *InlineStyles {
			styles := valid()
			styles.Builtin.Colors[0].Index = 15
			return styles
		}},
		{name: "duplicate color index", styles: func() *InlineStyles {
			styles := valid()
			styles.Builtin.Colors = append(styles.Builtin.Colors, &InlineStyleBuiltinColor{
				Index: 1,
				Light: &InlineStyleTheme{BackgroundColor: "#abcdef"},
				Dark:  &InlineStyleTheme{BackgroundColor: "#123456"},
			})
			return styles
		}},
		{name: "missing color theme", styles: func() *InlineStyles {
			styles := valid()
			styles.Builtin.Colors[0].Dark = nil
			return styles
		}},
		{name: "empty color fields", styles: func() *InlineStyles {
			styles := valid()
			styles.Builtin.Colors[0].Light = &InlineStyleTheme{}
			styles.Builtin.Colors[0].Dark = &InlineStyleTheme{}
			return styles
		}},
		{name: "different color fields", styles: func() *InlineStyles {
			styles := valid()
			styles.Builtin.Colors[0].Dark = &InlineStyleTheme{BackgroundColor: "#123456"}
			return styles
		}},
		{name: "invalid color value", styles: func() *InlineStyles {
			styles := valid()
			styles.Builtin.Colors[0].Light.Color = "red"
			return styles
		}},
		{name: "null style", styles: func() *InlineStyles {
			styles := valid()
			styles.Builtin.Styles[0] = nil
			return styles
		}},
		{name: "invalid style ID", styles: func() *InlineStyles {
			styles := valid()
			styles.Builtin.Styles[0].ID = "danger"
			return styles
		}},
		{name: "duplicate style ID", styles: func() *InlineStyles {
			styles := valid()
			styles.Builtin.Styles = append(styles.Builtin.Styles, &InlineStyleBuiltinStyle{
				ID:    "error",
				Light: &InlineStyleTheme{Color: "#abcdef"},
				Dark:  &InlineStyleTheme{Color: "#123456"},
			})
			return styles
		}},
		{name: "invalid hidden color", styles: func() *InlineStyles {
			styles := valid()
			styles.Builtin.Hidden.Color = []int{0}
			return styles
		}},
		{name: "invalid hidden background", styles: func() *InlineStyles {
			styles := valid()
			styles.Builtin.Hidden.BackgroundColor = []int{14}
			return styles
		}},
		{name: "invalid hidden style", styles: func() *InlineStyles {
			styles := valid()
			styles.Builtin.Hidden.Style1 = []string{"danger"}
			return styles
		}},
		{name: "invalid hidden av", styles: func() *InlineStyles {
			styles := valid()
			styles.Builtin.Hidden.AV = []int{15}
			return styles
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			setupInlineStylesTest(t)
			if _, _, err := SetInlineStylesData(test.styles()); err == nil {
				t.Fatal("expected builtin validation error")
			}
			if _, err := os.Stat(inlineStylesPath()); !os.IsNotExist(err) {
				t.Fatalf("invalid builtin inline styles were written: %v", err)
			}
		})
	}
}

func TestInlineStylesInvalidFileIsNotOverwritten(t *testing.T) {
	tests := []struct {
		name string
		data []byte
	}{
		{name: "invalid JSON", data: []byte(`{"version":`)},
		{name: "future version", data: []byte(`{"version":3,"styles":[]}`)},
		{name: "invalid builtin", data: []byte(`{"version":2,"styles":[],"builtin":{"colors":[{"index":15,"light":{"color":"#abcdef"},"dark":{"color":"#123456"}}]}}`)},
		{name: "oversized", data: bytes.Repeat([]byte("x"), maxInlineStylesFileSize+1)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			setupInlineStylesTest(t)
			if err := os.MkdirAll(filepath.Dir(inlineStylesPath()), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(inlineStylesPath(), test.data, 0644); err != nil {
				t.Fatal(err)
			}

			if _, err := GetInlineStyles(); err == nil {
				t.Fatal("expected invalid inline styles error")
			}
			if _, _, err := SetInlineStyles([]*InlineStyle{{
				Name:  "Replacement",
				Light: &InlineStyleTheme{Color: "#abcdef"},
				Dark:  &InlineStyleTheme{Color: "#123456"},
			}}); err == nil {
				t.Fatal("expected replacement to be rejected")
			}
			current, err := os.ReadFile(inlineStylesPath())
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(current, test.data) {
				t.Fatal("invalid inline styles file was overwritten")
			}
		})
	}
}

func TestInlineStylesRepoPath(t *testing.T) {
	setupInlineStylesTest(t)
	if !isInlineStylesRepoPath("/storage/inline-styles.json") {
		t.Fatal("inline styles repository path was not recognized")
	}
	for _, filePath := range []string{
		"storage/inline-styles.json",
		"/storage/inline-styles.json.bak",
		"/storage/nested/inline-styles.json",
	} {
		if isInlineStylesRepoPath(filePath) {
			t.Fatalf("unexpected inline styles repository path match: %s", filePath)
		}
	}
	if ignore.CompileIgnoreLines(getSyncIgnoreLines()...).MatchesPath(inlineStylesRepoPath) {
		t.Fatal("inline styles file is ignored by data synchronization")
	}
}

func setupInlineStylesTest(t *testing.T) {
	t.Helper()
	oldDataDir, oldConf := util.DataDir, Conf
	util.DataDir, Conf = t.TempDir(), NewAppConf()
	Conf.Sync = conf.NewSync()
	t.Cleanup(func() {
		util.DataDir, Conf = oldDataDir, oldConf
	})
}
