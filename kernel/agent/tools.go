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

package agent

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
)

func convertMCPToolsToOpenAI() []openai.Tool {
	allTools := tools.GetAllTools()
	result := make([]openai.Tool, 0, len(allTools))
	for _, t := range allTools {
		result = append(result, openai.Tool{
			Type: openai.ToolTypeFunction,
			Function: &openai.FunctionDefinition{
				Name:        t.Name,
				Description: t.Description,
				Parameters:  convertSchema(t.InputSchema),
			},
		})
	}
	return result
}

// executeTool 执行单次工具调用。
// 返回值：结果文本（已展平为字符串），isErr 表示工具是否返回错误结果，executionUnknown 表示副作用结果无法确定。
func executeTool(ctx context.Context, tc openai.ToolCall, sessionID string) (resultText string, isErr, executionUnknown bool) {
	t := tools.GetTool(tc.Function.Name)
	if t == nil {
		return "unknown tool: " + tc.Function.Name, true, false
	}
	if t.ContextHandler == nil && t.Handler == nil {
		return "tool handler unavailable: " + tc.Function.Name, true, false
	}
	if ctx.Err() != nil {
		return "tool execution was cancelled before it started", true, false
	}

	args := parseToolArgs(tc.Function.Arguments)
	// _sessionID 和 _toolCallID 是原生工具专用的内部字段，用于关联会话状态和实现幂等操作。
	// 仅注入给原生工具；MCP/插件工具的参数会原样转发给外部服务端，
	// 严格校验（additionalProperties:false）的服务端（如 Flomo MCP）会因这个多余字段报错。
	// https://github.com/siyuan-note/siyuan/issues/17927
	if t.Source == "native" || t.Source == "" {
		args["_sessionID"] = sessionID
		args["_toolCallID"] = tc.ID
	}
	type executionResult struct {
		result tools.CallToolResult
		err    error
	}
	executionCh := make(chan executionResult, 1)
	go func() {
		var result tools.CallToolResult
		var err error
		if t.ContextHandler != nil {
			result, err = t.ContextHandler(ctx, args)
		} else {
			result, err = t.Handler(args)
		}
		executionCh <- executionResult{result: result, err: err}
	}()

	var execution executionResult
	select {
	case execution = <-executionCh:
	case <-ctx.Done():
		return "tool execution was interrupted; execution result is unknown and must not be retried automatically", true, true
	}
	result, err := execution.result, execution.err
	if err != nil {
		if ctx.Err() != nil {
			return "tool execution was interrupted; execution result is unknown and must not be retried automatically", true, true
		}
		return "tool execution error: " + err.Error(), true, false
	}

	return resultToString(result), result.IsError, result.ExecutionUnknown
}

func convertSchema(schema tools.ToolSchema) any {
	// 根级 anyOf 常见于 Zod 生成的 schema，取第一个 object 变体展开。
	if schema.Type == "" && len(schema.AnyOf) > 0 {
		for _, variant := range schema.AnyOf {
			if variant.Type == "object" || len(variant.Properties) > 0 {
				return convertSchema(variant)
			}
		}
	}

	props := make(map[string]any)
	for name, prop := range schema.Properties {
		props[name] = convertProperty(prop)
	}

	schemaType := schema.Type
	if schemaType == "" && len(props) > 0 {
		schemaType = "object"
	}

	schemaMap := map[string]any{
		"properties": props,
	}
	if schemaType != "" {
		schemaMap["type"] = schemaType
	}
	if len(schema.Required) > 0 {
		reqVals := make([]any, len(schema.Required))
		for i, v := range schema.Required {
			reqVals[i] = v
		}
		schemaMap["required"] = reqVals
	}
	return schemaMap
}

func convertProperty(prop tools.Property) map[string]any {
	// Zod 可选字段常生成 anyOf: [{type: T}, {type: null}]，简化为单一类型即可。
	if prop.Type == "" && len(prop.AnyOf) > 0 {
		if simplified := simplifyNullUnionProp(prop); simplified != nil {
			return simplified
		}
	}

	p := map[string]any{}
	if prop.Type != "" {
		p["type"] = prop.Type
	}
	if prop.Description != "" {
		p["description"] = prop.Description
	}
	if len(prop.Enum) > 0 {
		enumVals := make([]any, len(prop.Enum))
		for i, v := range prop.Enum {
			enumVals[i] = v
		}
		p["enum"] = enumVals
	}
	if prop.Items != nil {
		p["items"] = convertProperty(*prop.Items)
	}
	if len(prop.Properties) > 0 {
		nested := make(map[string]any)
		for k, v := range prop.Properties {
			nested[k] = convertProperty(v)
		}
		p["properties"] = nested
	}
	if len(prop.Required) > 0 {
		reqVals := make([]any, len(prop.Required))
		for i, v := range prop.Required {
			reqVals[i] = v
		}
		p["required"] = reqVals
	}
	if len(prop.AnyOf) > 0 {
		p["anyOf"] = convertPropArray(prop.AnyOf)
	}
	if len(prop.OneOf) > 0 {
		p["oneOf"] = convertPropArray(prop.OneOf)
	}
	if len(prop.AllOf) > 0 {
		p["allOf"] = convertPropArray(prop.AllOf)
	}
	return p
}

// simplifyNullUnionProp 将 anyOf: [T, null] 形式的 Zod 可选字段简化为 T。
func simplifyNullUnionProp(prop tools.Property) map[string]any {
	var candidate *tools.Property
	for i := range prop.AnyOf {
		p := &prop.AnyOf[i]
		if p.Type == "null" {
			continue
		}
		if len(p.OneOf) > 0 || len(p.AnyOf) > 0 || len(p.AllOf) > 0 {
			return nil
		}
		if candidate != nil {
			return nil
		}
		candidate = p
	}
	if candidate == nil {
		return nil
	}
	result := convertProperty(*candidate)
	if prop.Description != "" {
		if _, ok := result["description"]; !ok {
			result["description"] = prop.Description
		}
	}
	return result
}

func convertPropArray(props []tools.Property) []any {
	result := make([]any, len(props))
	for i, prop := range props {
		result[i] = convertProperty(prop)
	}
	return result
}

func resultToString(result tools.CallToolResult) string {
	var parts []string
	for _, item := range result.Content {
		if item.Type == "text" {
			parts = append(parts, item.Text)
		}
	}
	if len(parts) == 0 {
		return "(empty result)"
	}
	return strings.Join(parts, "\n")
}

func parseToolArgs(argsJSON string) map[string]any {
	args := map[string]any{}
	if argsJSON == "" {
		return args
	}

	dec := json.NewDecoder(strings.NewReader(argsJSON))
	dec.UseNumber()
	_ = dec.Decode(&args)

	for k, v := range args {
		if num, ok := v.(json.Number); ok {
			if f, err := num.Float64(); err == nil {
				args[k] = f
			}
		}
	}
	return args
}
