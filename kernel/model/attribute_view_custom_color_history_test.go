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
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestHistoryAttributeViewPaletteOnlyUsesInlineStyles(t *testing.T) {
	const avID = "20260824000002-target2"
	historyDir := t.TempDir()
	avPath := filepath.Join(historyDir, "storage", "av", avID+".json")
	if err := os.MkdirAll(filepath.Dir(avPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(avPath, []byte(`{"customColors":[{"index":16,"light":{"color":"#111111","backgroundColor":"#222222"},"dark":{"color":"#333333","backgroundColor":"#444444"}}]}`), 0644); err != nil {
		t.Fatal(err)
	}
	stylesPath := filepath.Join(historyDir, "storage", "inline-styles.json")
	styles := &InlineStyles{
		Version: InlineStylesVersion,
		AV: &InlineStyleAV{
			Colors: []*av.AttributeViewCustomColor{{
				Index: 15,
				AttributeViewColor: av.AttributeViewColor{
					Light: av.AttributeViewColorTheme{Color: "#010203", BackgroundColor: "#040506"},
					Dark:  av.AttributeViewColorTheme{Color: "#070809", BackgroundColor: "#0a0b0c"},
				},
			}},
			Order: []string{"15", "2", "1"},
		},
	}
	data, err := json.Marshal(styles)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(stylesPath, data, 0644); err != nil {
		t.Fatal(err)
	}

	colors, order, found := loadHistoryWorkspacePalette(historyDir)
	if !found || len(colors) != 1 || len(order) != av.BuiltinColorCount+1 ||
		colors[0].Index != 15 || order[0] != "15" || order[1] != "2" || order[2] != "1" {
		t.Fatalf("unexpected historical workspace palette: colors=%+v order=%v found=%v", colors, order, found)
	}
	attrView := &av.AttributeView{ID: avID, CustomColorRenderContext: newHistoryAttributeViewCustomColorRenderContext(historyDir)}
	resolvedColors := attrView.Palette()
	resolvedOrder := attrView.PaletteOrder()
	if len(resolvedColors) != 1 || resolvedColors[0].Index != 15 || len(resolvedOrder) == 0 || resolvedOrder[0] != "15" {
		t.Fatalf("historical render context did not use inline styles: colors=%+v order=%v", resolvedColors, resolvedOrder)
	}
}

func TestAttributeViewCustomColorRenderContextReturnsIndependentPalettes(t *testing.T) {
	context := newAttributeViewCustomColorRenderContext([]*av.AttributeViewCustomColor{{
		Index: 15,
		AttributeViewColor: av.AttributeViewColor{
			Light: av.AttributeViewColorTheme{Color: "#010203", BackgroundColor: "#040506"},
			Dark:  av.AttributeViewColorTheme{Color: "#070809", BackgroundColor: "#0a0b0c"},
		},
	}}, []string{"15", "1"}, true)
	resolver := context.ResolveRelatedCustomColors

	const goroutines = 32
	var waitGroup sync.WaitGroup
	errs := make(chan string, goroutines)
	for i := 0; i < goroutines; i++ {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			colors, order, found := resolver("20260824000000-target1")
			if !found || 1 != len(colors) || "#0a0b0c" != colors[0].Dark.BackgroundColor {
				errs <- "resolver returned an invalid palette"
			}
			if len(order) == 0 || order[0] != "15" {
				errs <- "resolver returned an invalid palette order"
			}
			colors[0].Light.Color = "#ffffff"
		}()
	}
	waitGroup.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	colors, _, _ := resolver("20260824000001-target2")
	if colors[0].Light.Color != "#010203" {
		t.Fatal("render context shared a mutable palette between consumers")
	}

	missingContext := newAttributeViewCustomColorRenderContext(nil, nil, false)
	if _, _, found := missingContext.ResolveRelatedCustomColors("20260824000000-target1"); found {
		t.Fatal("missing historical palette was reported as found")
	}
}
