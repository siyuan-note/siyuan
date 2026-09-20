package conf

import "testing"

func TestAIDecisionConfiguration(t *testing.T) {
	ai := &AI{}
	ai.Normalize()
	if ai.Decision.Enabled || ai.Decision.Timeout != 30 || ai.Decision.Name != "jev-latest" || ai.Decision.Endpoint != "https://api.typesafe.ai/v1/systemone" {
		t.Fatalf("incorrect defaults: %+v", ai.Decision)
	}
	ai.Decision.APIKey = "test-decision-key"
	ai.Decision.Timeout = 900
	ai.Normalize()
	if !ai.Decision.Configured() || ai.Decision.Timeout != 600 {
		t.Fatal("decision normalization failed")
	}
	ai.EncryptAPIKeys()
	if ai.Decision.APIKey == "test-decision-key" || ai.Decision.APIKey == "" {
		t.Fatal("decision key not encrypted")
	}
	ai.DecryptAPIKeys()
	if ai.Decision.APIKey != "test-decision-key" || ai.Decision.Enabled {
		t.Fatal("disabled decision configuration was not preserved")
	}
}
