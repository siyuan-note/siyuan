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
	result := make([]openai.Tool, 0, len(tools.Registry))
	for _, t := range tools.Registry {
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

func convertSchema(schema tools.ToolSchema) any {
	props := make(map[string]any)
	for name, prop := range schema.Properties {
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
		props[name] = p
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

func executeTool(toolCall openai.ToolCall) string {
	t, ok := tools.Registry[toolCall.Function.Name]
	if !ok {
		return "unknown tool: " + toolCall.Function.Name
	}

	args := parseToolArgs(toolCall.Function.Arguments)
	result, err := t.Handler(args)
	if err != nil {
		return "tool execution error: " + err.Error()
	}

	return resultToString(result)
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
