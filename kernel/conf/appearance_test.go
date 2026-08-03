// SiYuan - Refactor your thinking
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

import "testing"

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
			{ID: "custom", Name: "Custom", Base: "invalid", Entries: map[string]bool{"future.entry": false},
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
	if profile.Base != EntryVisibilityProfileFull || profile.Entries["future.entry"] {
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
			{ID: "custom", Name: "Custom", Base: EntryVisibilityProfileSimple},
		},
	}, EntryVisibilityProfileFull)

	if entryVisibility.Active != "custom" {
		t.Fatalf("unexpected active profile: %s", entryVisibility.Active)
	}
	if nil == entryVisibility.Profiles[0].Orders {
		t.Fatal("profile orders should be initialized")
	}
}
