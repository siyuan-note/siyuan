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
	"sync/atomic"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestLoadHistoryAttributeViewCustomColors(t *testing.T) {
	const avID = "20260824000000-target1"
	historyDir := t.TempDir()
	path := filepath.Join(historyDir, "storage", "av", avID+".json")
	if err := os.MkdirAll(filepath.Dir(path), 0755); nil != err {
		t.Fatal(err)
	}
	data, err := json.Marshal(struct {
		Spec         int                            `json:"spec"`
		ID           string                         `json:"id"`
		CustomColors []*av.AttributeViewCustomColor `json:"customColors"`
	}{
		Spec: av.CurrentSpec,
		ID:   avID,
		CustomColors: []*av.AttributeViewCustomColor{{
			Index: 15,
			AttributeViewColor: av.AttributeViewColor{
				Light: av.AttributeViewColorTheme{Color: "#010203", BackgroundColor: "#040506"},
				Dark:  av.AttributeViewColorTheme{Color: "#070809", BackgroundColor: "#0a0b0c"},
			},
		}},
	})
	if nil != err {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, data, 0644); nil != err {
		t.Fatal(err)
	}

	colors, found := loadHistoryAttributeViewCustomColors(historyDir, avID)
	if !found || 1 != len(colors) || "#010203" != colors[0].Light.Color {
		t.Fatalf("unexpected historical palette: %+v, found %v", colors, found)
	}
	if _, found = loadHistoryAttributeViewCustomColors(historyDir, "20260824000001-missing"); found {
		t.Fatal("missing historical palette was reported as found")
	}
	if _, found = loadHistoryAttributeViewCustomColors(historyDir, "../target1"); found {
		t.Fatal("invalid related attribute view ID was accepted")
	}
}

func TestCachedAttributeViewCustomColorResolverIsRequestLocalAndConcurrentSafe(t *testing.T) {
	var calls atomic.Int32
	resolver := newCachedAttributeViewCustomColorResolver(
		func(string) ([]*av.AttributeViewCustomColor, bool) {
			calls.Add(1)
			return []*av.AttributeViewCustomColor{{
				Index: 15,
				AttributeViewColor: av.AttributeViewColor{
					Light: av.AttributeViewColorTheme{Color: "#010203", BackgroundColor: "#040506"},
					Dark:  av.AttributeViewColorTheme{Color: "#070809", BackgroundColor: "#0a0b0c"},
				},
			}}, true
		},
	)

	const goroutines = 32
	var waitGroup sync.WaitGroup
	errs := make(chan string, goroutines)
	for i := 0; i < goroutines; i++ {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			colors, found := resolver("20260824000000-target1")
			if !found || 1 != len(colors) || "#0a0b0c" != colors[0].Dark.BackgroundColor {
				errs <- "resolver returned an invalid palette"
			}
		}()
	}
	waitGroup.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	if 1 != calls.Load() {
		t.Fatalf("palette loader called %d times, want 1", calls.Load())
	}

	secondCalls := atomic.Int32{}
	secondResolver := newCachedAttributeViewCustomColorResolver(
		func(string) ([]*av.AttributeViewCustomColor, bool) {
			secondCalls.Add(1)
			return nil, false
		},
	)
	if _, found := secondResolver("20260824000000-target1"); found || 1 != secondCalls.Load() {
		t.Fatal("separate request resolver reused another request cache")
	}
}
