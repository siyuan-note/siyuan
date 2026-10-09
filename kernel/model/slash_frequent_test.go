package model

import (
	"errors"
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestMigrateSlashFrequent(t *testing.T) {
	const key = "editor.slash.menu.frequent"
	for _, test := range []struct {
		name    string
		storage map[string]any
		want    bool
	}{
		{"disabled", map[string]any{"local-slash-frequent-enabled": false}, false},
		{"enabled", map[string]any{"local-slash-frequent-enabled": true}, true},
		{"missing", map[string]any{}, true},
		{"null", map[string]any{"local-slash-frequent-enabled": nil}, true},
		{"string", map[string]any{"local-slash-frequent-enabled": "false"}, true},
		{"number", map[string]any{"local-slash-frequent-enabled": 0}, true},
		{"object", map[string]any{"local-slash-frequent-enabled": map[string]any{"value": false}}, true},
		{"array", map[string]any{"local-slash-frequent-enabled": []any{false}}, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			originalStorage := make(map[string]any, len(test.storage))
			for key, value := range test.storage {
				originalStorage[key] = value
			}
			config := conf.NormalizeEntryVisibility(&conf.EntryVisibility{
				Version: conf.EntryVisibilityVersion,
				Active:  "custom",
				Profiles: []*conf.EntryVisibilityProfile{
					nil,
					{ID: conf.EntryVisibilityProfileSimple, Name: "Simple"},
					{ID: conf.EntryVisibilityProfileFull, Name: "Full"},
					{ID: "invalid"},
					{ID: "custom", Name: "Custom"},
					{ID: "inactive", Name: "Inactive", Entries: map[string]bool{"other": false}, Orders: map[string][]string{"editor.slash.menu": {"plugin", "heading"}}},
					{ID: "disabled", Name: "Disabled", Entries: map[string]bool{key: false}},
					{ID: "enabled", Name: "Enabled", Entries: map[string]bool{key: true}},
				},
			}, conf.EntryVisibilityProfileFull)
			calls := 0
			load := func() (map[string]any, error) {
				calls++
				return test.storage, nil
			}
			migrateSlashFrequent(config, load)
			migrateSlashFrequent(config, load)
			if calls != 1 {
				t.Fatalf("expected one migration read, got %d", calls)
			}
			for i, want := range []bool{test.want, test.want, false, true} {
				if got, exists := config.Profiles[i].Entries[key]; !exists || got != want {
					t.Errorf("profile %q: got %v (present %v), want %v", config.Profiles[i].ID, got, exists, want)
				}
			}
			if config.Active != "custom" || config.Version != conf.EntryVisibilityVersion {
				t.Fatalf("migration changed active profile or version: %+v", config)
			}
			if config.Profiles[1].Entries["other"] || !reflect.DeepEqual(config.Profiles[1].Orders["editor.slash.menu"], []string{"plugin", "heading"}) {
				t.Fatal("migration changed unrelated visibility or ordering")
			}
			if !reflect.DeepEqual(test.storage, originalStorage) {
				t.Fatal("migration modified local storage")
			}
		})
	}
}

func TestMigrateSlashFrequentRetriesReadFailure(t *testing.T) {
	const key = "editor.slash.menu.frequent"
	config := &conf.EntryVisibility{Profiles: []*conf.EntryVisibilityProfile{{ID: "custom", Name: "Custom"}}}
	migrateSlashFrequent(config, func() (map[string]any, error) {
		return map[string]any{"local-slash-frequent-enabled": true}, errors.New("read failed")
	})
	if _, exists := config.Profiles[0].Entries[key]; exists {
		t.Fatal("failed read persisted a default")
	}
	migrateSlashFrequent(config, func() (map[string]any, error) {
		return map[string]any{"local-slash-frequent-enabled": false}, nil
	})
	if enabled, exists := config.Profiles[0].Entries[key]; !exists || enabled {
		t.Fatal("retry did not preserve disabled preference")
	}
}

func TestMigrateSlashFrequentSkipsBuiltins(t *testing.T) {
	for _, config := range []*conf.EntryVisibility{
		nil,
		conf.NewEntryVisibility(conf.EntryVisibilityProfileSimple),
		conf.NewEntryVisibility(conf.EntryVisibilityProfileFull),
		{Profiles: []*conf.EntryVisibilityProfile{
			nil,
			{ID: conf.EntryVisibilityProfileSimple, Name: "Simple"},
			{ID: conf.EntryVisibilityProfileFull, Name: "Full"},
		}},
	} {
		migrateSlashFrequent(config, func() (map[string]any, error) {
			t.Fatal("built-in profiles should not read legacy storage")
			return nil, nil
		})
	}
}
