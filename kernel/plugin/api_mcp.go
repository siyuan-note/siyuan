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
	"encoding/json"
	"fmt"

	"github.com/dop251/goja"
	"github.com/samber/lo"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// pluginToolName builds the fully-qualified MCP tool name for a plugin-local tool name.
// Pattern: plugin__<sanitized-plugin>__<sanitized-tool>
func pluginToolName(pluginName, toolName string) string {
	return fmt.Sprintf("plugin__%s__%s", util.SanitizeName(pluginName), util.SanitizeName(toolName))
}

// injectMcp adds siyuan.mcp to the plugin JS sandbox.
func injectMcp(p *KernelPlugin, rt *goja.Runtime, siyuan *goja.Object) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("injectMcp: %v", r)
		}
	}()

	mcp := rt.NewObject()

	// siyuan.mcp.registerTool(name, config, handler) → Promise<IRegisteredTool>
	lo.Must0(mcp.Set("registerTool", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		var argErr error

		var name string
		var title string
		var description string
		var handler goja.Callable
		var inputSchema tools.ToolSchema

		if len(call.Arguments) < 3 {
			argErr = fmt.Errorf("registerTool requires 3 arguments: name, config, handler")
		} else {
			if s := call.Argument(0); goja.IsString(s) {
				name = s.String()
			} else {
				argErr = fmt.Errorf("first argument must be a tool name string")
			}

			if argErr == nil {
				if c := call.Argument(1); isJsValueNotNull(c) {
					configObj := c.ToObject(rt)
					if configObj != nil {
						if titleValue := configObj.Get("title"); goja.IsString(titleValue) {
							title = titleValue.String()
						}
						if descriptionValue := configObj.Get("description"); goja.IsString(descriptionValue) {
							description = descriptionValue.String()
						}
						if inputSchemaValue := configObj.Get("inputSchema"); isJsValueNotNull(inputSchemaValue) {
							schemaJson, marshalErr := inputSchemaValue.ToObject(rt).MarshalJSON()
							if marshalErr != nil {
								argErr = fmt.Errorf("failed to serialize inputSchema: %v", marshalErr)
							}
							if argErr == nil {
								unmarshalErr := json.Unmarshal(schemaJson, &inputSchema)
								if unmarshalErr != nil {
									argErr = fmt.Errorf("invalid inputSchema: %v", unmarshalErr)
								}
							}
						}
					}
				} else {
					argErr = fmt.Errorf("second argument must be a config object")
				}
			}

			if argErr == nil {
				if fn, ok := goja.AssertFunction(call.Argument(2)); ok {
					handler = fn
				} else {
					argErr = fmt.Errorf("third argument must be a handler function")
				}
			}
		}

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			if argErr != nil {
				err = argErr
				return
			}

			fullToolName := pluginToolName(p.Name, name)

			tool := &tools.Tool{
				Name:        fullToolName,
				Title:       title,
				Description: description,
				InputSchema: inputSchema,
				Handler: func(args map[string]interface{}) (tools.CallToolResult, error) {
					return p.invokeMcpTool(handler, args)
				},
			}

			p.registerMcpTool(name, tool)

			result = map[string]any{
				"name":        fullToolName,
				"title":       title,
				"description": description,
				"inputSchema": inputSchema,
			}
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.mcp.registerTool resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.mcp.registerTool reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.mcp.registerTool worker run: %v", p.Name, runErr)
			if rejectErr := reject(rt.NewGoError(runErr)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] siyuan.mcp.registerTool reject on run error: %v", p.Name, rejectErr)
			}
		}

		return rt.ToValue(promise)
	})))

	// siyuan.mcp.unregisterTool(name) → Promise<void>
	lo.Must0(mcp.Set("unregisterTool", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		var argErr error
		var toolName string

		if len(call.Arguments) < 1 {
			argErr = fmt.Errorf("unregisterTool requires 1 argument: name")
		} else if s := call.Argument(0); goja.IsString(s) {
			toolName = s.String()
		} else {
			argErr = fmt.Errorf("first argument must be a tool name string")
		}

		if argErr != nil {
			_ = reject(rt.NewGoError(argErr))
			return rt.ToValue(promise)
		}

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			p.unregisterMcpTool(toolName)
			return
		}, func(workerRT *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.mcp.unregisterTool resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(workerRT.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.mcp.unregisterTool reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.mcp.unregisterTool worker run: %v", p.Name, runErr)
			if rejectErr := reject(rt.NewGoError(runErr)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] siyuan.mcp.unregisterTool reject on run error: %v", p.Name, rejectErr)
			}
		}

		return rt.ToValue(promise)
	})))

	lo.Must0(ObjectFreeze(rt, mcp))
	lo.Must0(siyuan.Set("mcp", mcp))
	return
}
