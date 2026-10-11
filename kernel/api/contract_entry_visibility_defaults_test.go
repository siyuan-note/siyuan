package api

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractEntryVisibilityDefaults(t *testing.T) {
	previous, readOnly := model.Conf, util.ReadOnly
	util.ReadOnly = true
	t.Cleanup(func() { model.Conf, util.ReadOnly = previous, readOnly })
	for _, version := range []int{6, 7} {
		model.Conf = model.NewAppConf()
		model.Conf.Appearance.Store(conf.NewAppearance())
		body := fmt.Sprintf(`{"version":%d,"active":"custom","profiles":[{"id":"custom","name":"Custom","defaults":"simple","entries":{"editor.toolbar.strong":false},"orders":{"dock":["plugin:unavailable:dock"]}}]}`, version)
		code, message, data := settingContractRequest(t, "setEntryVisibility", setEntryVisibility, body)
		if code != 0 {
			t.Fatal(message)
		}
		var response struct {
			Version  int `json:"version"`
			Profiles []struct {
				Defaults *string             `json:"defaults"`
				Entries  map[string]bool     `json:"entries"`
				Orders   map[string][]string `json:"orders"`
			} `json:"profiles"`
		}
		if err := json.Unmarshal(data, &response); err != nil {
			t.Fatal(err)
		}
		profile := response.Profiles[0]
		if response.Version != 7 || (version == 6 && profile.Defaults != nil) ||
			(version == 7 && (profile.Defaults == nil || *profile.Defaults != "simple")) ||
			len(profile.Entries) != 1 || profile.Entries["editor.toolbar.strong"] || profile.Orders["dock"][0] != "plugin:unavailable:dock" {
			t.Fatalf("profile semantics changed: %s", data)
		}
	}
}
