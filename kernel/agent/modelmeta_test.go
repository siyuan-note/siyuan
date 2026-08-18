// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package agent

import "testing"

func TestResolveModelContextLimit(t *testing.T) {
	if got := ResolveModelContextLimit("kimi-k3", 32768); got != 32768 {
		t.Fatalf("configured context limit = %d, want 32768", got)
	}
	if got := ResolveModelContextLimit("moonshotai/kimi-k3", 0); got != 1048576 {
		t.Fatalf("built-in context limit = %d, want 1048576", got)
	}
	if got := ResolveModelContextLimit("unknown-model", 0); got != 0 {
		t.Fatalf("unknown context limit = %d, want 0", got)
	}
}
