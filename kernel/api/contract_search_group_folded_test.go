// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
	"testing"
)

func TestAPIContractSearchGroupFoldedCompatibility(t *testing.T) {
	compareSettingConfig(t, apicontract.SetSearch, conf.NewSearch, []string{
		`{}`, `{"groupFolded":true}`, `{"groupFolded":false}`, `{"groupFolded":null}`,
		`{"GroupFolded":true}`, `{"groupFolded":"true"}`, `{"groupFolded":1}`,
	})
}

func TestAPIContractSearchGroupFoldedUpdates(t *testing.T) {
	previousConf, previousReadOnly := model.Conf, util.ReadOnly
	t.Cleanup(func() { model.Conf, util.ReadOnly = previousConf, previousReadOnly })
	model.Conf = model.NewAppConf()
	model.Conf.Search.Store(conf.NewSearch())
	util.ReadOnly = true
	for _, entry := range []struct {
		body string
		want bool
	}{
		{`{"groupFolded":true}`, true}, {`{}`, true}, {`{"groupFolded":false}`, false},
		{`{"GroupFolded":true}`, true}, {`{"groupFolded":null}`, false},
	} {
		code, message, data := settingContractRequest(t, "setSearch", setSearch, entry.body)
		var response apicontract.SettingSearch
		if err := json.Unmarshal(data, &response); err != nil {
			t.Fatal(err)
		}
		if code != 0 || response.GroupFolded != entry.want || model.Conf.Search.Load().GroupFolded != entry.want {
			t.Fatalf("preference update failed: %s, code=%d message=%s data=%s", entry.body, code, message, data)
		}
	}
	for _, entry := range []struct {
		body string
		want bool
	}{
		{`{"search":{"groupFolded":true}}`, true}, {`{"search":{"limit":128}}`, true},
		{`{"search":{"groupFolded":false}}`, false}, {`{"search":{"groupFolded":true}}`, true},
		{`{"search":{"groupFolded":null}}`, false},
	} {
		code, message, _ := settingContractRequest(t, "patch", patchSetting, entry.body)
		if code != 0 || model.Conf.Search.Load().GroupFolded != entry.want {
			t.Fatalf("namespace patch failed: %s, code=%d message=%s", entry.body, code, message)
		}
	}
	before := model.Conf.Search.Load()
	code, _, _ := settingContractRequest(t, "patch", patchSetting, `{"search":{"groupFolded":"true"}}`)
	if code == 0 || model.Conf.Search.Load() != before {
		t.Fatal("invalid preference changed configuration")
	}
}
