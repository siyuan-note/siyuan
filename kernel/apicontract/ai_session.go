package apicontract

import (
	"encoding/json"
	"reflect"
	"strings"
)

// AISession 保留会话的扩展字段和已有字段的省略语义，格式由 AISessionFields 描述。
type AISession struct{ raw json.RawMessage }

func (s AISession) MarshalJSON() ([]byte, error) {
	if len(s.raw) == 0 {
		return []byte("null"), nil
	}
	return s.raw, nil
}
func (s *AISession) UnmarshalJSON(data []byte) error {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	s.raw = append(s.raw[:0], data...)
	return nil
}
func (s AISession) Bytes() []byte { return append([]byte(nil), s.raw...) }

func aiSessionPayloadSchema(b *schemaBuilder, input bool) (*Schema, error) {
	base, err := b.schema(reflect.TypeFor[AISessionFields](), input)
	if err != nil {
		return nil, err
	}
	additional, err := b.schema(reflect.TypeFor[JSONValue](), input)
	if err != nil {
		return nil, err
	}
	visited := map[string]bool{}
	var extend func(*Schema) *Schema
	extend = func(schema *Schema) *Schema {
		if schema == nil {
			return nil
		}
		copySchema := *schema
		schema = &copySchema
		if strings.HasPrefix(schema.Ref, "#/$defs/AI") {
			name := strings.TrimPrefix(schema.Ref, "#/$defs/")
			extendedName := "AISessionExtension" + name
			if !visited[name] {
				visited[name] = true
				payload := extend(b.definitions[name])
				if !strings.HasPrefix(name, "AISessionFields") {
					payload.Required = nil
				} else {
					payload.Properties["id"] = b.definitions[name].Properties["id"]
				}
				b.definitions[extendedName] = payload
			}
			schema.Ref = "#/$defs/" + extendedName
			return schema
		}
		if schema.Type == "object" && len(schema.Properties) > 0 {
			schema.AdditionalProperties = additional
		}
		if schema.Properties != nil {
			properties := make(map[string]*Schema, len(schema.Properties))
			for key, field := range schema.Properties {
				properties[key] = nullable(extend(field))
			}
			schema.Properties = properties
		}
		if schema.AnyOf != nil {
			branches := make([]*Schema, len(schema.AnyOf))
			for i, branch := range schema.AnyOf {
				branches[i] = extend(branch)
			}
			schema.AnyOf = branches
		}
		schema.Items = extend(schema.Items)
		return schema
	}
	return extend(base), nil
}
