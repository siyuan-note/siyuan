// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package conf

import "testing"

func TestAINormalizeAgentTimeoutsAndRetries(t *testing.T) {
	tests := []struct {
		name           string
		agent          *Agent
		wantSession    int
		wantStreamIdle int
		wantMaxRetries int
	}{
		{name: "defaults", agent: nil, wantSession: 600, wantStreamIdle: 120, wantMaxRetries: 3},
		{name: "zero means unlimited session and no retries", agent: &Agent{}, wantSession: 0, wantStreamIdle: 120, wantMaxRetries: 0},
		{name: "clamps upper bounds", agent: &Agent{SessionTimeout: 7200, StreamIdleTimeout: 900, MaxRetries: 20}, wantSession: 3600, wantStreamIdle: 600, wantMaxRetries: 10},
		{name: "normalizes negative values", agent: &Agent{SessionTimeout: -1, StreamIdleTimeout: -1, MaxRetries: -1}, wantSession: 0, wantStreamIdle: 120, wantMaxRetries: 0},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ai := &AI{Agent: test.agent}
			ai.Normalize()
			if ai.Agent.SessionTimeout != test.wantSession {
				t.Errorf("session timeout = %d, want %d", ai.Agent.SessionTimeout, test.wantSession)
			}
			if ai.Agent.StreamIdleTimeout != test.wantStreamIdle {
				t.Errorf("stream idle timeout = %d, want %d", ai.Agent.StreamIdleTimeout, test.wantStreamIdle)
			}
			if ai.Agent.MaxRetries != test.wantMaxRetries {
				t.Errorf("max retries = %d, want %d", ai.Agent.MaxRetries, test.wantMaxRetries)
			}
		})
	}
}

func TestNewAIReadsAgentStreamIdleTimeoutFromEnvironment(t *testing.T) {
	t.Setenv("SIYUAN_OPENAI_AGENT_STREAM_IDLE_TIMEOUT", "240")
	if got := NewAI().Agent.StreamIdleTimeout; got != 240 {
		t.Fatalf("stream idle timeout = %d, want 240", got)
	}
}

func TestAINormalizeProviderRequestTimeout(t *testing.T) {
	ai := &AI{Providers: []*Provider{{RequestTimeout: 0}, {RequestTimeout: 30}, {RequestTimeout: 601}}}
	ai.Normalize()
	want := []int{120, 30, 600}
	for i, provider := range ai.Providers {
		if provider.RequestTimeout != want[i] {
			t.Errorf("provider %d request timeout = %d, want %d", i, provider.RequestTimeout, want[i])
		}
	}
}

func TestNewAIDefaultProviderRequestTimeout(t *testing.T) {
	t.Setenv("SIYUAN_OPENAI_API_KEY", "test")
	t.Setenv("SIYUAN_OPENAI_API_MODEL", "test-model")
	t.Setenv("SIYUAN_OPENAI_API_BASE_URL", "https://example.com/v1")
	ai := NewAI()
	if len(ai.Providers) != 1 || ai.Providers[0].RequestTimeout != 120 {
		t.Fatalf("unexpected default provider request timeout: %#v", ai.Providers)
	}
}
