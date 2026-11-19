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

func TestAPIContractSettingDatabaseShowRelationIcon(t *testing.T) {
	compareSettingConfig(t, apicontract.SetEditor, conf.NewEditor, []string{
		`{}`, `{"databaseShowRelationIcon":true}`, `{"databaseShowRelationIcon":false}`,
		`{"databaseShowRelationIcon":null}`, `{"DatabaseShowRelationIcon":false}`, `{"databaseShowRelationIcon":"bad"}`,
	})
	previousConf, previousReadOnly, previousMarkdown := model.Conf, util.ReadOnly, util.MarkdownSettings.Load()
	model.Conf = model.NewAppConf()
	model.Conf.Editor.Store(conf.NewEditor())
	util.ReadOnly = true
	t.Cleanup(func() {
		model.Conf, util.ReadOnly = previousConf, previousReadOnly
		util.MarkdownSettings.Store(previousMarkdown)
	})
	for _, entry := range []struct {
		body string
		want bool
	}{
		{`{}`, true}, {`{"databaseShowRelationIcon":false}`, false}, {`{}`, false},
		{`{"databaseShowRelationIcon":null}`, true}, {`{"databaseShowRelationIcon":true}`, true},
		{`{"DatabaseShowRelationIcon":false}`, false},
	} {
		code, message, data := settingContractRequest(t, "setEditor", setEditor, entry.body)
		var response apicontract.SettingEditor
		if err := json.Unmarshal(data, &response); err != nil {
			t.Fatal(err)
		}
		actual := model.Conf.Editor.Load().DatabaseShowRelationIcon
		if code != 0 || actual == nil || *actual != entry.want || response.DatabaseShowRelationIcon == nil || *response.DatabaseShowRelationIcon != entry.want {
			t.Fatalf("database icon setting %s: code=%d message=%s data=%s", entry.body, code, message, data)
		}
	}
}

func TestAPIContractSettingDatabaseShowIcon(t *testing.T) {
	compareSettingConfig(t, apicontract.SetEditor, conf.NewEditor, []string{
		`{}`, `{"databaseShowIcon":true}`, `{"databaseShowIcon":false}`,
		`{"databaseShowIcon":null}`, `{"DatabaseShowIcon":false}`, `{"databaseShowIcon":"bad"}`,
	})
	previousConf, previousReadOnly, previousMarkdown := model.Conf, util.ReadOnly, util.MarkdownSettings.Load()
	model.Conf = model.NewAppConf()
	model.Conf.Editor.Store(conf.NewEditor())
	util.ReadOnly = true
	t.Cleanup(func() {
		model.Conf, util.ReadOnly = previousConf, previousReadOnly
		util.MarkdownSettings.Store(previousMarkdown)
	})
	for _, entry := range []struct {
		body string
		want bool
	}{
		{`{}`, true}, {`{"databaseShowIcon":false}`, false}, {`{}`, false},
		{`{"databaseShowIcon":null}`, true}, {`{"databaseShowIcon":true}`, true},
		{`{"DatabaseShowIcon":false}`, false},
	} {
		code, message, data := settingContractRequest(t, "setEditor", setEditor, entry.body)
		var response apicontract.SettingEditor
		if err := json.Unmarshal(data, &response); err != nil {
			t.Fatal(err)
		}
		actual := model.Conf.Editor.Load().DatabaseShowIcon
		if code != 0 || actual == nil || *actual != entry.want || response.DatabaseShowIcon == nil || *response.DatabaseShowIcon != entry.want {
			t.Fatalf("database icon setting %s: code=%d message=%s data=%s", entry.body, code, message, data)
		}
	}
	for _, entry := range []struct {
		body              string
		primary, relation bool
	}{
		{`{"editor":{"databaseShowIcon":false,"databaseShowRelationIcon":false}}`, false, false},
		{`{"editor":{"fontSize":18}}`, false, false},
		{`{"editor":{"databaseShowIcon":null}}`, true, false},
		{`{"editor":{"databaseShowRelationIcon":null}}`, true, true},
	} {
		code, message, _ := settingContractRequest(t, "patch", patchSetting, entry.body)
		editor := model.Conf.Editor.Load()
		if code != 0 || *editor.DatabaseShowIcon != entry.primary || *editor.DatabaseShowRelationIcon != entry.relation {
			t.Fatalf("database icons patch %s: code=%d message=%s", entry.body, code, message)
		}
	}
}
