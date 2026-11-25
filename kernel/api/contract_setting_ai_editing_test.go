// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractSettingAIEditingReasoningEffort(t *testing.T) {
	aiContractConfiguration(t)
	readonly, confDir := util.ReadOnly, util.ConfDir
	t.Cleanup(func() { util.ReadOnly, util.ConfDir = readonly, confDir })
	util.ReadOnly, util.ConfDir = true, t.TempDir()

	for _, tc := range []struct {
		config string
		patch  bool
		want   string
	}{
		{`{"editing":{"maxHistoryMessages":12}}`, false, ""},
		{`{"ai":{"editing":{"reasoningEffort":"high"}}}`, true, "high"},
		{`{"agent":{"maxRetries":2}}`, false, "high"},
		{`{"editing":{"reasoningEffort":null}}`, false, ""},
	} {
		if tc.patch {
			code, message, _ := settingContractRequest(t, "patch", patchSetting, tc.config)
			if code != 0 || model.Conf.AI.Load().Editing.ReasoningEffort != tc.want {
				t.Fatalf("patch %s: %d %s", tc.config, code, message)
			}
			continue
		}
		code, message, data := settingContractRequest(t, "setAI", setAI, tc.config)
		var result apicontract.SettingAI
		if err := json.Unmarshal(data, &result); code != 0 || err != nil || result.Editing == nil ||
			result.Editing.ReasoningEffort != tc.want || result.Editing.MaxHistoryMessages != 12 ||
			model.Conf.AI.Load().Editing.ReasoningEffort != tc.want {
			t.Fatalf("config %s: %d %s %s (%v)", tc.config, code, message, data, err)
		}
	}
}
