// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import (
	"maps"
	"slices"
	"testing"
)

func TestNormalizeFlashcardMenu(t *testing.T) {
	const doc = "docTree.document.riffCard.addToDeck"
	const block = "gutter.single.addToDeck"
	const target = "mainMenu.riffCard"
	profile := &EntryVisibilityProfile{
		ID: "custom", Name: "Custom",
		Entries: map[string]bool{
			doc + ".presets": false, block + ".presets": true, doc + ".anki": true,
			target + ".anki": false, block + ".management": false, doc + ".advanced": false,
		},
		Orders: map[string][]string{
			doc: {"anki", "plugin:item", "advanced", "presets"}, block: {"management", "presets", "basic"},
		},
	}
	config := &EntryVisibility{Version: EntryVisibilityVersion, Active: profile.ID, Profiles: []*EntryVisibilityProfile{profile}}
	wantEntries := map[string]bool{
		target + ".presets": true, target + ".anki": false, target + ".manage": false, doc + ".advanced": false,
	}
	wantOrders := map[string][]string{
		doc: {"plugin:item", "advanced"}, block: {"basic"}, target: {"anki", "presets", "manage"},
	}
	for range 2 {
		NormalizeEntryVisibility(config, EntryVisibilityProfileFull)
		if !maps.Equal(profile.Entries, wantEntries) || !maps.EqualFunc(profile.Orders, wantOrders, slices.Equal[[]string]) {
			t.Fatalf("entries = %v, orders = %v", profile.Entries, profile.Orders)
		}
	}
}
