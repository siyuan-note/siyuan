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

package tools

import (
	"encoding/json"
	"fmt"

	"github.com/google/jsonschema-go/jsonschema"
)

type ToolValidator struct {
	input  *jsonschema.Resolved
	output *jsonschema.Resolved
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
	return &ToolValidator{input: input, output: output}, nil
}

func resolveToolSchema(schema ToolSchema, requireObject bool) (*jsonschema.Resolved, error) {
	data, err := json.Marshal(schema)
	if err != nil {
		return nil, err
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
	if validator == nil || validator.input == nil {
		return nil
	}
	return validator.input.Validate(arguments)
}

func (validator *ToolValidator) ValidateOutput(result CallToolResult) error {
	if validator == nil || validator.output == nil || result.IsError {
		return nil
	}
	if !result.HasStructuredContent() {
		return fmt.Errorf("structured content is required when an output schema is defined")
	}
	data, err := json.Marshal(result.StructuredContent)
	if err != nil {
		return fmt.Errorf("marshal structured content: %w", err)
	}
	var value any
	if err = json.Unmarshal(data, &value); err != nil {
		return fmt.Errorf("unmarshal structured content: %w", err)
	}
	return validator.output.Validate(value)
}
