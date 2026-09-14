// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package api

import (
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"testing"
)

func TestResolveAIProviderDraft(t *testing.T) {
	provider, err := resolveAIProvider(apicontract.AIProviderRequest{
		ProviderConfig: &apicontract.SettingProvider{
			BaseURL:        " http://127.0.0.1:8080/v1 ",
			APIKey:         " key ",
			Headers:        map[string]string{"X-Api-Key": "header-key"},
			RequestTimeout: 700,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if provider.BaseURL != "http://127.0.0.1:8080/v1" {
		t.Fatalf("base URL = %q", provider.BaseURL)
	}
	if provider.APIKey != "key" {
		t.Fatalf("API key = %q", provider.APIKey)
	}
	if provider.Headers["X-Api-Key"] != "header-key" {
		t.Fatal("provider headers were not retained")
	}
	if provider.RequestTimeout != 600 {
		t.Fatalf("request timeout = %d, want 600", provider.RequestTimeout)
	}
	if provider.Protocol != "openai" || provider.ID == "" {
		t.Fatalf("draft provider was not normalized: %#v", provider)
	}
}

func TestResolveAIProviderDraftRequiresBaseURL(t *testing.T) {
	if _, err := resolveAIProvider(apicontract.AIProviderRequest{ProviderConfig: &apicontract.SettingProvider{}}); err == nil {
		t.Fatal("empty draft provider should be rejected")
	}
}
