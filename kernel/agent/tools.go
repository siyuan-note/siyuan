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
// 返回值：结果文本（已展平为字符串），isErr 表示工具是否返回错误结果。
func executeTool(tc openai.ToolCall, sessionID string) (string, bool) {
	t := tools.GetTool(tc.Function.Name)
	if t == nil {
		return "unknown tool: " + tc.Function.Name, true
	}

	args := parseToolArgs(tc.Function.Arguments)
	args["_sessionID"] = sessionID
	result, err := t.Handler(args)
	if err != nil {
		return "tool execution error: " + err.Error(), true
	}

	return resultToString(result), result.IsError
}

func convertSchema(schema tools.ToolSchema) any {
	props := make(map[string]any)
	for name, prop := range schema.Properties {
		props[name] = convertProperty(prop)
	}

	schemaMap := map[string]any{
		"type":       schema.Type,
		"properties": props,
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
	p := map[string]any{
		"type": prop.Type,
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
	return p
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

func parseToolArgs(argsJSON string) map[string]interface{} {
	args := map[string]interface{}{}
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
