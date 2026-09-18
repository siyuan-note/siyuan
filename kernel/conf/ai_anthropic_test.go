package conf

import "testing"

func TestAnthropicProviderDefaultsPreserveExistingProtocols(t *testing.T) {
	ai := NewAI()
	ai.Providers = []*Provider{
		{Enabled: true, Protocol: " ANTHROPIC-MESSAGES "},
		{Enabled: true},
		{Enabled: true, Protocol: "openai-responses", BaseURL: "https://example.com/v1"},
	}
	ai.Normalize()
	if ai.Providers[0].Protocol != "anthropic-messages" || ai.Providers[0].BaseURL != "https://api.anthropic.com/v1" {
		t.Fatalf("unexpected Messages defaults: %+v", ai.Providers[0])
	}
	if ai.Providers[1].Protocol != "openai" || ai.Providers[1].BaseURL != "https://api.openai.com/v1" ||
		ai.Providers[2].Protocol != "openai-responses" || ai.Providers[2].BaseURL != "https://example.com/v1" {
		t.Fatal("existing provider defaults changed")
	}
}
