// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAIMemoryDefaultsAndSelection(t *testing.T) {
	ai := NormalizeAI(&AI{})
	if ai.Memory == nil || ai.Memory.Enabled || ai.Memory.AutoMaintain || ai.Memory.Conversations || ai.Memory.ModelID != "" || ai.Memory.ReasoningEffort != "" || ai.Memory.Sources == nil {
		t.Fatal("unsafe memory defaults")
	}
	ai.Providers = []*Provider{{ID: "20261029000000-provide", Enabled: true, Models: []*Model{{ID: "20261029000000-modelid", Name: "gpt-5", Enabled: true}}}}
	ai.Memory = &Memory{Enabled: true, ModelID: " removed-model ", ReasoningEffort: " HIGH ", Sources: []string{"20261029000000-source1", "20261029000000-source1"}}
	NormalizeAI(ai)
	if ai.Memory.ModelID != "removed-model" || ai.Memory.ReasoningEffort != "high" || len(ai.Memory.Sources) != 1 {
		t.Fatal("normalization replaced selection or lost source deduplication")
	}
	if _, _, err := ai.GetMemoryModel(); err == nil {
		t.Fatal("invalid selection silently fell back")
	}
	ai.Memory.ModelID = ai.Providers[0].Models[0].Name
	if _, _, err := ai.GetMemoryModel(); err == nil {
		t.Fatal("memory selection accepted ambiguous model name instead of ID")
	}
	ai.Memory.ModelID = ai.Providers[0].Models[0].ID
	if err := ai.ValidateMemoryModel(); err != nil {
		t.Fatal(err)
	}
	ai.Agent.ModelID = "different"
	NormalizeAI(ai)
	if ai.Memory.ModelID != ai.Providers[0].Models[0].ID {
		t.Fatal("agent selection changed independent memory model")
	}
	ai.Providers[0].Models[0].Enabled = false
	NormalizeAI(ai)
	if ai.Memory.ModelID == "" {
		t.Fatal("disabled model reference was silently cleared")
	}
	if ai.ValidateMemoryModel() == nil {
		t.Fatal("disabled model accepted")
	}
}

func TestAIMemoryReasoningCapabilities(t *testing.T) {
	for _, tc := range []struct {
		protocol, name, effort string
		valid                  bool
	}{
		{util.OpenAIProtocolResponses, "gpt-5", "high", true},
		{util.OpenAIProtocolResponses, "custom", "high", false},
		{util.OpenAIProtocolResponses, "gpt-5-custom", "high", false},
		{util.OpenAIProtocolResponses, "custom", "", true},
		{util.OpenAIProtocolResponses, "gpt-5", "invented", false},
		{"unknown", "gpt-5", "low", false},
		{util.AnthropicProtocolMessages, "claude-sonnet-4-5", "medium", true},
	} {
		ai := NewAI()
		ai.Memory.ModelID, ai.Memory.ReasoningEffort = "chosen", tc.effort
		ai.Providers = []*Provider{{Enabled: true, Protocol: tc.protocol, Models: []*Model{{ID: "chosen", Name: tc.name, Enabled: true}}}}
		if (ai.ValidateMemoryModel() == nil) != tc.valid {
			t.Errorf("unexpected support: %#v", tc)
		}
	}
}

func TestAIMemoryPersistence(t *testing.T) {
	ai := NewAI()
	ai.Memory = &Memory{Enabled: true, Conversations: true, ModelID: "chosen", ReasoningEffort: "high", Sources: []string{"20261029000000-source1"}}
	data, err := json.Marshal(ai)
	if err != nil {
		t.Fatal(err)
	}
	var restored AI
	if err = json.Unmarshal(data, &restored); err != nil {
		t.Fatal(err)
	}
	NormalizeAI(&restored)
	if !reflect.DeepEqual(ai.Memory, restored.Memory) {
		t.Fatal("memory selection changed after reload")
	}
}
