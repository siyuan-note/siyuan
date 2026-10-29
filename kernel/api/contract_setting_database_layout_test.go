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

func TestAPIContractSettingDatabaseAttrLayout(t *testing.T) {
	compareSettingConfig(t, apicontract.SetEditor, conf.NewEditor, []string{
		`{}`, `{"databaseAttrLayout":0}`, `{"databaseAttrLayout":2}`,
		`{"databaseAttrLayout":null}`, `{"DatabaseAttrLayout":2}`,
		`{"databaseAttrLayout":"bad"}`, `{"databaseAttrLayout":true}`, `{"databaseAttrLayout":-1}`, `{"databaseAttrLayout":3}`,
	})
	previousConf, previousReadOnly, previousMarkdown := model.Conf, util.ReadOnly, util.MarkdownSettings.Load()
	model.Conf = model.NewAppConf()
	model.Conf.Editor.Store(conf.NewEditor())
	util.ReadOnly = true
	t.Cleanup(func() {
		model.Conf = previousConf
		util.ReadOnly = previousReadOnly
		util.MarkdownSettings.Store(previousMarkdown)
	})
	for _, entry := range []struct {
		body string
		want int
	}{
		{`{}`, 1}, {`{"databaseAttrLayout":0}`, 0}, {`{}`, 0},
		{`{"databaseAttrLayout":null}`, 1}, {`{"DatabaseAttrLayout":2}`, 2},
		{`{"databaseAttrLayout":1}`, 1}, {`{"databaseAttrLayout":-1}`, 1},
		{`{"databaseAttrLayout":3}`, 1},
	} {
		code, message, data := settingContractRequest(t, "setEditor", setEditor, entry.body)
		var response apicontract.SettingEditor
		if err := json.Unmarshal(data, &response); err != nil {
			t.Fatal(err)
		}
		if code != 0 || response.DatabaseAttrLayout == nil || *response.DatabaseAttrLayout != entry.want ||
			*model.Conf.Editor.Load().DatabaseAttrLayout != entry.want {
			t.Fatalf("database layout update %s: code=%d message=%s data=%s", entry.body, code, message, data)
		}
	}
	for _, entry := range []struct {
		body string
		want int
	}{
		{`{"editor":{"databaseAttrLayout":0}}`, 0},
		{`{"editor":{"fontSize":18}}`, 0},
		{`{"editor":{"databaseAttrLayout":2}}`, 2},
		{`{"editor":{"databaseAttrLayout":null}}`, 1},
	} {
		code, message, _ := settingContractRequest(t, "patch", patchSetting, entry.body)
		if code != 0 || *model.Conf.Editor.Load().DatabaseAttrLayout != entry.want {
			t.Fatalf("database layout patch %s: code=%d message=%s", entry.body, code, message)
		}
	}
}
