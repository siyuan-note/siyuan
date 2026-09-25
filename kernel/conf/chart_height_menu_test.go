package conf

import (
	"reflect"
	"testing"
)

func TestMigrateChartHeightMenu(t *testing.T) {
	for _, existing := range []string{"unset", "visible", "hidden"} {
		profile := &EntryVisibilityProfile{
			Entries: map[string]bool{"gutter.single.chart.height": false},
			Orders: map[string][]string{
				"gutter.single":       {"pluginBefore", "width", "height", "pluginAfter"},
				"gutter.single.chart": {"pluginBefore", "height", "update", "pluginAfter"},
			},
		}
		if existing != "unset" {
			profile.Entries["gutter.single.height"] = existing == "visible"
		}
		for i := 0; i < 2; i++ {
			migrateChartHeightMenu(profile)
			if !reflect.DeepEqual(profile.Entries, map[string]bool{"gutter.single.height": existing == "visible"}) ||
				!reflect.DeepEqual(profile.Orders["gutter.single.chart"], []string{"pluginBefore", "update", "pluginAfter"}) ||
				!reflect.DeepEqual(profile.Orders["gutter.single"], []string{"pluginBefore", "width", "height", "pluginAfter"}) {
				t.Fatalf("unexpected migration for %s: %+v", existing, profile)
			}
		}
	}
}
