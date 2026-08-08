// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package util

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestListAvailableModelsWithContext(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		if authorization := r.Header.Get("Authorization"); authorization != "Bearer test-key" {
			t.Fatalf("authorization = %q", authorization)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"data":[
			{"id":"context","context_length":1048576},
			{"id":"max-context","max_context_length":262144},
			{"id":"max-input","max_input_tokens":131072},
			{"id":"fallback","context_length":"invalid","max_input_tokens":65536},
			{"id":"invalid-float","context_length":8192.5},
			{"id":"invalid-negative","context_length":-1},
			{"id":"invalid-large","context_length":100000001},
			{"id":"unknown"},
			{"id":"","context_length":4096}
		]}`)
	}))
	defer server.Close()

	models, err := ListAvailableModelsWithContext("test-key", server.URL+"/v1", 5)
	if err != nil {
		t.Fatal(err)
	}
	expected := []AvailableModel{
		{ID: "context", ContextLength: 1048576},
		{ID: "max-context", ContextLength: 262144},
		{ID: "max-input", ContextLength: 131072},
		{ID: "fallback", ContextLength: 65536},
		{ID: "invalid-float"},
		{ID: "invalid-negative"},
		{ID: "invalid-large"},
		{ID: "unknown"},
	}
	if len(models) != len(expected) {
		t.Fatalf("model count = %d, want %d: %#v", len(models), len(expected), models)
	}
	for i, want := range expected {
		if got := models[i]; got != want {
			t.Fatalf("model %d = %#v, want %#v", i, got, want)
		}
	}
}

func TestListAvailableModelsCompatibility(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"data":[{"id":"first","context_length":8192},{"id":"second"}]}`)
	}))
	defer server.Close()

	models, err := ListAvailableModels("", server.URL, 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 2 || models[0] != "first" || models[1] != "second" {
		t.Fatalf("models = %#v", models)
	}
}
