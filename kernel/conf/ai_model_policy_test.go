// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import (
	"errors"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAIModelPolicyPreservesWorkspaceProviders(t *testing.T) {
	workspace := NewAI()
	previous := &Provider{ID: "previous", Enabled: true, BaseURL: "https://other.example", APIKey: "other-key",
		Models: []*Model{{ID: "previous-model", Name: "other", Enabled: true}}}
	workspace.Providers = append(workspace.Providers, previous)
	workspace.Agent.ModelID = previous.Models[0].ID
	workspace.Embedding.Enabled = true
	workspace.Embedding.APIKey = "embedding-key"
	workspace.Web.APIKey = "web-key"

	view := workspace.EffectiveAI(util.AIModelsDeepSeek)
	if view.HasAnyProvider() || len(view.Providers) != 1 || view.Embedding.Enabled || view.Web.APIKey != "" {
		t.Fatal("restricted configuration exposed existing providers or credentials")
	}
	if provider, _ := view.GetModel("previous-model"); provider != nil {
		t.Fatal("restricted configuration resolved an existing model")
	}
	view.Providers[0].APIKey = " preview-key "
	updated, err := workspace.WithDistributionDeepSeekKey(view)
	if err != nil {
		t.Fatal(err)
	}
	restricted := updated.EffectiveAI(util.AIModelsDeepSeek)
	for _, lookup := range []func() (*Provider, *Model){restricted.GetAgentModel, restricted.GetEditingModel} {
		provider, model := lookup()
		if provider == nil || model == nil || provider.APIKey != "preview-key" ||
			provider.BaseURL != util.DeepSeekBaseURL || model.Name != util.DeepSeekModel {
			t.Fatal("expected available official DeepSeek text model")
		}
	}
	if updated.Agent.ModelID != previous.Models[0].ID || updated.Providers[0] != previous || !updated.Embedding.Enabled ||
		len(workspace.Providers) != 1 {
		t.Fatal("saving DeepSeek changed the existing workspace configuration")
	}
	if updated.EffectiveAI(util.AIModelsFull) != updated || updated.EffectiveAI(util.AIModelsUnavailable).HasAnyProvider() {
		t.Fatal("unexpected configuration when changing distribution policy")
	}
	restricted.Providers[0].BaseURL = "https://elsewhere.example"
	if _, err = updated.WithDistributionDeepSeekKey(restricted); !errors.Is(err, util.ErrAIModelPolicy) {
		t.Fatalf("custom endpoint accepted: %v", err)
	}
}
