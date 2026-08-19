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

package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"maps"
	"strings"

	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	kernelModel "github.com/siyuan-note/siyuan/kernel/model"
)

type executedToolResult struct {
	Text             string
	ModelAttachments []tools.ModelAttachment
	IsError          bool
	ExecutionUnknown bool
}

// validateToolCallInput 在确认和快照之前校验工具调用，避免无效调用被误判为写操作。
func validateToolCallInput(ctx context.Context, toolName string, args map[string]any) (*tools.Tool, *tools.ToolValidator, error) {
	t, validator := tools.LookupToolWithValidator(toolName)
	if t == nil {
		return nil, nil, fmt.Errorf("unknown tool: %s", toolName)
	}
	if t.ContextHandler == nil && t.Handler == nil {
		return nil, nil, fmt.Errorf("tool handler unavailable: %s", toolName)
	}
	if ctx.Err() != nil {
		return nil, nil, fmt.Errorf("tool execution was cancelled before it started")
	}
	if err := validator.ValidateInputContext(ctx, args); err != nil {
		return nil, nil, fmt.Errorf("invalid tool arguments: %w", err)
	}
	return t, validator, nil
}

func validateCapabilityCall(ctx context.Context, registration *capabilityRegistration, args map[string]any) error {
	if registration == nil {
		return fmt.Errorf("capability was not exposed in this model round")
	}
	if !capabilityStillExecutable(registration, args) {
		return fmt.Errorf("capability is disabled or no longer available: %s", registration.ID)
	}
	if ctx.Err() != nil {
		return fmt.Errorf("capability execution was cancelled before it started")
	}
	if registration.Validator == nil {
		return fmt.Errorf("capability validator unavailable: %s", registration.ID)
	}
	if err := registration.Validator.ValidateInputContext(ctx, args); err != nil {
		return fmt.Errorf("invalid capability arguments: %w", err)
	}
	if !registration.isBrowser() &&
		(registration.Tool == nil || registration.Tool.ContextHandler == nil && registration.Tool.Handler == nil) {
		return fmt.Errorf("capability handler unavailable: %s", registration.ID)
	}
	return nil
}

// executeTool 执行单次工具调用。
func executeTool(ctx context.Context, tc openai.ToolCall, sessionID string) executedToolResult {
	tool, validator := tools.LookupToolWithValidator(tc.Function.Name)
	if tool == nil {
		return executedToolResult{Text: "unknown tool: " + tc.Function.Name, IsError: true}
	}
	return executeCapability(ctx, tc, sessionID, &capabilityRegistration{
		ID:        tools.CapabilityIDForTool(tool),
		ModelName: tool.Name,
		Source:    tool.Source,
		Runtime:   tool.Runtime,
		Tool:      tool,
		Validator: validator,
	})
}

func executeCapability(ctx context.Context, tc openai.ToolCall, sessionID string,
	registration *capabilityRegistration) executedToolResult {
	args, err := parseCapabilityArgs(tc.Function.Arguments, registration.InputSchema)
	if err != nil {
		return executedToolResult{Text: "invalid capability arguments: " + err.Error(), IsError: true}
	}
	if err := validateCapabilityCall(ctx, registration, args); err != nil {
		return executedToolResult{Text: err.Error(), IsError: true}
	}
	t := registration.Tool
	validator := registration.Validator
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
	executionLifetimeDone := make(chan struct{})
	defer close(executionLifetimeDone)
	go func() {
		var result tools.CallToolResult
		var err error
		releaseBoxLeases := func() {}
		if t.BoxLeaseResolver != nil {
			releaseBoxLeases, err = kernelModel.AcquireEncryptedBoxOperations(ctx, t.BoxLeaseResolver(args))
			if err != nil {
				executionCh <- executionResult{
					result: tools.CallToolResult{
						Content: []tools.ContentItem{{Type: "text", Text: "encrypted notebook is locked, please unlock it first"}},
						IsError: true,
					},
				}
				return
			}
		}
		defer releaseBoxLeases()
		if t.ContextHandler != nil {
			result, err = t.ContextHandler(ctx, args)
		} else {
			result, err = t.Handler(args)
		}
		executionCh <- executionResult{result: result, err: err}
		<-executionLifetimeDone
	}()

	var execution executionResult
	select {
	case execution = <-executionCh:
	case <-ctx.Done():
		return executedToolResult{
			Text:             "tool execution was interrupted; execution result is unknown and must not be retried automatically",
			IsError:          true,
			ExecutionUnknown: true,
		}
	}
	result, err := execution.result, execution.err
	if err != nil {
		if ctx.Err() != nil {
			return executedToolResult{
				Text:             "tool execution was interrupted; execution result is unknown and must not be retried automatically",
				IsError:          true,
				ExecutionUnknown: true,
			}
		}
		return executedToolResult{Text: "tool execution error: " + err.Error(), IsError: true}
	}
	if err = validator.ValidateOutputContext(ctx, result); err != nil {
		return executedToolResult{
			Text: "invalid tool output after execution; execution result may have side effects and must not be retried automatically: " +
				err.Error(),
			IsError:          true,
			ExecutionUnknown: true,
		}
	}

	return executedToolResult{
		Text:             resultToString(result),
		ModelAttachments: result.ModelAttachments,
		IsError:          result.IsError,
		ExecutionUnknown: result.ExecutionUnknown,
	}
}

func convertSchema(schema tools.ToolSchema) any {
	if schema.Raw != nil {
		return maps.Clone(schema.Raw)
	}

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
			continue
		}
		if data, err := json.Marshal(item); err == nil {
			parts = append(parts, string(data))
		}
	}
	if joined := strings.Join(parts, "\n"); joined != "" {
		return joined
	}
	if result.HasStructuredContent() {
		if data, err := json.Marshal(result.StructuredContent); err == nil {
			return string(data)
		}
	}
	return "(empty result)"
}

// parseCapabilityArgs 根据能力 schema 解析并规范化模型返回的参数。
func parseCapabilityArgs(argsJSON string, schema tools.ToolSchema) (map[string]any, error) {
	if strings.TrimSpace(argsJSON) == "" {
		return map[string]any{}, nil
	}

	schemaMap, _ := convertSchema(schema).(map[string]any)
	args, err := decodeCapabilityArgsObject(argsJSON, schemaMap)
	if err != nil {
		return map[string]any{}, err
	}

	// 部分兼容接口会把完整参数对象放入唯一的 arguments 字段中。
	// 仅当 schema 本身没有该字段时解包，避免改变合法工具的参数语义。
	if len(args) == 1 && !schemaDefinesProperty(schemaMap, "arguments") {
		if wrapped, ok := args["arguments"]; ok {
			switch value := wrapped.(type) {
			case map[string]any:
				args = value
			case string:
				decoded, decodeErr := decodeCapabilityArgsObject(unwrapStructuredString(value), schemaMap)
				if decodeErr != nil {
					return map[string]any{}, fmt.Errorf("wrapped tool arguments are invalid: %w", decodeErr)
				}
				args = decoded
			default:
				return map[string]any{}, fmt.Errorf("wrapped tool arguments must be a JSON object or object string")
			}
		}
	}

	normalized := normalizeCapabilityValue(args, schemaMap)
	if normalizedArgs, ok := normalized.(map[string]any); ok {
		return normalizedArgs, nil
	}
	return args, nil
}

func decodeCapabilityArgsObject(raw string, schema map[string]any) (map[string]any, error) {
	var args map[string]any
	if err := json.Unmarshal([]byte(raw), &args); err == nil && args != nil {
		return args, nil
	}

	repaired := repairMissingArrayObjectOpeners(raw, schema)
	if repaired != raw {
		if err := json.Unmarshal([]byte(repaired), &args); err == nil && args != nil {
			return args, nil
		}
	}

	if err := json.Unmarshal([]byte(raw), &args); err != nil {
		return nil, fmt.Errorf("tool arguments are not valid JSON: %w", err)
	}
	return nil, fmt.Errorf("tool arguments must be a JSON object")
}

func schemaDefinesProperty(schema map[string]any, name string) bool {
	properties, _ := schema["properties"].(map[string]any)
	_, ok := properties[name]
	return ok
}

func normalizeCapabilityValue(value any, schema map[string]any) any {
	if text, ok := value.(string); ok && schemaType(schema) != "string" {
		if decoded, matched := decodeStructuredSchemaValue(text, schema); matched {
			value = decoded
		}
	}

	switch typed := value.(type) {
	case map[string]any:
		properties, _ := schema["properties"].(map[string]any)
		for name, child := range typed {
			childSchema, _ := properties[name].(map[string]any)
			if childSchema != nil {
				typed[name] = normalizeCapabilityValue(child, childSchema)
			}
		}
	case []any:
		itemSchema, _ := schema["items"].(map[string]any)
		if itemSchema != nil {
			for i := range typed {
				typed[i] = normalizeCapabilityValue(typed[i], itemSchema)
			}
		}
	}
	return value
}

func decodeStructuredSchemaValue(value string, schema map[string]any) (any, bool) {
	for _, candidate := range []string{unwrapStructuredString(value), html.UnescapeString(unwrapStructuredString(value))} {
		var decoded any
		if json.Unmarshal([]byte(candidate), &decoded) == nil && capabilityValueMatchesSchema(decoded, schema) {
			return normalizeCapabilityValue(decoded, schema), true
		}
	}
	return nil, false
}

func unwrapStructuredString(value string) string {
	trimmed := strings.TrimSpace(value)
	if strings.HasPrefix(trimmed, "<![CDATA[") && strings.HasSuffix(trimmed, "]]>") {
		return strings.TrimSuffix(strings.TrimPrefix(trimmed, "<![CDATA["), "]]>")
	}
	return trimmed
}

func capabilityValueMatchesSchema(value any, schema map[string]any) bool {
	switch schemaType(schema) {
	case "array":
		_, ok := value.([]any)
		return ok
	case "object":
		_, ok := value.(map[string]any)
		return ok
	case "boolean":
		_, ok := value.(bool)
		return ok
	case "number", "integer":
		_, ok := value.(float64)
		return ok
	case "null":
		return value == nil
	case "":
		return false
	default:
		return false
	}
}

func schemaType(schema map[string]any) string {
	value, _ := schema["type"].(string)
	return value
}

// repairMissingArrayObjectOpeners 修复兼容接口偶发丢失对象数组首个 {" 的参数。
func repairMissingArrayObjectOpeners(raw string, schema map[string]any) string {
	keys := map[string]struct{}{}
	collectArrayObjectPropertyNames(schema, keys)
	if len(keys) == 0 {
		return raw
	}

	type insertion struct {
		position int
		text     string
	}
	var insertions []insertion
	for i := 0; i < len(raw); i++ {
		if raw[i] != '[' {
			continue
		}
		position := i + 1
		for position < len(raw) && (raw[position] == ' ' || raw[position] == '\t' || raw[position] == '\r' || raw[position] == '\n') {
			position++
		}
		for key := range keys {
			if strings.HasPrefix(raw[position:], key+`":`) {
				insertions = append(insertions, insertion{position: position, text: `{"`})
				break
			}
			if strings.HasPrefix(raw[position:], `"`+key+`":`) {
				insertions = append(insertions, insertion{position: position, text: `{`})
				break
			}
		}
	}
	if len(insertions) == 0 {
		return raw
	}

	var builder strings.Builder
	start := 0
	for _, item := range insertions {
		builder.WriteString(raw[start:item.position])
		builder.WriteString(item.text)
		start = item.position
	}
	builder.WriteString(raw[start:])
	return builder.String()
}

func collectArrayObjectPropertyNames(schema map[string]any, keys map[string]struct{}) {
	if schemaType(schema) == "array" {
		if items, ok := schema["items"].(map[string]any); ok {
			if schemaType(items) == "object" {
				if properties, propertiesOK := items["properties"].(map[string]any); propertiesOK {
					for name := range properties {
						keys[name] = struct{}{}
					}
				}
			}
			collectArrayObjectPropertyNames(items, keys)
		}
	}
	if properties, ok := schema["properties"].(map[string]any); ok {
		for _, property := range properties {
			if child, childOK := property.(map[string]any); childOK {
				collectArrayObjectPropertyNames(child, keys)
			}
		}
	}
	for _, keyword := range []string{"anyOf", "oneOf", "allOf"} {
		if variants, ok := schema[keyword].([]any); ok {
			for _, variant := range variants {
				if child, childOK := variant.(map[string]any); childOK {
					collectArrayObjectPropertyNames(child, keys)
				}
			}
		}
	}
}
