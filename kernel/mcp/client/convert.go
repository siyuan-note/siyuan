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

package client

import (
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
)

func convertMCPSchema(inputSchema any) tools.ToolSchema {
	schema := tools.ToolSchema{}

	if inputSchema == nil {
		return schema
	}

	m, ok := inputSchema.(map[string]any)
	if !ok {
		return schema
	}

	if t, ok := m["type"].(string); ok && t != "" {
		schema.Type = t
	}

	if props, ok := m["properties"].(map[string]any); ok {
		schema.Properties = make(map[string]tools.Property)
		for name, prop := range props {
			schema.Properties[name] = convertMCPProperty(prop)
		}
	}

	if req, ok := m["required"].([]any); ok {
		schema.Required = make([]string, 0, len(req))
		for _, r := range req {
			if s, ok := r.(string); ok {
				schema.Required = append(schema.Required, s)
			}
		}
	}

	if oneOf, ok := m["oneOf"].([]any); ok {
		schema.OneOf = convertSchemaArray(oneOf)
	}

	if anyOf, ok := m["anyOf"].([]any); ok {
		schema.AnyOf = convertSchemaArray(anyOf)
	}

	if allOf, ok := m["allOf"].([]any); ok {
		schema.AllOf = convertSchemaArray(allOf)
	}

	if ref, ok := m["$ref"].(string); ok {
		schema.Ref = ref
	}

	if defs, ok := m["$defs"].(map[string]any); ok {
		schema.Defs = make(map[string]tools.ToolSchema)
		for name, def := range defs {
			schema.Defs[name] = convertMCPSchema(def)
		}
	}

	return schema
}

func convertMCPProperty(val any) tools.Property {
	prop := tools.Property{}

	m, ok := val.(map[string]any)
	if !ok {
		return prop
	}

	if t, ok := m["type"].(string); ok && t != "" {
		prop.Type = t
	}

	if desc, ok := m["description"].(string); ok {
		prop.Description = desc
	}

	if enums, ok := m["enum"].([]any); ok {
		prop.Enum = make([]string, 0, len(enums))
		for _, e := range enums {
			if s, ok := e.(string); ok {
				prop.Enum = append(prop.Enum, s)
			}
		}
	}

	if items, ok := m["items"].(map[string]any); ok {
		itemProp := convertMCPProperty(items)
		prop.Items = &itemProp
	}

	if nested, ok := m["properties"].(map[string]any); ok {
		prop.Properties = make(map[string]tools.Property)
		for name, p := range nested {
			prop.Properties[name] = convertMCPProperty(p)
		}
	}

	if req, ok := m["required"].([]any); ok {
		prop.Required = make([]string, 0, len(req))
		for _, r := range req {
			if s, ok := r.(string); ok {
				prop.Required = append(prop.Required, s)
			}
		}
	}

	if oneOf, ok := m["oneOf"].([]any); ok {
		prop.OneOf = convertPropArray(oneOf)
	}

	if anyOf, ok := m["anyOf"].([]any); ok {
		prop.AnyOf = convertPropArray(anyOf)
	}

	if allOf, ok := m["allOf"].([]any); ok {
		prop.AllOf = convertPropArray(allOf)
	}

	if ref, ok := m["$ref"].(string); ok {
		prop.Ref = ref
	}

	return prop
}

func convertSchemaArray(arr []any) []tools.ToolSchema {
	result := make([]tools.ToolSchema, 0, len(arr))
	for _, item := range arr {
		result = append(result, convertMCPSchema(item))
	}
	return result
}

func convertPropArray(arr []any) []tools.Property {
	result := make([]tools.Property, 0, len(arr))
	for _, item := range arr {
		result = append(result, convertMCPProperty(item))
	}
	return result
}
