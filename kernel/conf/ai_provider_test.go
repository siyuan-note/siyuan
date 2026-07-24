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

func TestReconcileModelIDs(t *testing.T) {
	first := &Model{ID: "first-model", Name: "first", Enabled: true}
	second := &Model{ID: "second-model", Name: "second", DisplayName: "Second", Enabled: true}
	ai := &AI{
		Providers: []*Provider{
			{Enabled: false, Models: []*Model{{ID: "disabled-provider-model", Name: "disabled", Enabled: true}}},
			{Enabled: true, Models: []*Model{{ID: "disabled-model", Name: "disabled"}}},
			{Enabled: true, Models: []*Model{first, second}},
		},
		Editing:         &Editing{ModelID: "missing"},
		Agent:           &Agent{ModelID: second.Name},
		Vision:          &Vision{ModelID: "missing"},
		ImageGeneration: &ImageGeneration{ModelID: second.DisplayName},
	}

	ai.ReconcileModelIDs()

	if ai.Editing.ModelID != first.ID {
		t.Fatalf("editing model ID = %q, want %q", ai.Editing.ModelID, first.ID)
	}
	if ai.Agent.ModelID != second.ID {
		t.Fatalf("agent model ID = %q, want %q", ai.Agent.ModelID, second.ID)
	}
	if ai.Vision.ModelID != "" {
		t.Fatalf("vision model ID = %q, want empty", ai.Vision.ModelID)
	}
	if ai.ImageGeneration.ModelID != second.ID {
		t.Fatalf("image generation model ID = %q, want %q", ai.ImageGeneration.ModelID, second.ID)
	}
}
