package conf

import (
	"testing"
)

func TestChatGPTProviderNormalization(t *testing.T) {
	ai := NewAI()
	ai.Providers = []*Provider{{AuthType: "chatgpt", AccountID: "account", Enabled: true, APIKey: "must-not-be-used",
		BaseURL: "https://untrusted.example/v1", Protocol: "openai", Headers: map[string]string{"Authorization": "untrusted"}}}
	ai.Providers[0].Models = []*Model{{ID: "model", Name: "model", Enabled: true}}
	ai.Normalize()
	p := ai.Providers[0]
	if p.APIKey != "" || p.BaseURL != "https://api.openai.com/v1" || p.Protocol != "openai-responses" || len(p.Headers) != 0 || p.AccountID != "account" {
		t.Fatalf("wrong subscription provider: %+v", p)
	}
	ai.ImageGeneration.ModelID = "model"
	if provider, _ := ai.GetImageGenerationModel(); provider != nil {
		t.Fatal("subscription model offered for image generation")
	}
}
