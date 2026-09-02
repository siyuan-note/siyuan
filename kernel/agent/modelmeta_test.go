// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package agent

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestResolveModelContextLimit(t *testing.T) {
	if got := ResolveModelContextLimit("", "kimi-k3", 32768); got != 32768 {
		t.Fatalf("configured context limit = %d, want 32768", got)
	}
	if got := ResolveModelContextLimit("", "moonshotai/kimi-k3", 0); got != 1048576 {
		t.Fatalf("built-in context limit = %d, want 1048576", got)
	}
	if got := ResolveModelContextLimit("", "unknown-model", 0); got != 0 {
		t.Fatalf("unknown context limit = %d, want 0", got)
	}
	fallbacks := map[string]int{
		"deepseek-v4-flash-0731":       1310720,
		"deepseek-v4-flash-0731:batch": 1048576,
		"deepseek-v4-flash-vision-exp": 1048576,
		"deepseek-v4-pro-0813":         1048576,
		"deepseek-v4-pro-0813:batch":   1048576,
		"deepseek-v4-flash-latest":     1310720,
	}
	for name, want := range fallbacks {
		if got := ResolveModelContextLimit("", name, 0); got != want {
			t.Errorf("built-in context limit for %s = %d, want %d", name, got, want)
		}
	}
}

func TestResolveModelContextLimitPrefersModelsDev(t *testing.T) {
	resetModelsDevStateForTest()
	t.Cleanup(resetModelsDevStateForTest)

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
  "openrouter": {
    "api": "https://openrouter.ai/api/v1/",
    "models": {
      "deepseek/deepseek-v4-flash": {"limit": {"context": 999999}},
      "~deepseek/deepseek-v4-flash-latest": {"limit": {"context": 123456}},
      "vendor-a/ambiguous-model": {"limit": {"context": 100000}},
      "vendor-b/ambiguous-model": {"limit": {"context": 200000}}
    }
  },
  "openai": {
    "models": {
      "gpt-5": {"limit": {"context": 888888}}
    }
  }
}`))
	}))
	defer server.Close()
	modelsDevEndpoint = server.URL

	if err := refreshModelsDevContextCatalog(context.Background()); err != nil {
		t.Fatalf("refresh models.dev catalog failed: %s", err)
	}
	if got := ResolveModelContextLimit("https://openrouter.ai/api/v1", "deepseek/deepseek-v4-flash", 32768); got != 32768 {
		t.Fatalf("configured context limit = %d, want 32768", got)
	}
	if got := ResolveModelContextLimit("https://openrouter.ai/api/v1", "deepseek/deepseek-v4-flash", 0); got != 999999 {
		t.Fatalf("models.dev exact context limit = %d, want 999999", got)
	}
	if got := ResolveModelContextLimit("https://openrouter.ai/api/v1/", "deepseek-v4-flash-latest", 0); got != 123456 {
		t.Fatalf("models.dev suffix context limit = %d, want 123456", got)
	}
	if got := ResolveModelContextLimit("https://api.openai.com/v1", "gpt-5", 0); got != 888888 {
		t.Fatalf("models.dev API alias context limit = %d, want 888888", got)
	}
	if got := ResolveModelContextLimit("https://proxy.example.com/v1", "gpt-5", 0); got != 888888 {
		t.Fatalf("models.dev global context limit = %d, want 888888", got)
	}
	if got := ResolveModelContextLimit("https://openrouter.ai/api/v1", "ambiguous-model", 0); got != 0 {
		t.Fatalf("ambiguous models.dev suffix context limit = %d, want 0", got)
	}
	if got := ResolveModelContextLimit("https://proxy.example.com/v1", "kimi-k3", 0); got != 1048576 {
		t.Fatalf("built-in fallback context limit = %d, want 1048576", got)
	}
	if got := ResolveModelContextLimit("https://openrouter.ai/api/v1", "deepseek-v4-flash-0731:batch", 0); got != 1048576 {
		t.Fatalf("missing models.dev model fallback context limit = %d, want 1048576", got)
	}
}

func TestRefreshModelsDevContextCatalogKeepsLastGoodSnapshot(t *testing.T) {
	resetModelsDevStateForTest()
	t.Cleanup(resetModelsDevStateForTest)
	var fail atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if fail.Load() {
			writer.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_, _ = writer.Write([]byte(`{
  "provider": {
    "api": "https://provider.example.com/v1",
    "models": {"online-model": {"limit": {"context": 65536}}}
  }
}`))
	}))
	defer server.Close()
	modelsDevEndpoint = server.URL

	if err := refreshModelsDevContextCatalog(context.Background()); err != nil {
		t.Fatalf("initial refresh failed: %s", err)
	}
	fail.Store(true)
	if err := refreshModelsDevContextCatalog(context.Background()); err == nil {
		t.Fatal("failed refresh returned nil error")
	}
	if got := ResolveModelContextLimit("https://provider.example.com/v1", "online-model", 0); got != 65536 {
		t.Fatalf("last good context limit = %d, want 65536", got)
	}
}

func resetModelsDevStateForTest() {
	modelsDevState.Lock()
	modelsDevState.catalog = nil
	modelsDevState.expiresAt = time.Time{}
	modelsDevState.retryAt = time.Time{}
	modelsDevState.refreshing = false
	modelsDevState.Unlock()
	modelsDevEndpoint = modelsDevCatalogURL
	modelsDevNow = time.Now
}
