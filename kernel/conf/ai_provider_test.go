// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package conf

import "testing"

func TestNewAIAddsKeylessProviderFromEnvironment(t *testing.T) {
	t.Setenv("SIYUAN_OPENAI_API_KEY", "")
	t.Setenv("SIYUAN_OPENAI_API_MODEL", "local-model")
	t.Setenv("SIYUAN_OPENAI_API_BASE_URL", "http://127.0.0.1:8080/v1")

	ai := NewAI()
	if len(ai.Providers) != 1 {
		t.Fatalf("provider count = %d, want 1", len(ai.Providers))
	}
	provider := ai.Providers[0]
	if provider.APIKey != "" || provider.BaseURL != "http://127.0.0.1:8080/v1" || !provider.Enabled {
		t.Fatalf("unexpected keyless provider: %#v", provider)
	}
	if len(provider.Models) != 1 || provider.Models[0].Name != "local-model" || !provider.Models[0].Enabled {
		t.Fatalf("unexpected keyless provider models: %#v", provider.Models)
	}
}

func TestNewAIAddsAtlasCloudProviderFromEnvironment(t *testing.T) {
	t.Setenv("SIYUAN_ATLASCLOUD_API_KEY", "atlas-key")

	ai := NewAI()
	if len(ai.Providers) != 1 {
		t.Fatalf("provider count = %d, want 1", len(ai.Providers))
	}
	provider := ai.Providers[0]
	if provider.DisplayName != "Atlas Cloud" || provider.APIKey != "atlas-key" || provider.BaseURL != atlasCloudDefaultBaseURL || !provider.Enabled {
		t.Fatalf("unexpected Atlas Cloud provider: %#v", provider)
	}
	if len(provider.Models) != 1 || provider.Models[0].Name != atlasCloudDefaultModel || !provider.Models[0].Enabled {
		t.Fatalf("unexpected Atlas Cloud provider models: %#v", provider.Models)
	}
}

func TestNewAIReadsAtlasCloudAliasEnvironment(t *testing.T) {
	t.Setenv("SIYUAN_ATLAS_CLOUD_API_KEY", "alias-key")
	t.Setenv("SIYUAN_ATLAS_CLOUD_API_MODEL", "deepseek-ai/deepseek-v4-pro")
	t.Setenv("SIYUAN_ATLAS_CLOUD_API_BASE_URL", "https://atlas.example/v1")
	t.Setenv("SIYUAN_ATLAS_CLOUD_API_TIMEOUT", "240")
	t.Setenv("SIYUAN_ATLAS_CLOUD_API_MAX_TOKENS", "4096")
	t.Setenv("SIYUAN_ATLAS_CLOUD_API_TEMPERATURE", "0.6")
	t.Setenv("SIYUAN_ATLAS_CLOUD_API_MAX_CONTEXTS", "12")

	ai := NewAI()
	if len(ai.Providers) != 1 {
		t.Fatalf("provider count = %d, want 1", len(ai.Providers))
	}
	provider := ai.Providers[0]
	if provider.APIKey != "alias-key" || provider.BaseURL != "https://atlas.example/v1" || provider.RequestTimeout != 240 {
		t.Fatalf("unexpected Atlas Cloud alias provider: %#v", provider)
	}
	if provider.Models[0].Name != "deepseek-ai/deepseek-v4-pro" {
		t.Fatalf("unexpected Atlas Cloud alias model: %#v", provider.Models[0])
	}
	if ai.Editing.MaxCompletionTokens != 4096 || ai.Editing.Temperature != 0.6 || ai.Editing.MaxHistoryMessages != 12 {
		t.Fatalf("unexpected Atlas Cloud editing defaults: %#v", ai.Editing)
	}
}

func TestNewAIPrefersOpenAIEnvironmentOverAtlasCloud(t *testing.T) {
	t.Setenv("SIYUAN_OPENAI_API_KEY", "")
	t.Setenv("SIYUAN_OPENAI_API_MODEL", "openai-model")
	t.Setenv("SIYUAN_OPENAI_API_BASE_URL", "https://openai.example/v1")
	t.Setenv("SIYUAN_ATLASCLOUD_API_KEY", "atlas-key")
	t.Setenv("SIYUAN_ATLASCLOUD_API_MODEL", "atlas-model")
	t.Setenv("SIYUAN_ATLASCLOUD_API_BASE_URL", "https://atlas.example/v1")

	ai := NewAI()
	if len(ai.Providers) != 1 {
		t.Fatalf("provider count = %d, want 1", len(ai.Providers))
	}
	provider := ai.Providers[0]
	if provider.DisplayName != "" || provider.APIKey != "" || provider.BaseURL != "https://openai.example/v1" {
		t.Fatalf("unexpected OpenAI provider precedence: %#v", provider)
	}
	if len(provider.Models) != 1 || provider.Models[0].Name != "openai-model" {
		t.Fatalf("unexpected OpenAI model precedence: %#v", provider.Models)
	}
}

func TestAIKeylessProviderIsAvailable(t *testing.T) {
	model := &Model{ID: "model-id", DisplayName: "Local Model", Name: "local-model", Enabled: true}
	provider := &Provider{Enabled: true, BaseURL: "http://127.0.0.1:8080/v1", Models: []*Model{model}}
	ai := &AI{Providers: []*Provider{provider}}

	if !ai.HasAnyProvider() {
		t.Fatal("keyless provider should be available")
	}
	for _, id := range []string{model.ID, model.DisplayName, model.Name} {
		gotProvider, gotModel := ai.GetModel(id)
		if gotProvider != provider || gotModel != model {
			t.Fatalf("GetModel(%q) returned provider=%p model=%p", id, gotProvider, gotModel)
		}
	}
}

func TestAIDisabledKeylessProviderOrModelIsUnavailable(t *testing.T) {
	tests := []struct {
		name     string
		provider *Provider
	}{
		{
			name:     "disabled provider",
			provider: &Provider{Models: []*Model{{ID: "model-id", Name: "local-model", Enabled: true}}},
		},
		{
			name:     "disabled model",
			provider: &Provider{Enabled: true, Models: []*Model{{ID: "model-id", Name: "local-model"}}},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ai := &AI{Providers: []*Provider{test.provider}}
			if ai.HasAnyProvider() {
				t.Fatal("disabled provider or model should be unavailable")
			}
			if provider, model := ai.GetModel("model-id"); provider != nil || model != nil {
				t.Fatalf("disabled provider or model returned provider=%p model=%p", provider, model)
			}
		})
	}
}

func TestAssignDefaultModelIDsUsesKeylessProvider(t *testing.T) {
	model := &Model{ID: "model-id", Name: "local-model", Enabled: true}
	ai := &AI{
		Providers: []*Provider{{Enabled: true, Models: []*Model{model}}},
		Agent:     &Agent{},
		Editing:   &Editing{},
	}

	assignDefaultModelIDs(ai)
	if ai.Agent.ModelID != model.ID || ai.Editing.ModelID != model.ID {
		t.Fatalf("unexpected default model IDs: agent=%q editing=%q", ai.Agent.ModelID, ai.Editing.ModelID)
	}
}
