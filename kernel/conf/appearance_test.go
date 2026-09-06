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

package conf

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestGlobalFontFamiliesCompatibility(t *testing.T) {
	for _, source := range []string{`{}`, `{"globalFontFamilies":null}`, `{"globalFontFamilies":[]}`} {
		appearance := NewAppearance()
		if err := json.Unmarshal([]byte(source), appearance); err != nil {
			t.Fatal(err)
		}
		appearance.NormalizeGlobalFontFamilies()
		if nil == appearance.GlobalFontFamilies || 0 != len(appearance.GlobalFontFamilies) {
			t.Fatalf("expected theme defaults for %s, got %+v", source, appearance.GlobalFontFamilies)
		}
	}
}

func TestGlobalFontFamiliesPreservesPriority(t *testing.T) {
	appearance := NewAppearance()
	appearance.GlobalFontFamilies = []*EditorFont{
		nil,
		{Family: ""},
		{Family: "Example Sans", Weight: 0, DisplayName: "Example"},
		{Family: "Fallback Sans", Weight: 400},
		{Family: "Example Sans", Weight: 700},
	}
	appearance.NormalizeGlobalFontFamilies()
	if len(appearance.GlobalFontFamilies) != 2 || appearance.GlobalFontFamilies[0].Family != "Example Sans" ||
		appearance.GlobalFontFamilies[1].Family != "Fallback Sans" || appearance.GlobalFontFamilies[0].Weight != 400 {
		t.Fatalf("unexpected normalized fonts: %+v", appearance.GlobalFontFamilies)
	}
	data, err := json.Marshal(appearance)
	if err != nil {
		t.Fatal(err)
	}
	loaded := &Appearance{}
	if err = json.Unmarshal(data, loaded); err != nil {
		t.Fatal(err)
	}
	if len(loaded.GlobalFontFamilies) != 2 || loaded.GlobalFontFamilies[0].DisplayName != "Example" {
		t.Fatalf("font preferences did not survive round trip: %+v", loaded.GlobalFontFamilies)
	}
}

func TestNormalizeEntryVisibilityDefaults(t *testing.T) {
	entryVisibility := NormalizeEntryVisibility(nil, EntryVisibilityProfileSimple)
	if entryVisibility.Version != EntryVisibilityVersion || entryVisibility.Active != EntryVisibilityProfileSimple {
		t.Fatalf("unexpected defaults: %+v", entryVisibility)
	}
	if nil == entryVisibility.Profiles || 0 != len(entryVisibility.Profiles) {
		t.Fatalf("unexpected profiles: %+v", entryVisibility.Profiles)
	}
}

func TestNormalizeEntryVisibilityProfiles(t *testing.T) {
	entryVisibility := NormalizeEntryVisibility(&EntryVisibility{
		Version: 99,
		Active:  "missing",
		Profiles: []*EntryVisibilityProfile{
			nil,
			{ID: "", Name: "missing-id"},
			{ID: EntryVisibilityProfileSimple, Name: "Reserved"},
			{ID: "custom", Name: "Custom", Entries: map[string]bool{"future.entry": false},
				Orders: map[string][]string{"future": {"entry"}}},
			{ID: "custom", Name: "Duplicate"},
		},
	}, EntryVisibilityProfileFull)

	if entryVisibility.Version != EntryVisibilityVersion || entryVisibility.Active != EntryVisibilityProfileFull {
		t.Fatalf("unexpected normalized config: %+v", entryVisibility)
	}
	if 1 != len(entryVisibility.Profiles) {
		t.Fatalf("unexpected profiles: %+v", entryVisibility.Profiles)
	}
	profile := entryVisibility.Profiles[0]
	if profile.Entries["future.entry"] {
		t.Fatalf("unexpected normalized profile: %+v", profile)
	}
	if len(profile.Orders["future"]) != 1 || profile.Orders["future"][0] != "entry" {
		t.Fatalf("unexpected normalized profile orders: %+v", profile.Orders)
	}
}

func TestNormalizeEntryVisibilityActiveCustomProfile(t *testing.T) {
	entryVisibility := NormalizeEntryVisibility(&EntryVisibility{
		Active: "custom",
		Profiles: []*EntryVisibilityProfile{
			{ID: "custom", Name: "Custom"},
		},
	}, EntryVisibilityProfileFull)

	if entryVisibility.Active != "custom" {
		t.Fatalf("unexpected active profile: %s", entryVisibility.Active)
	}
	if nil == entryVisibility.Profiles[0].Orders {
		t.Fatal("profile orders should be initialized")
	}
}

func TestNormalizeEntryVisibilityRemovesLegacyBase(t *testing.T) {
	legacy := []byte(`{"version":2,"active":"custom","profiles":[{"id":"custom","name":"Custom","base":"simple","entries":{"future.entry":false},"orders":{}}]}`)
	entryVisibility := &EntryVisibility{}
	if err := json.Unmarshal(legacy, entryVisibility); nil != err {
		t.Fatalf("unmarshal legacy config failed: %v", err)
	}

	entryVisibility = NormalizeEntryVisibility(entryVisibility, EntryVisibilityProfileFull)
	data, err := json.Marshal(entryVisibility)
	if nil != err {
		t.Fatalf("marshal normalized config failed: %v", err)
	}
	if bytes.Contains(data, []byte(`"base"`)) {
		t.Fatalf("legacy base should not be persisted: %s", data)
	}
	if entryVisibility.Version != EntryVisibilityVersion || entryVisibility.Active != "custom" ||
		entryVisibility.Profiles[0].Entries["future.entry"] {
		t.Fatalf("unexpected normalized legacy config: %+v", entryVisibility)
	}
}

func TestNormalizeEntryVisibilityMigratesEditMode(t *testing.T) {
	entryVisibility := NormalizeEntryVisibility(&EntryVisibility{
		Version: 3,
		Active:  "custom",
		Profiles: []*EntryVisibilityProfile{
			{
				ID:   "custom",
				Name: "Custom",
				Entries: map[string]bool{
					"document.more.editMode":         true,
					"document.more.editMode.wysiwyg": false,
					"document.more.editMode.preview": false,
				},
				Orders: map[string][]string{
					"document.more.editMode": {"preview", "wysiwyg"},
				},
			},
		},
	}, EntryVisibilityProfileFull)

	profile := entryVisibility.Profiles[0]
	if profile.Entries["document.more.editMode"] {
		t.Fatalf("hidden legacy mode entries should hide the merged entry: %+v", profile.Entries)
	}
	if _, ok := profile.Entries["document.more.editMode.wysiwyg"]; ok {
		t.Fatalf("legacy WYSIWYG entry should be removed: %+v", profile.Entries)
	}
	if _, ok := profile.Entries["document.more.editMode.preview"]; ok {
		t.Fatalf("legacy preview entry should be removed: %+v", profile.Entries)
	}
	if _, ok := profile.Orders["document.more.editMode"]; ok {
		t.Fatalf("legacy mode order should be removed: %+v", profile.Orders)
	}
}
