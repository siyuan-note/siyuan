// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"context"
	"testing"
)

func TestMCPDiscoveryRequiresRequestContext(t *testing.T) {
	result, err := MCPTool.ContextHandler(context.Background(), map[string]any{"action": "list"})
	if err != nil || !result.IsError || !MCPTool.AgentOnly {
		t.Fatalf("discovery must be Agent-only and require request state: %#v, %v", result, err)
	}
	validator, err := CompileToolValidator(MCPTool)
	if err != nil {
		t.Fatal(err)
	}
	for _, args := range []map[string]any{{}, {"action": "invalid"}, {"action": "load", "server": 42}} {
		if err := validator.ValidateInput(args); err == nil {
			t.Fatalf("invalid input accepted: %v", args)
		}
	}
	if effects, ok := MCPTool.EffectsFor("load"); !ok || effects.LocalWrite || effects.DataEgress || effects.ExternalCost {
		t.Fatal("loading schemas should not execute external tools")
	}
}
