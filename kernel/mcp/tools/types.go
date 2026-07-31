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
	"context"
	"encoding/json"
)

const (
	EffectScopeLocal    = "local"
	EffectScopeExternal = "external"
	EffectScopeMixed    = "mixed"
	EffectScopeUnknown  = "unknown"
)

type Tool struct {
	Name         string      `json:"name"`
	Title        string      `json:"title,omitempty"`
	Description  string      `json:"description"`
	InputSchema  ToolSchema  `json:"inputSchema"`
	OutputSchema *ToolSchema `json:"outputSchema,omitempty"`
	// Source 标记工具来源："native"（SiYuan 内置）、"plugin"（插件注册）、"mcp"（外部 MCP 服务）。
	// 用于 token 分类统计按来源拆分。空值按 "native" 处理（兼容旧调用方）。
	Source string `json:"source,omitempty"`
	// ReadOnlyHint 仅在外部工具明确声明只读时为 true；未声明时按可能写入处理并要求确认。
	ReadOnlyHint bool `json:"readOnlyHint,omitempty"`
	// EffectScope 描述写操作影响范围，用于判断本地数据仓库快照是否具有回滚价值。
	EffectScope string `json:"effectScope,omitempty"`
	// ActionEffects 按 action 描述本地读写、数据外发与外部计费，供智能体精确执行确认和快照策略。
	ActionEffects map[string]ToolEffects `json:"-"`

	Handler          func(args map[string]any) (CallToolResult, error)                      `json:"-"`
	ContextHandler   func(ctx context.Context, args map[string]any) (CallToolResult, error) `json:"-"`
	BoxLeaseResolver func(args map[string]any) []string                                     `json:"-"`
}

type ToolEffects struct {
	LocalRead    bool `json:"localRead,omitempty"`
	LocalWrite   bool `json:"localWrite,omitempty"`
	DataEgress   bool `json:"dataEgress,omitempty"`
	ExternalCost bool `json:"externalCost,omitempty"`
}

func (t *Tool) EffectsFor(action string) (ToolEffects, bool) {
	if t == nil || t.ActionEffects == nil {
		return ToolEffects{}, false
	}
	effects, ok := t.ActionEffects[action]
	return effects, ok
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
	Raw        map[string]any        `json:"-"`
}

func (s ToolSchema) MarshalJSON() ([]byte, error) {
	if s.Raw != nil {
		return json.Marshal(s.Raw)
	}
	type plain ToolSchema
	return json.Marshal(plain(s))
}

func (s *ToolSchema) UnmarshalJSON(data []byte) error {
	raw := map[string]any{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}

	type plain ToolSchema
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err == nil {
		*s = ToolSchema(decoded)
	} else {
		*s = ToolSchema{}
		if schemaType, ok := raw["type"].(string); ok {
			s.Type = schemaType
		}
	}
	s.Raw = raw
	return nil
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
	Content              []ContentItem     `json:"content"`
	StructuredContent    any               `json:"structuredContent,omitempty"`
	StructuredContentSet bool              `json:"-"`
	ModelAttachments     []ModelAttachment `json:"-"`
	IsError              bool              `json:"isError,omitempty"`
	ExecutionUnknown     bool              `json:"-"`
}

// ModelAttachment 描述工具希望在下一轮模型请求中附加的多模态输入。
// Data 只在当前运行期内存中传递，持久化时仅保存可重新解析资源的元数据。
type ModelAttachment struct {
	Type       string `json:"type"`
	Data       []byte `json:"-"`
	MIMEType   string `json:"mimeType,omitempty"`
	Path       string `json:"path,omitempty"`
	DocumentID string `json:"documentId,omitempty"`
	Detail     string `json:"detail,omitempty"`
	Width      int    `json:"width,omitempty"`
	Height     int    `json:"height,omitempty"`
}

func (r CallToolResult) HasStructuredContent() bool {
	return r.StructuredContentSet || r.StructuredContent != nil
}

func (r CallToolResult) MarshalJSON() ([]byte, error) {
	type plain CallToolResult
	if r.StructuredContentSet && r.StructuredContent == nil {
		return json.Marshal(struct {
			plain
			StructuredContent json.RawMessage `json:"structuredContent"`
		}{
			plain:             plain(r),
			StructuredContent: json.RawMessage("null"),
		})
	}
	return json.Marshal(plain(r))
}

func (r *CallToolResult) UnmarshalJSON(data []byte) error {
	type plain CallToolResult
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*r = CallToolResult(decoded)

	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	_, r.StructuredContentSet = fields["structuredContent"]
	return nil
}

type ContentItem struct {
	Type string `json:"type"`
	Text string `json:"text"`
	raw  json.RawMessage
}

func (item ContentItem) MarshalJSON() ([]byte, error) {
	if len(item.raw) > 0 {
		return item.raw, nil
	}
	type plain ContentItem
	return json.Marshal(plain(item))
}

func (item *ContentItem) UnmarshalJSON(data []byte) error {
	type plain ContentItem
	var decoded plain
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*item = ContentItem(decoded)
	item.raw = append(item.raw[:0], data...)
	return nil
}
