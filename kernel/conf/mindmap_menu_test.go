package conf

import (
	"reflect"
	"testing"
)

func TestMindmapMenuMigration(t *testing.T) {
	profile := &EntryVisibilityProfile{ID: "custom", Name: "Custom",
		Entries: map[string]bool{"gutter.single.listBlock.listMindmap": false},
		Orders: map[string][]string{
			"gutter.single.listBlock": {"prependListItem", "listMindmap", "plugin:test", "appendListItem"},
			"gutter.single.turnInto":  {"check", "plugin:convert", "list"},
		}}
	config := &EntryVisibility{Version: 6, Active: "custom", Profiles: []*EntryVisibilityProfile{profile}}
	for i := 0; i < 2; i++ {
		NormalizeEntryVisibility(config, EntryVisibilityProfileFull)
		if !reflect.DeepEqual(profile.Entries, map[string]bool{"gutter.single.turnInto.listMindmap": false}) ||
			!reflect.DeepEqual(profile.Orders["gutter.single.listBlock"], []string{"prependListItem", "plugin:test", "appendListItem"}) ||
			!reflect.DeepEqual(profile.Orders["gutter.single.turnInto"], []string{"check", "plugin:convert", "list"}) {
			t.Fatalf("unexpected migration: %+v", profile)
		}
	}
}
