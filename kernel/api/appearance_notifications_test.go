package api

import (
	"encoding/json"
	"os"
	"regexp"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractAppearanceNotifications(t *testing.T) {
	defaults := util.NewNotifications()
	if defaults.SelectAllIncompleteTip == nil || !*defaults.SelectAllIncompleteTip {
		t.Fatal("incomplete selection tip should default to enabled")
	}
	for _, value := range []string{"true", "false", "null"} {
		var config struct {
			Notifications *util.Notifications `json:"notifications"`
		}
		if err := json.Unmarshal([]byte(`{"notifications":{"selectAllIncompleteTip":`+value+`}}`), &config); err != nil {
			t.Fatal(err)
		}
		data, err := json.Marshal(config)
		if err != nil {
			t.Fatal(err)
		}
		if err = json.Unmarshal(data, &config); err != nil {
			t.Fatal(err)
		}
		got := config.Notifications.SelectAllIncompleteTip
		if value == "null" {
			if got != nil {
				t.Fatal("null should preserve the default-enabled fallback")
			}
		} else if got == nil || *got != (value == "true") {
			t.Fatalf("notification preference lost after round trip: %s", data)
		}
		if bazaarNotifications(config.Notifications).SelectAllIncompleteTip != got {
			t.Fatal("bazaar response lost notification preference")
		}
	}
	var legacy util.Notifications
	if err := json.Unmarshal([]byte(`{"selectAllTip":false}`), &legacy); err != nil {
		t.Fatal(err)
	}
	if legacy.SelectAllIncompleteTip != nil {
		t.Fatal("legacy config should retain the default-enabled fallback")
	}

	source, err := os.ReadFile("../../app/src/config/tabs/appearanceTab.ts")
	if err != nil {
		t.Fatal(err)
	}
	items := regexp.MustCompile(`(?s)const NOTIFICATIONS_ITEMS.*?= \[(.*?)\];`).FindSubmatch(source)
	if len(items) != 2 {
		t.Fatal("notification catalog not found")
	}
	data, err := json.Marshal(defaults)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]bool
	if err = json.Unmarshal(data, &fields); err != nil {
		t.Fatal(err)
	}
	for _, match := range regexp.MustCompile(`field: "([^"]+)"`).FindAllSubmatch(items[1], -1) {
		if enabled, exists := fields[string(match[1])]; !exists || !enabled {
			t.Errorf("frontend notification %s lacks an enabled persistence default", match[1])
		}
	}
}
