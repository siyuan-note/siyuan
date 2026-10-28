// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import (
	"encoding/json"
	"testing"
)

func TestAIDecisionConfiguration(t *testing.T) {
	ai := &AI{Decision: &Decision{Enabled: true, Endpoint: " https://example.com/decision ", APIKey: "legacy-key", Name: "legacy-model", Timeout: 900}}
	ai.Normalize()
	if ai.Decision.Provider != "typesafe" || !ai.Decision.Configured() || ai.Decision.Profiles["typesafe"].Timeout != 600 || !ai.Decision.Enabled {
		t.Fatal("legacy migration failed")
	}
	if ai.Decision.APIKey != "" || ai.Decision.Profiles["openai"].APIKey != "" {
		t.Fatal("legacy credentials duplicated or leaked")
	}
	ai.Decision.Profiles["openai"].APIKey = "openai-key"
	ai.Decision.Provider = "openai"
	ai.Normalize()
	ai.EncryptAPIKeys()
	if ai.Decision.Profiles["typesafe"].APIKey == "legacy-key" || ai.Decision.Profiles["openai"].APIKey == "openai-key" {
		t.Fatal("both profiles must be encrypted")
	}
	data, err := json.Marshal(ai)
	if err != nil {
		t.Fatal(err)
	}
	restored := &AI{}
	if err = json.Unmarshal(data, restored); err != nil {
		t.Fatal(err)
	}
	restored.DecryptAPIKeys()
	restored.Normalize()
	if restored.Decision.Profiles["typesafe"].APIKey != "legacy-key" || restored.Decision.Profiles["openai"].APIKey != "openai-key" || restored.Decision.Provider != "openai" {
		t.Fatal("profile round trip failed")
	}
	restored.Decision.Provider = "unknown"
	if restored.Decision.Configured() {
		t.Fatal("unknown provider silently accepted")
	}
}
