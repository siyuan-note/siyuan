// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractSettingAIMemory(t *testing.T) {
	previous, readonly, confDir := model.Conf, util.ReadOnly, util.ConfDir
	t.Cleanup(func() { model.Conf, util.ReadOnly, util.ConfDir = previous, readonly, confDir })
	util.ReadOnly, util.ConfDir = true, t.TempDir()
	model.Conf = model.NewAppConf()
	model.Conf.AI.Store(conf.NewAI())
	code, message, data := settingContractRequest(t, "setAI", setAI,
		`{"memory":{"enabled":true,"autoMaintain":false,"conversations":true,"modelId":"missing-model","reasoningEffort":"high","sources":["20261029000000-source1"]}}`)
	if code != 0 {
		t.Fatal(message)
	}
	if bytes.Contains(data, []byte(`"sources"`)) || bytes.Contains(data, []byte(`"autoMaintain"`)) || bytes.Contains(data, []byte(`"conversations"`)) {
		t.Fatalf("obsolete memory controls returned: %s", data)
	}
	var result apicontract.SettingAI
	if err := json.Unmarshal(data, &result); err != nil || result.Memory == nil || !result.Memory.Enabled ||
		result.Memory.ModelID != "missing-model" || result.Memory.ReasoningEffort != "high" {
		t.Fatalf("memory setting not preserved: %s %v", data, err)
	}
	code, message, _ = settingContractRequest(t, "setAI", setAI, `{"agent":{"maxRetries":2}}`)
	memory := model.Conf.AI.Load().Memory
	if code != 0 || memory.ModelID != "missing-model" || !memory.Enabled || memory.ReasoningEffort != "high" {
		t.Fatalf("omitted memory reset: %s", message)
	}
	code, message, _ = settingContractRequest(t, "patch", patchSetting, `{"ai":{"memory":{"enabled":false}}}`)
	memory = model.Conf.AI.Load().Memory
	if code != 0 || memory.Enabled || memory.ModelID != "missing-model" || memory.ReasoningEffort != "high" {
		t.Fatalf("partial save lost independent fields or explicit false: %s", message)
	}
	code, message, _ = settingContractRequest(t, "setAI", setAI, `{"memory":{"reasoningEffort":null,"sources":null,"conversations":null}}`)
	memory = model.Conf.AI.Load().Memory
	if code != 0 || memory.ReasoningEffort != "" || memory.ModelID != "missing-model" {
		t.Fatalf("null field did not restore defaults: %s", message)
	}
	code, message, _ = settingContractRequest(t, "setAI", setAI, `{"memory":null}`)
	memory = model.Conf.AI.Load().Memory
	if code != 0 || memory.Enabled || memory.ModelID != "" || memory.ReasoningEffort != "" {
		t.Fatalf("null memory did not restore safe defaults: %s", message)
	}
}
