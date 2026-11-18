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

func TestAPIContractSettingBreadcrumb(t *testing.T) {
	compareSettingConfig(t, apicontract.SetEditor, conf.NewEditor, []string{
		`{}`, `{"globalBreadcrumb":true}`, `{"globalBreadcrumb":false}`,
		`{"globalBreadcrumb":null}`, `{"GlobalBreadcrumb":true}`, `{"globalBreadcrumb":"bad"}`,
		`{"hideBreadcrumbIcons":true}`, `{"hideBreadcrumbIcons":false}`,
		`{"hideBreadcrumbIcons":null}`, `{"HideBreadcrumbIcons":true}`, `{"hideBreadcrumbIcons":"bad"}`,
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
	if model.Conf.Editor.Load().GlobalBreadcrumb {
		t.Fatal("global breadcrumb must default to disabled")
	}
	for _, entry := range []struct {
		body string
		want bool
	}{
		{`{"globalBreadcrumb":true}`, true}, {`{}`, true}, {`{"globalBreadcrumb":false}`, false},
		{`{"GlobalBreadcrumb":true}`, true}, {`{"globalBreadcrumb":null}`, false},
	} {
		code, message, data := settingContractRequest(t, "setEditor", setEditor, entry.body)
		var response apicontract.SettingEditor
		if err := json.Unmarshal(data, &response); err != nil {
			t.Fatal(err)
		}
		if code != 0 || model.Conf.Editor.Load().GlobalBreadcrumb != entry.want || response.GlobalBreadcrumb != entry.want {
			t.Fatalf("global breadcrumb update %s: code=%d message=%s data=%s", entry.body, code, message, data)
		}
	}
	for _, entry := range []struct {
		body string
		want bool
	}{
		{`{"hideBreadcrumbIcons":true}`, true},
		{`{"globalBreadcrumb":true}`, true},
		{`{"globalBreadcrumb":false}`, true},
		{`{}`, true},
		{`{"hideBreadcrumbIcons":false}`, false},
		{`{"HideBreadcrumbIcons":true}`, true},
		{`{"hideBreadcrumbIcons":null}`, false},
		{`{"hideGlobalBreadcrumbIcons":true}`, false},
	} {
		code, message, data := settingContractRequest(t, "setEditor", setEditor, entry.body)
		var response struct {
			HideBreadcrumbIcons    *bool           `json:"hideBreadcrumbIcons"`
			OldHideBreadcrumbIcons json.RawMessage `json:"hideGlobalBreadcrumbIcons"`
		}
		if err := json.Unmarshal(data, &response); err != nil {
			t.Fatal(err)
		}
		if code != 0 || model.Conf.Editor.Load().HideBreadcrumbIcons != entry.want ||
			response.HideBreadcrumbIcons == nil || *response.HideBreadcrumbIcons != entry.want || response.OldHideBreadcrumbIcons != nil {
			t.Fatalf("breadcrumb icon preference update %s: code=%d message=%s data=%s", entry.body, code, message, data)
		}
	}

	for _, entry := range []struct {
		body string
		want bool
	}{
		{`{"editor":{"hideGlobalBreadcrumbIcons":true}}`, false},
		{`{"editor":{"hideBreadcrumbIcons":true}}`, true},
		{`{"editor":{"hideBreadcrumbIcons":null}}`, false},
	} {
		code, message, _ := settingContractRequest(t, "patch", patchSetting, entry.body)
		if code != 0 || model.Conf.Editor.Load().HideBreadcrumbIcons != entry.want {
			t.Fatalf("breadcrumb icon preference patch %s: code=%d message=%s", entry.body, code, message)
		}
	}
}
