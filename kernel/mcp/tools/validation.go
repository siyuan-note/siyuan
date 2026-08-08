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

package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/jsonschema-go/jsonschema"
)

const (
	maxToolSchemaBytes        = 1 << 20
	maxToolSchemaDepth        = 64
	maxToolSchemaNodes        = 16 << 10
	maxToolValueBytes         = 8 << 20
	maxToolValueDepth         = 128
	maxToolValueNodes         = 256 << 10
	toolValidationTime        = 2 * time.Second
	toolValidationConcurrency = 4
)

type ToolValidator struct {
	input           *jsonschema.Resolved
	output          *jsonschema.Resolved
	validationSlots chan struct{}
}

func CompileToolValidator(tool *Tool) (*ToolValidator, error) {
	if tool == nil {
		return nil, fmt.Errorf("tool is nil")
	}

	input, err := resolveToolSchema(tool.InputSchema, true)
	if err != nil {
		return nil, fmt.Errorf("invalid input schema: %w", err)
	}

	var output *jsonschema.Resolved
	if tool.OutputSchema != nil {
		if output, err = resolveToolSchema(*tool.OutputSchema, false); err != nil {
			return nil, fmt.Errorf("invalid output schema: %w", err)
		}
	}
	return &ToolValidator{
		input:           input,
		output:          output,
		validationSlots: make(chan struct{}, toolValidationConcurrency),
	}, nil
}

func resolveToolSchema(schema ToolSchema, requireObject bool) (*jsonschema.Resolved, error) {
	if schema.Raw != nil {
		if err := validateJSONComplexity(schema.Raw, maxToolSchemaDepth, maxToolSchemaNodes); err != nil {
			return nil, err
		}
	}
	data, err := json.Marshal(schema)
	if err != nil {
		return nil, err
	}
	if len(data) > maxToolSchemaBytes {
		return nil, fmt.Errorf("schema exceeds %d bytes", maxToolSchemaBytes)
	}
	var raw any
	if err = json.Unmarshal(data, &raw); err != nil {
		return nil, err
	}
	if err = validateJSONComplexity(raw, maxToolSchemaDepth, maxToolSchemaNodes); err != nil {
		return nil, err
	}
	if requireObject {
		if err = validateParamHeaderAnnotations(raw); err != nil {
			return nil, err
		}
	}
	var parsed jsonschema.Schema
	if err = json.Unmarshal(data, &parsed); err != nil {
		return nil, err
	}
	if requireObject && parsed.Type != "object" {
		return nil, fmt.Errorf(`root type must be "object"`)
	}
	return parsed.Resolve(nil)
}

func (validator *ToolValidator) ValidateInput(arguments map[string]any) error {
	return validator.ValidateInputContext(context.Background(), arguments)
}

func (validator *ToolValidator) ValidateInputContext(ctx context.Context, arguments map[string]any) error {
	if validator == nil || validator.input == nil {
		return nil
	}
	value, err := prepareValidationValue(arguments)
	if err != nil {
		return err
	}
	return validateResolved(ctx, validator.validationSlots, validator.input, value)
}

func (validator *ToolValidator) ValidateOutput(result CallToolResult) error {
	return validator.ValidateOutputContext(context.Background(), result)
}

func (validator *ToolValidator) ValidateOutputContext(ctx context.Context, result CallToolResult) error {
	if validator == nil || validator.output == nil || result.IsError {
		return nil
	}
	if !result.HasStructuredContent() {
		return fmt.Errorf("structured content is required when an output schema is defined")
	}
	value, err := prepareValidationValue(result.StructuredContent)
	if err != nil {
		return fmt.Errorf("prepare structured content: %w", err)
	}
	return validateResolved(ctx, validator.validationSlots, validator.output, value)
}

func prepareValidationValue(value any) (any, error) {
	if err := validateJSONComplexity(value, maxToolValueDepth, maxToolValueNodes); err != nil {
		return nil, err
	}
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	if len(data) > maxToolValueBytes {
		return nil, fmt.Errorf("value exceeds %d bytes", maxToolValueBytes)
	}
	var canonical any
	if err = json.Unmarshal(data, &canonical); err != nil {
		return nil, err
	}
	if err = validateJSONComplexity(canonical, maxToolValueDepth, maxToolValueNodes); err != nil {
		return nil, err
	}
	return canonical, nil
}

func validateResolved(ctx context.Context, validationSlots chan struct{}, schema *jsonschema.Resolved, value any) error {
	if ctx == nil {
		ctx = context.Background()
	}
	timer := time.NewTimer(toolValidationTime)
	defer timer.Stop()

	select {
	case validationSlots <- struct{}{}:
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return fmt.Errorf("validation did not start within %s", toolValidationTime)
	}

	result := make(chan error, 1)
	go func() {
		err := schema.Validate(value)
		<-validationSlots
		result <- err
	}()

	select {
	case err := <-result:
		return err
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return fmt.Errorf("validation exceeded %s", toolValidationTime)
	}
}

func validateJSONComplexity(value any, maxDepth, maxNodes int) error {
	nodes := 0
	var walk func(any, int) error
	walk = func(current any, depth int) error {
		if depth > maxDepth {
			return fmt.Errorf("JSON depth exceeds %d", maxDepth)
		}
		nodes++
		if nodes > maxNodes {
			return fmt.Errorf("JSON node count exceeds %d", maxNodes)
		}
		switch typed := current.(type) {
		case map[string]any:
			for _, child := range typed {
				if err := walk(child, depth+1); err != nil {
					return err
				}
			}
		case []any:
			for _, child := range typed {
				if err := walk(child, depth+1); err != nil {
					return err
				}
			}
		}
		return nil
	}
	return walk(value, 0)
}

func validateParamHeaderAnnotations(schema any) error {
	root, ok := schema.(map[string]any)
	if !ok {
		return nil
	}
	properties, _ := root["properties"].(map[string]any)
	seen := map[string]bool{}
	var walk func(map[string]any, string) error
	walk = func(props map[string]any, prefix string) error {
		for propertyName, rawProperty := range props {
			property, ok := rawProperty.(map[string]any)
			if !ok {
				continue
			}
			path := propertyName
			if prefix != "" {
				path = prefix + "." + propertyName
			}
			if rawHeader, exists := property["x-mcp-header"]; exists {
				header, ok := rawHeader.(string)
				if !ok || header == "" {
					return fmt.Errorf(`property %q: x-mcp-header must be a non-empty string`, path)
				}
				propertyType, _ := property["type"].(string)
				if propertyType != "string" && propertyType != "integer" && propertyType != "boolean" {
					return fmt.Errorf(
						`property %q: x-mcp-header can only be applied to primitive types (integer, string, boolean), got %q`,
						path, propertyType)
				}
				if !validHTTPFieldName(header) {
					return fmt.Errorf(`property %q: x-mcp-header value %q is not a valid HTTP field name`, path, header)
				}
				normalized := strings.ToLower(header)
				if seen[normalized] {
					return fmt.Errorf(`property %q: duplicate x-mcp-header value %q`, path, header)
				}
				seen[normalized] = true
			}
			nested, _ := property["properties"].(map[string]any)
			if err := walk(nested, path); err != nil {
				return err
			}
		}
		return nil
	}
	return walk(properties, "")
}

func validHTTPFieldName(name string) bool {
	if name == "" {
		return false
	}
	for _, character := range name {
		if character > 127 ||
			!((character >= 'a' && character <= 'z') ||
				(character >= 'A' && character <= 'Z') ||
				(character >= '0' && character <= '9') ||
				strings.ContainsRune("!#$%&'*+-.^_`|~", character)) {
			return false
		}
	}
	return true
}
