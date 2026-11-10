// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractSettingBazaarCompatibilityFilters(t *testing.T) {
	previous, readonly, confDir := model.Conf, util.ReadOnly, util.ConfDir
	t.Cleanup(func() { model.Conf, util.ReadOnly, util.ConfDir = previous, readonly, confDir })
	util.ReadOnly, util.ConfDir = true, t.TempDir()
	model.Conf = model.NewAppConf()
	model.NormalizeAppConf(model.Conf)
	initial := conf.NewBazaar()
	initial.Trust, initial.PetalDisabled = true, true
	model.Conf.Bazaar.Store(initial)
	revision := model.BazaarPetalStateRevision.Load()
	for _, test := range []struct {
		name, body                    string
		pluginVersion, pluginPlatform bool
		themeVersion, themePlatform   bool
	}{
		{"enable plugin version", `{"compatibilityFilters":{"plugins":{"hideUnsupportedVersion":true}}}`, true, false, false, false},
		{"enable plugin platform", `{"compatibilityFilters":{"plugins":{"hideIncompatiblePlatform":true}}}`, true, true, false, false},
		{"independent theme", `{"compatibilityFilters":{"themes":{"hideIncompatiblePlatform":true}}}`, true, true, false, true},
		{"explicit false", `{"compatibilityFilters":{"plugins":{"hideUnsupportedVersion":false}}}`, false, true, false, true},
		{"null flag", `{"compatibilityFilters":{"plugins":{"hideIncompatiblePlatform":null}}}`, false, false, false, true},
		{"null category", `{"compatibilityFilters":{"themes":null}}}`, false, false, false, false},
		{"enable two categories", `{"compatibilityFilters":{"plugins":{"hideUnsupportedVersion":true},"themes":{"hideUnsupportedVersion":true}}}`, true, false, true, false},
		{"null filters", `{"compatibilityFilters":null}`, false, false, false, false},
		{"unknown category", `{"compatibilityFilters":{"unknown":{"hideUnsupportedVersion":true}}}`, false, false, false, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			code, message, _ := settingContractRequest(t, "patch", patchSetting, `{"bazaar":`+test.body+`}`)
			if code != 0 {
				t.Fatal(message)
			}
			value := model.Conf.Bazaar.Load()
			plugins, themes := value.CompatibilityFilters["plugins"], value.CompatibilityFilters["themes"]
			if !value.Trust || !value.PetalDisabled || len(value.CompatibilityFilters) != 5 ||
				plugins.HideUnsupportedVersion != test.pluginVersion || plugins.HideIncompatiblePlatform != test.pluginPlatform ||
				themes.HideUnsupportedVersion != test.themeVersion || themes.HideIncompatiblePlatform != test.themePlatform {
				t.Fatalf("unexpected settings after patch: %#v %#v %#v", value, plugins, themes)
			}
		})
	}
	code, message, data := settingContractRequest(t, "setBazaar", setBazaar,
		`{"compatibilityFilters":{"plugins":{"hideUnsupportedVersion":true}}}`)
	var result apicontract.SettingBazaar
	if err := json.Unmarshal(data, &result); code != 0 || err != nil || result.CompatibilityFilters["plugins"] == nil ||
		!result.CompatibilityFilters["plugins"].HideUnsupportedVersion || !result.Trust || !result.PetalDisabled {
		t.Fatalf("setBazaar did not return filter settings: %d %s %s %v", code, message, data, err)
	}
	section := requestSettingSection(t, model.RoleAdministrator, `{"namespace":"bazaar"}`)
	if section.Conf.Bazaar == nil || !section.Conf.Bazaar.CompatibilityFilters["plugins"].HideUnsupportedVersion {
		t.Fatalf("getSection lost filter settings: %#v", section.Conf.Bazaar)
	}
	code, message, _ = settingContractRequest(t, "setBazaar", setBazaar, `{"compatibilityFilters":{"plugins":null}}`)
	if code != 0 || model.Conf.Bazaar.Load().CompatibilityFilters["plugins"].HideUnsupportedVersion {
		t.Fatalf("setBazaar null did not reset filters: %s", message)
	}
	for _, invalid := range []string{`{"plugins":{"hideUnsupportedVersion":"true"}}`, `{"plugins":false}`} {
		before := model.Conf.Bazaar.Load()
		code, _, _ = settingContractRequest(t, "patch", patchSetting, `{"bazaar":{"compatibilityFilters":`+invalid+`}}`)
		if code == 0 || model.Conf.Bazaar.Load() != before {
			t.Fatalf("invalid filters were accepted: %s", invalid)
		}
	}
	if model.BazaarPetalStateRevision.Load() != revision {
		t.Fatal("filter-only changes reloaded plugins")
	}
}
