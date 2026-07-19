// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package plugin

import (
	"testing"

	"github.com/dop251/goja"
	"github.com/dop251/goja_nodejs/eventloop"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestRegisterMcpToolOptionalReadOnly(t *testing.T) {
	p := &KernelPlugin{Petal: &model.Petal{Name: "test-plugin-optional-read-only"}}
	loop := eventloop.NewEventLoop()
	p.worker.Start(loop)
	t.Cleanup(p.Clear)

	var scriptErr error
	loop.Run(func(rt *goja.Runtime) {
		siyuan := rt.NewObject()
		if err := injectMcp(p, rt, siyuan); err != nil {
			scriptErr = err
			return
		}
		if err := rt.Set("siyuan", siyuan); err != nil {
			scriptErr = err
			return
		}
		_, scriptErr = rt.RunString(`
			siyuan.mcp.registerTool("default", {
				description: "Default mutability",
				inputSchema: {type: "object"}
			}, (input) => input);
			siyuan.mcp.registerTool("read-only", {
				description: "Read-only tool",
				inputSchema: {type: "object"},
				readOnly: true
			}, (input) => input);
		`)
	})
	if scriptErr != nil {
		t.Fatalf("register MCP tools failed: %v", scriptErr)
	}

	defaultTool := tools.GetTool(pluginToolName(p.Name, "default"))
	if defaultTool == nil {
		t.Fatal("tool without readOnly was not registered")
	}
	if defaultTool.ReadOnlyHint {
		t.Fatal("tool without readOnly must default to writable")
	}

	readOnlyTool := tools.GetTool(pluginToolName(p.Name, "read-only"))
	if readOnlyTool == nil {
		t.Fatal("tool with readOnly was not registered")
	}
	if !readOnlyTool.ReadOnlyHint {
		t.Fatal("tool with readOnly=true must be marked read-only")
	}
}
