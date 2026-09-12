package apicontract

import (
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"sort"
	"strings"
)

// Schema 是生成器和响应验证共用的 JSON Schema 子集；不支持的 Go 类型直接报错。
type Schema struct {
	Ref                  string             `json:"$ref,omitempty"`
	Type                 string             `json:"type,omitempty"`
	Enum                 []any              `json:"enum,omitempty"`
	AnyOf                []*Schema          `json:"anyOf,omitempty"`
	Properties           map[string]*Schema `json:"properties,omitempty"`
	Required             []string           `json:"required,omitempty"`
	Items                *Schema            `json:"items,omitempty"`
	AdditionalProperties any                `json:"additionalProperties,omitempty"`
}

type EndpointSchema struct {
	Method   string   `json:"method"`
	Path     string   `json:"path"`
	Handler  string   `json:"handler"`
	Body     BodyMode `json:"body"`
	Request  *Schema  `json:"request"`
	Response *Schema  `json:"response"`
}

type Bundle struct {
	Dialect     string             `json:"$schema"`
	Definitions map[string]*Schema `json:"$defs"`
	Endpoints   []EndpointSchema   `json:"endpoints"`
}

type schemaBuilder struct {
	definitions map[string]*Schema
	owners      map[string]reflect.Type
}

func nullable(schema *Schema) *Schema {
	if schema.Type == "null" {
		return schema
	}
	for _, option := range schema.AnyOf {
		if option.Type == "null" {
			return schema
		}
	}
	return &Schema{AnyOf: []*Schema{schema, {Type: "null"}}}
}

func nonnullable(schema *Schema) *Schema {
	if len(schema.AnyOf) == 0 {
		return schema
	}
	var options []*Schema
	for _, option := range schema.AnyOf {
		if option.Type != "null" {
			options = append(options, option)
		}
	}
	if len(options) == 1 {
		return options[0]
	}
	return &Schema{AnyOf: options}
}

func (b *schemaBuilder) schema(t reflect.Type, input bool) (*Schema, error) {
	if t == reflect.TypeFor[Null]() {
		return &Schema{Type: "null"}, nil
	}
	if t == reflect.TypeFor[json.Number]() {
		return nil, fmt.Errorf("JSON number requires an explicit schema: %s", t)
	}
	if t == reflect.TypeFor[BlockInfoData]() {
		var variants []*Schema
		for _, member := range []reflect.Type{reflect.TypeFor[FullBlockInfo](), reflect.TypeFor[PublishedBlockInfo]()} {
			schema, err := b.schema(member, input)
			if err != nil {
				return nil, err
			}
			variants = append(variants, schema)
		}
		b.definitions["BlockInfoData"] = &Schema{AnyOf: variants}
		return &Schema{Ref: "#/$defs/BlockInfoData"}, nil
	}
	marshaler := reflect.TypeFor[json.Marshaler]()
	unmarshaler := reflect.TypeFor[json.Unmarshaler]()
	if t.Implements(marshaler) || reflect.PointerTo(t).Implements(marshaler) ||
		(input && (t.Implements(unmarshaler) || reflect.PointerTo(t).Implements(unmarshaler))) {
		return nil, fmt.Errorf("custom JSON codec requires an explicit schema: %s", t)
	}
	switch t.Kind() {
	case reflect.Pointer:
		child, err := b.schema(t.Elem(), input)
		if err != nil {
			return nil, err
		}
		return nullable(child), nil
	case reflect.String:
		return &Schema{Type: "string"}, nil
	case reflect.Bool:
		return &Schema{Type: "boolean"}, nil
	case reflect.Float32, reflect.Float64:
		return &Schema{Type: "number"}, nil
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return &Schema{Type: "integer"}, nil
	case reflect.Slice:
		if t.Elem().Kind() == reflect.Uint8 {
			return nil, fmt.Errorf("byte encoding requires an explicit schema: %s", t)
		}
		child, err := b.schema(t.Elem(), input)
		if err != nil {
			return nil, err
		}
		return nullable(&Schema{Type: "array", Items: child}), nil
	case reflect.Map:
		if t.Key().Kind() != reflect.String {
			return nil, fmt.Errorf("unsupported JSON map key: %s", t)
		}
		child, err := b.schema(t.Elem(), input)
		if err != nil {
			return nil, err
		}
		return nullable(&Schema{Type: "object", AdditionalProperties: child}), nil
	case reflect.Struct:
		name := t.Name()
		if name == "" {
			return nil, fmt.Errorf("anonymous contract type: %s", t)
		}
		if input {
			name += "Input"
		}
		if owner, exists := b.owners[name]; exists {
			if owner != t {
				return nil, fmt.Errorf("duplicate contract type name: %s", name)
			}
			return &Schema{Ref: "#/$defs/" + name}, nil
		}
		b.owners[name] = t
		object := &Schema{Type: "object", Properties: map[string]*Schema{}, AdditionalProperties: false}
		b.definitions[name] = object
		if err := b.fields(object, t, input); err != nil {
			return nil, err
		}
		sort.Strings(object.Required)
		return &Schema{Ref: "#/$defs/" + name}, nil
	default:
		return nil, fmt.Errorf("unsupported contract type: %s", t)
	}
}

func (b *schemaBuilder) fields(object *Schema, t reflect.Type, input bool) error {
	for i := 0; i < t.NumField(); i++ {
		field := t.Field(i)
		if !field.IsExported() && !field.Anonymous {
			continue
		}
		tag := strings.Split(field.Tag.Get("json"), ",")
		if tag[0] == "-" {
			continue
		}
		if field.Anonymous && tag[0] == "" {
			if field.Type.Kind() != reflect.Struct {
				return fmt.Errorf("embedded pointer requires an explicit schema: %s", field.Name)
			}
			if err := b.fields(object, field.Type, input); err != nil {
				return err
			}
			continue
		}
		name := tag[0]
		if name == "" {
			return fmt.Errorf("missing JSON field name: %s.%s", t, field.Name)
		}
		if _, exists := object.Properties[name]; exists {
			return fmt.Errorf("ambiguous JSON field: %s.%s", t, name)
		}
		for _, option := range tag[1:] {
			if option != "omitempty" {
				return fmt.Errorf("unsupported JSON tag: %s.%s", t, name)
			}
		}
		child, err := b.schema(field.Type, input)
		if err != nil {
			return err
		}
		options := "," + field.Tag.Get("api") + ","
		has := func(option string) bool { return strings.Contains(options, ","+option+",") }
		for _, option := range strings.Split(field.Tag.Get("api"), ",") {
			switch {
			case option == "", option == "optional", option == "nullable", option == "nonnullable":
			case option == "trim", option == "ignoretype", strings.HasPrefix(option, "enum="):
				if field.Type.Kind() != reflect.String {
					return fmt.Errorf("API option %s requires a string: %s.%s", option, t, name)
				}
			case option == "filterstrings":
				if field.Type != reflect.TypeFor[[]string]() {
					return fmt.Errorf("filterstrings requires []string: %s.%s", t, name)
				}
			case strings.HasPrefix(option, "const="):
			default:
				return fmt.Errorf("unknown API option %s: %s.%s", option, t, name)
			}
		}
		optional := input && has("optional")
		if input {
			if has("nullable") {
				child = nullable(child)
			}
			if !has("nullable") && field.Type.Kind() != reflect.Pointer && !has("filterstrings") {
				child = nonnullable(child)
			}
		} else if len(tag) > 1 && tag[1] == "omitempty" {
			optional = true
			child = nonnullable(child)
		}
		if has("nonnullable") {
			child = nonnullable(child)
		}
		for _, option := range strings.Split(field.Tag.Get("api"), ",") {
			if strings.HasPrefix(option, "enum=") {
				child.Enum = nil
				for _, value := range strings.Split(strings.TrimPrefix(option, "enum="), "|") {
					child.Enum = append(child.Enum, value)
				}
			}
			if strings.HasPrefix(option, "const=") {
				var constant any
				if err := json.Unmarshal([]byte(strings.TrimPrefix(option, "const=")), &constant); err != nil {
					return err
				}
				child.Enum = []any{constant}
			}
		}
		object.Properties[name] = child
		if !optional {
			object.Required = append(object.Required, name)
		}
	}
	return nil
}

func object(properties map[string]*Schema, required ...string) *Schema {
	return &Schema{Type: "object", Properties: properties, Required: required, AdditionalProperties: false}
}

func BuildBundle() (*Bundle, error) {
	b := &schemaBuilder{definitions: map[string]*Schema{}, owners: map[string]reflect.Type{}}
	bundle := &Bundle{Dialect: "https://json-schema.org/draft/2020-12/schema", Definitions: b.definitions}
	for _, definition := range Definitions() {
		if definition.Request.Kind() != reflect.Struct {
			return nil, fmt.Errorf("request contract must be a struct: %s", definition.Name)
		}
		request, err := b.schema(definition.Request, true)
		if err != nil {
			return nil, err
		}
		data, err := b.schema(definition.Data, false)
		if err != nil {
			return nil, err
		}
		if definition.DataNonNullable {
			data = nonnullable(data)
		}
		success := object(map[string]*Schema{"code": {Type: "integer", Enum: []any{0}}, "msg": {Type: "string"}, "data": data}, "code", "msg", "data")
		var codes []any
		for _, code := range definition.ErrorCodes {
			codes = append(codes, code)
		}
		// 只读中间件使用提示对象；其余业务错误没有数据，块信息还允许索引提示文本。
		errorData := nullable(object(map[string]*Schema{"closeTimeout": {Type: "number"}}, "closeTimeout"))
		if definition.ErrorText {
			errorData.AnyOf = append(errorData.AnyOf, &Schema{Type: "string"})
		}
		failure := object(map[string]*Schema{"code": {Type: "integer", Enum: codes}, "msg": {Type: "string"}, "data": errorData}, "code", "msg", "data")
		// 中间件可能使用带命令元数据的统一信封，保留这些额外的顶层字段。
		failure.AdditionalProperties = true
		response := &Schema{AnyOf: []*Schema{success, failure}}
		for _, method := range definition.Methods {
			bundle.Endpoints = append(bundle.Endpoints, EndpointSchema{method, definition.Path, definition.Name, definition.Body, request, response})
		}
	}
	sort.Slice(bundle.Endpoints, func(i, j int) bool {
		return bundle.Endpoints[i].Method+bundle.Endpoints[i].Path < bundle.Endpoints[j].Method+bundle.Endpoints[j].Path
	})
	return bundle, nil
}

func (b *Bundle) ValidateResponse(method, path string, payload []byte) error {
	var value any
	if err := json.Unmarshal(payload, &value); err != nil {
		return err
	}
	for _, endpoint := range b.Endpoints {
		if endpoint.Method == method && endpoint.Path == path {
			return b.validate(endpoint.Response, value, "$")
		}
	}
	return fmt.Errorf("unregistered API contract: %s %s", method, path)
}

func (b *Bundle) validate(schema *Schema, value any, path string) error {
	if len(schema.Enum) > 0 {
		matched := false
		actual, _ := json.Marshal(value)
		for _, option := range schema.Enum {
			expected, _ := json.Marshal(option)
			if string(actual) == string(expected) {
				matched = true
				break
			}
		}
		if !matched {
			return fmt.Errorf("%s has an unexpected value", path)
		}
	}
	if schema.Ref != "" {
		target, ok := b.Definitions[strings.TrimPrefix(schema.Ref, "#/$defs/")]
		if !ok {
			return fmt.Errorf("unknown schema reference: %s", schema.Ref)
		}
		return b.validate(target, value, path)
	}
	if len(schema.AnyOf) > 0 {
		for _, option := range schema.AnyOf {
			if b.validate(option, value, path) == nil {
				return nil
			}
		}
		return fmt.Errorf("%s does not match any response variant", path)
	}
	valid := false
	switch schema.Type {
	case "null":
		valid = value == nil
	case "string":
		_, valid = value.(string)
	case "boolean":
		_, valid = value.(bool)
	case "number", "integer":
		number, ok := value.(float64)
		valid = ok && (schema.Type != "integer" || math.Trunc(number) == number)
	case "array":
		array, ok := value.([]any)
		valid = ok
		if ok {
			for i, element := range array {
				if err := b.validate(schema.Items, element, fmt.Sprintf("%s[%d]", path, i)); err != nil {
					return err
				}
			}
		}
	case "object":
		fields, ok := value.(map[string]any)
		valid = ok
		if !ok {
			break
		}
		for _, key := range schema.Required {
			if _, exists := fields[key]; !exists {
				return fmt.Errorf("%s.%s is required", path, key)
			}
		}
		for key, child := range fields {
			if childSchema, exists := schema.Properties[key]; exists {
				if err := b.validate(childSchema, child, path+"."+key); err != nil {
					return err
				}
			} else if additional, ok := schema.AdditionalProperties.(*Schema); ok {
				if err := b.validate(additional, child, path+"."+key); err != nil {
					return err
				}
			} else if schema.AdditionalProperties != true {
				return fmt.Errorf("%s.%s is not declared", path, key)
			}
		}
	}
	if !valid {
		return fmt.Errorf("%s must be %s", path, schema.Type)
	}
	return nil
}
