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

func TestAPIContractSettingMathDelimiters(t *testing.T) {
	compareSettingConfig(t, apicontract.SetEditor, conf.NewEditor, []string{
		`{}`, `{"mathDelimiterCompatibility":true}`, `{"mathDelimiterCompatibility":false}`,
		`{"mathDelimiterCompatibility":null}`, `{"MathDelimiterCompatibility":false}`, `{"mathDelimiterCompatibility":"bad"}`,
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
	for _, tc := range []struct {
		body string
		want bool
	}{
		{`{}`, true}, {`{"mathDelimiterCompatibility":false}`, false}, {`{}`, false},
		{`{"mathDelimiterCompatibility":true}`, true},
	} {
		code, message, data := settingContractRequest(t, "setEditor", setEditor, tc.body)
		var response apicontract.SettingEditor
		if err := json.Unmarshal(data, &response); err != nil {
			t.Fatal(err)
		}
		if code != 0 || response.MathDelimiterCompatibility == nil || *response.MathDelimiterCompatibility != tc.want || model.MathDelimiterCompatibilityEnabled() != tc.want {
			t.Fatalf("setting %s: code=%d message=%s data=%s", tc.body, code, message, data)
		}
	}
}
