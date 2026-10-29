// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package plugin

import (
	"testing"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestRegisterAgentCapabilityEffects(t *testing.T) {
	p := &KernelPlugin{Petal: &model.Petal{Name: "test-agent-capability-effects"}}
	loop := eventloop.NewEventLoop()
	p.worker.Start(loop)
	t.Cleanup(p.Clear)

	var scriptErr error
	loop.Run(func(rt *goja.Runtime) {
		siyuan := rt.NewObject()
		if err := injectAgent(p, rt, siyuan); err != nil {
			scriptErr = err
			return
		}
		if err := rt.Set("siyuan", siyuan); err != nil {
			scriptErr = err
			return
		}
		_, scriptErr = rt.RunString(`
			siyuan.agent.registerCapability("default", {
				description: "Default effects",
				inputSchema: {type: "object"},
				effects: {localRead: true}
			}, (input) => input);
			siyuan.agent.registerCapability("actions", {
				description: "Action effects",
				inputSchema: {type: "object", properties: {action: {type: "string", enum: ["read", "write"]}}},
				actionEffects: {read: {localRead: true}, write: {localWrite: true}}
			}, (input) => input);
		`)
	})
	if scriptErr != nil {
		t.Fatalf("register Agent capabilities failed: %v", scriptErr)
	}

	defaultTool := tools.GetTool(pluginCapabilityModelName(p.Name, "default"))
	if defaultTool == nil {
		t.Fatal("capability with default effects was not registered")
	}
	if effects, ok := defaultTool.EffectsFor(""); !ok || !effects.LocalRead {
		t.Fatal("capability-level effects were not registered")
	}

	actionTool := tools.GetTool(pluginCapabilityModelName(p.Name, "actions"))
	if actionTool == nil {
		t.Fatal("capability with action effects was not registered")
	}
	if effects, ok := actionTool.EffectsFor("write"); !ok || !effects.LocalWrite {
		t.Fatal("action effects were not registered")
	}
}

func TestPluginCapabilityModelNameIsStableAndDistinct(t *testing.T) {
	first := pluginCapabilityModelName("example/plugin", "a/b")
	second := pluginCapabilityModelName("example_plugin", "a_b")
	if first == second {
		t.Fatalf("different plugin capabilities produced the same model name: %s", first)
	}
	if first != pluginCapabilityModelName("example/plugin", "a/b") {
		t.Fatal("plugin capability model name is not stable")
	}
	if len(first) > maxCapabilityModelNameLen || len(second) > maxCapabilityModelNameLen {
		t.Fatal("plugin capability model name exceeds the provider limit")
	}
}
