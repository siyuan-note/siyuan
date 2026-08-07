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

func TestNormalizeEntryVisibilityMigratesSuperBlockMenu(t *testing.T) {
	entryVisibility := NormalizeEntryVisibility(&EntryVisibility{
		Version: 2,
		Active:  "custom",
		Profiles: []*EntryVisibilityProfile{{
			ID:   "custom",
			Name: "Custom",
			Base: EntryVisibilityProfileFull,
			Entries: map[string]bool{
				"gutter.single.cancelSuperBlock":                            false,
				"gutter.single.superBlockAlignment.alignTop":                false,
				"gutter.single.superBlockAlignment.useDefaultVerticalAlign": true,
			},
			Orders: map[string][]string{
				"gutter.single":                     {"copy", "turnIntoHLayout", "cancelSuperBlock", "delete"},
				"gutter.single.superBlockAlignment": {"alignBottom", "alignTop"},
			},
		}},
	}, EntryVisibilityProfileFull)

	profile := entryVisibility.Profiles[0]
	if _, ok := profile.Entries["gutter.single.cancelSuperBlock"]; ok {
		t.Fatal("old super block entry path should be removed")
	}
	if visible, ok := profile.Entries["gutter.single.superBlock.cancelSuperBlock"]; !ok || visible {
		t.Fatalf("unexpected migrated entries: %+v", profile.Entries)
	}
	if visible, ok := profile.Entries["gutter.single.superBlock.superBlockAlignment.alignTop"]; !ok || visible {
		t.Fatalf("unexpected migrated entries: %+v", profile.Entries)
	}
	if !profile.Entries["gutter.single.superBlock.superBlockAlignment.useDefaultVerticalAlign"] {
		t.Fatalf("unexpected migrated entries: %+v", profile.Entries)
	}
	rootOrder := profile.Orders["gutter.single"]
	if len(rootOrder) != 3 || rootOrder[0] != "copy" || rootOrder[1] != "superBlock" || rootOrder[2] != "delete" {
		t.Fatalf("unexpected migrated root order: %+v", rootOrder)
	}
	superBlockOrder := profile.Orders["gutter.single.superBlock"]
	if len(superBlockOrder) != 2 || superBlockOrder[0] != "turnIntoHLayout" || superBlockOrder[1] != "cancelSuperBlock" {
		t.Fatalf("unexpected migrated super block order: %+v", superBlockOrder)
	}
	if _, ok := profile.Orders["gutter.single.superBlockAlignment"]; ok {
		t.Fatal("old super block alignment order should be removed")
	}
	alignmentOrder := profile.Orders["gutter.single.superBlock.superBlockAlignment"]
	if len(alignmentOrder) != 2 || alignmentOrder[0] != "alignBottom" || alignmentOrder[1] != "alignTop" {
		t.Fatalf("unexpected migrated alignment order: %+v", alignmentOrder)
	}
}
