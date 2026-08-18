// SiYuan - From thought to insight, with agents
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
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/dop251/goja"
	"github.com/samber/lo"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// pluginCapabilityModelName 构造内核插件能力向模型暴露的函数名。
func pluginCapabilityModelName(pluginName, capabilityName string) string {
	name := fmt.Sprintf("plugin__%s__%s", util.SanitizeName(pluginName), util.SanitizeName(capabilityName))
	hash := sha256.Sum256([]byte(pluginName + "\x00" + capabilityName))
	suffix := fmt.Sprintf("__%x", hash[:6])
	if len(name) > maxCapabilityModelNameLen-len(suffix) {
		name = name[:maxCapabilityModelNameLen-len(suffix)]
	}
	return name + suffix
}

const maxCapabilityModelNameLen = 64

// injectAgent 将 siyuan.agent 注入插件 JS 沙箱。
func injectAgent(p *KernelPlugin, rt *goja.Runtime, siyuan *goja.Object) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("injectAgent: %v", r)
		}
	}()

	agentAPI := rt.NewObject()

	// siyuan.agent.registerCapability(name, config, handler) 返回 Promise<IRegisteredCapability>。
	lo.Must0(agentAPI.Set("registerCapability", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		var name string
		var title string
		var description string
		var effects *tools.ToolEffects
		var actionEffects map[string]tools.ToolEffects
		var inputSchema *tools.ToolSchema
		var outputSchema *tools.ToolSchema
		var handler goja.Callable

		argErr := func() (err error) {
			if len(call.Arguments) < 3 {
				err = fmt.Errorf("registerCapability requires 3 arguments: name, config, handler")
				return
			} else {
				if s := call.Argument(0); goja.IsString(s) {
					name = strings.TrimSpace(s.String())
					if name == "" {
						err = fmt.Errorf("capability name must not be empty")
						return
					}
				} else {
					err = fmt.Errorf("first argument must be a tool name string")
					return
				}

				if c := call.Argument(1); isJsValueNotNull(c) {
					configObj := c.ToObject(rt)
					if configObj != nil {
						if titleValue := configObj.Get("title"); goja.IsString(titleValue) {
							title = titleValue.String()
						}
						if descriptionValue := configObj.Get("description"); goja.IsString(descriptionValue) {
							description = strings.TrimSpace(descriptionValue.String())
							if description == "" {
								err = fmt.Errorf("config.description must not be empty")
								return
							}
						} else {
							err = fmt.Errorf("config.description is required and must be a string")
							return
						}
						if inputSchemaValue := configObj.Get("inputSchema"); isJsValueNotNull(inputSchemaValue) {
							if inputSchema, err = jsCapabilitySchemaToGoSchema(rt, inputSchemaValue); err != nil {
								return
							}
						} else {
							err = fmt.Errorf("config.inputSchema is required")
							return
						}
						if outputSchemaValue := configObj.Get("outputSchema"); isJsValueNotNull(outputSchemaValue) {
							if outputSchema, err = jsCapabilitySchemaToGoSchema(rt, outputSchemaValue); err != nil {
								return
							}
						}
						if effectsValue := configObj.Get("effects"); isJsValueNotNull(effectsValue) {
							if effects, err = jsCapabilityEffectsToGoEffects(rt, effectsValue); err != nil {
								return
							}
						}
						if actionEffectsValue := configObj.Get("actionEffects"); isJsValueNotNull(actionEffectsValue) {
							if actionEffects, err = jsCapabilityActionEffectsToGoEffects(rt, actionEffectsValue); err != nil {
								return
							}
						}
					}
				} else {
					err = fmt.Errorf("second argument must be a config object")
					return
				}
				if fn, ok := goja.AssertFunction(call.Argument(2)); ok {
					handler = fn
				} else {
					err = fmt.Errorf("third argument must be a handler function")
					return
				}
				return
			}
		}()

		runErr := p.worker.Run(func(rt *goja.Runtime) (result any, err error) {
			if argErr != nil {
				err = argErr
				return
			}

			fullToolName := pluginCapabilityModelName(p.Name, name)
			declaredActionEffects := make(map[string]tools.ToolEffects, len(actionEffects)+1)
			for action, actionEffect := range actionEffects {
				declaredActionEffects[action] = actionEffect
			}
			if effects != nil {
				declaredActionEffects[""] = *effects
			}
			if len(declaredActionEffects) == 0 {
				declaredActionEffects = nil
			}

			tool := &tools.Tool{
				Name:          fullToolName,
				Title:         title,
				Description:   description,
				InputSchema:   *inputSchema,
				OutputSchema:  outputSchema,
				CapabilityID:  tools.BuildCapabilityID("plugin", "backend", p.Name, name),
				Source:        "plugin",
				OwnerID:       p.Name,
				OwnerName:     p.Name,
				Runtime:       "plugin-worker",
				EffectScope:   tools.EffectScopeUnknown,
				ActionEffects: declaredActionEffects,
				Handler: func(args map[string]any) (tools.CallToolResult, error) {
					return p.invokeAgentCapability(handler, args)
				},
			}

			if err = p.registerAgentCapability(name, tool); err != nil {
				return
			}

			result = map[string]any{
				"id":            tool.CapabilityID,
				"name":          fullToolName,
				"title":         title,
				"description":   description,
				"effects":       effects,
				"actionEffects": actionEffects,
				"inputSchema":   inputSchema,
				"outputSchema":  outputSchema,
			}
			return
		}, func(rt *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.agent.registerCapability resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(rt.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.agent.registerCapability reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.agent.registerCapability worker run: %v", p.Name, runErr)
			if rejectErr := reject(rt.NewGoError(runErr)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] siyuan.agent.registerCapability reject on run error: %v", p.Name, rejectErr)
			}
		}

		return rt.ToValue(promise)
	})))

	// siyuan.agent.unregisterCapability(name) 返回 Promise<void>。
	lo.Must0(agentAPI.Set("unregisterCapability", rt.ToValue(func(call goja.FunctionCall, rt *goja.Runtime) goja.Value {
		promise, resolve, reject := rt.NewPromise()

		var argErr error
		var toolName string

		if len(call.Arguments) < 1 {
			argErr = fmt.Errorf("unregisterCapability requires 1 argument: name")
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
			p.unregisterAgentCapability(toolName)
			return
		}, func(workerRT *goja.Runtime, result any, err error) {
			if lo.IsNil(err) {
				if resolveErr := resolve(result); resolveErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.agent.unregisterCapability resolve: %v", p.Name, resolveErr)
				}
			} else {
				if rejectErr := reject(workerRT.NewGoError(err)); rejectErr != nil {
					logging.LogErrorf("[plugin:%s] siyuan.agent.unregisterCapability reject: %v", p.Name, rejectErr)
				}
			}
		})
		if runErr != nil {
			logging.LogErrorf("[plugin:%s] siyuan.agent.unregisterCapability worker run: %v", p.Name, runErr)
			if rejectErr := reject(rt.NewGoError(runErr)); rejectErr != nil {
				logging.LogErrorf("[plugin:%s] siyuan.agent.unregisterCapability reject on run error: %v", p.Name, rejectErr)
			}
		}

		return rt.ToValue(promise)
	})))

	lo.Must0(ObjectFreeze(rt, agentAPI))
	lo.Must0(siyuan.Set("agent", agentAPI))
	return
}

// jsCapabilitySchemaToGoSchema 将 JavaScript 能力 Schema 转换为 Go ToolSchema。
func jsCapabilitySchemaToGoSchema(rt *goja.Runtime, value goja.Value) (toolSchema *tools.ToolSchema, err error) {
	schemaJson, marshalErr := value.ToObject(rt).MarshalJSON()
	if marshalErr != nil {
		err = fmt.Errorf("failed to serialize inputSchema: %v", marshalErr)
		return
	}

	schema := &tools.ToolSchema{}
	unmarshalErr := json.Unmarshal(schemaJson, schema)
	if unmarshalErr != nil {
		err = fmt.Errorf("invalid json schema: %v", unmarshalErr)
		return
	}

	toolSchema = schema
	return
}

func jsCapabilityEffectsToGoEffects(rt *goja.Runtime, value goja.Value) (*tools.ToolEffects, error) {
	effects := &tools.ToolEffects{}
	if err := unmarshalCapabilityJSON(rt, value, effects, "effects"); err != nil {
		return nil, err
	}
	return effects, nil
}

func jsCapabilityActionEffectsToGoEffects(rt *goja.Runtime, value goja.Value) (map[string]tools.ToolEffects, error) {
	actionEffects := map[string]tools.ToolEffects{}
	if err := unmarshalCapabilityJSON(rt, value, &actionEffects, "actionEffects"); err != nil {
		return nil, err
	}
	for action := range actionEffects {
		if strings.TrimSpace(action) == "" {
			return nil, fmt.Errorf("config.actionEffects contains an empty action")
		}
	}
	return actionEffects, nil
}

func unmarshalCapabilityJSON(rt *goja.Runtime, value goja.Value, target any, field string) error {
	jsonValue, err := value.ToObject(rt).MarshalJSON()
	if err != nil {
		return fmt.Errorf("failed to serialize config.%s: %v", field, err)
	}
	if err = json.Unmarshal(jsonValue, target); err != nil {
		return fmt.Errorf("invalid config.%s: %v", field, err)
	}
	return nil
}
