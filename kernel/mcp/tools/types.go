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

type Tool struct {
	Name         string      `json:"name"`
	Title        string      `json:"title,omitempty"`
	Description  string      `json:"description"`
	InputSchema  ToolSchema  `json:"inputSchema"`
	OutputSchema *ToolSchema `json:"outputSchema,omitempty"`
	// Source 标记工具来源："native"（SiYuan 内置）、"plugin"（插件注册）、"mcp"（外部 MCP 服务）。
	// 用于 token 分类统计按来源拆分。空值按 "native" 处理（兼容旧调用方）。
	Source string `json:"source,omitempty"`

	Handler func(args map[string]interface{}) (CallToolResult, error) `json:"-"`
}

type ToolSchema struct {
	Type       string                `json:"type,omitempty"`
	Properties map[string]Property   `json:"properties,omitempty"`
	Required   []string              `json:"required,omitempty"`
	OneOf      []ToolSchema          `json:"oneOf,omitempty"`
	AnyOf      []ToolSchema          `json:"anyOf,omitempty"`
	AllOf      []ToolSchema          `json:"allOf,omitempty"`
	Ref        string                `json:"$ref,omitempty"`
	Defs       map[string]ToolSchema `json:"$defs,omitempty"`
}

type Property struct {
	Type        string              `json:"type,omitempty"`
	Description string              `json:"description,omitempty"`
	Enum        []string            `json:"enum,omitempty"`
	Items       *Property           `json:"items,omitempty"`
	Properties  map[string]Property `json:"properties,omitempty"`
	Required    []string            `json:"required,omitempty"`
	OneOf       []Property          `json:"oneOf,omitempty"`
	AnyOf       []Property          `json:"anyOf,omitempty"`
	AllOf       []Property          `json:"allOf,omitempty"`
	Ref         string              `json:"$ref,omitempty"`
}

type CallToolResult struct {
	Content []ContentItem `json:"content"`
	IsError bool          `json:"isError,omitempty"`
}

type ContentItem struct {
	Type string `json:"type"`
	Text string `json:"text"`
}
