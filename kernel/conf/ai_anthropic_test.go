// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import "testing"

func TestAnthropicProviderDefaultsPreserveExistingProtocols(t *testing.T) {
	ai := NewAI()
	ai.Providers = []*Provider{
		{Enabled: true, Protocol: " ANTHROPIC-MESSAGES "},
		{Enabled: true},
		{Enabled: true, Protocol: "openai-responses", BaseURL: "https://example.com/v1"},
		{Enabled: true, Protocol: " GEMINI-INTERACTIONS "},
		{Enabled: true, Protocol: "openai", BaseURL: "https://generativelanguage.googleapis.com/v1beta/openai"},
	}
	ai.Normalize()
	if ai.Providers[3].Protocol != "gemini-interactions" || ai.Providers[3].BaseURL != "https://generativelanguage.googleapis.com/v1beta" ||
		ai.Providers[4].Protocol != "openai" || ai.Providers[4].BaseURL != "https://generativelanguage.googleapis.com/v1beta/openai" {
		t.Fatal("Gemini native defaults changed compatible providers")
	}
	if ai.Providers[0].Protocol != "anthropic-messages" || ai.Providers[0].BaseURL != "https://api.anthropic.com/v1" {
		t.Fatalf("unexpected Messages defaults: %+v", ai.Providers[0])
	}
	if ai.Providers[1].Protocol != "openai" || ai.Providers[1].BaseURL != "https://api.openai.com/v1" ||
		ai.Providers[2].Protocol != "openai-responses" || ai.Providers[2].BaseURL != "https://example.com/v1" {
		t.Fatal("existing provider defaults changed")
	}
}
