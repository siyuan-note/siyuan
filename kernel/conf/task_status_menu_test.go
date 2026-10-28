// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func TestTaskStatusMenuMigration(t *testing.T) {
	data, err := os.ReadFile("testdata/task_status_menu.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Name            string
		Input, Expected EntryVisibilityProfile
	}
	if err = json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range fixtures {
		t.Run(fixture.Name, func(t *testing.T) {
			fixture.Input.ID, fixture.Input.Name = "custom", "Custom"
			config := &EntryVisibility{Version: 5, Active: "custom", Profiles: []*EntryVisibilityProfile{&fixture.Input}}
			for range 2 {
				NormalizeEntryVisibility(config, EntryVisibilityProfileFull)
				if config.Version != EntryVisibilityVersion || !reflect.DeepEqual(fixture.Input.Entries, fixture.Expected.Entries) ||
					!reflect.DeepEqual(fixture.Input.Orders, fixture.Expected.Orders) {
					t.Fatalf("unexpected migration: version=%d, expected=%d, profile=%+v", config.Version, EntryVisibilityVersion, fixture.Input)
				}
			}
		})
	}
}
