package apicontract

import (
	"encoding/json"
	"fmt"
	"mime"
	"mime/multipart"
	"reflect"
	"sort"
	"strings"
)

// Schema 是生成器和响应验证共用的 JSON Schema 子集；不支持的 Go 类型直接报错。
type Schema struct {
	Ref                  string             `json:"$ref,omitempty"`
	Type                 string             `json:"type,omitempty"`
	Format               string             `json:"format,omitempty"`
	Enum                 []any              `json:"enum,omitempty"`
	AnyOf                []*Schema          `json:"anyOf,omitempty"`
	Not                  *Schema            `json:"not,omitempty"`
	Properties           map[string]*Schema `json:"properties,omitempty"`
	Required             []string           `json:"required,omitempty"`
	Items                *Schema            `json:"items,omitempty"`
	MinItems             int                `json:"minItems,omitempty"`
	MaxItems             *int               `json:"maxItems,omitempty"`
	AdditionalProperties any                `json:"additionalProperties,omitempty"`
}

type EndpointSchema struct {
	Method                  string                   `json:"method"`
	Path                    string                   `json:"path"`
	Handler                 string                   `json:"handler"`
	Body                    BodyMode                 `json:"body"`
	Request                 *Schema                  `json:"request"`
	Response                *Schema                  `json:"response"`
	Output                  OutputMode               `json:"output,omitempty"`
	ErrorStatus             int                      `json:"errorStatus,omitempty"`
	NoContent               bool                     `json:"noContent,omitempty"`
	WebSocket               *WebSocketSchema         `json:"websocket,omitempty"`
	SSE                     *SSESchema               `json:"sse,omitempty"`
	Proxy                   *ProxyDefinition         `json:"proxy,omitempty"`
	PluginService           *PluginServiceDefinition `json:"pluginService,omitempty"`
	ContentVariants         []HTTPContentVariant     `json:"contentVariants,omitempty"`
	EmptyResponseStatuses   []int                    `json:"emptyResponseStatuses,omitempty"`
	AdditionalErrorStatuses []int                    `json:"additionalErrorStatuses,omitempty"`
}

type WebSocketSchema struct {
	Incoming      *Schema                 `json:"incoming"`
	Outgoing      *Schema                 `json:"outgoing"`
	FailureStatus int                     `json:"failureStatus"`
	Raw           *RawWebSocketDefinition `json:"raw,omitempty"`
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
	if schema, err := transactionPayloadSchema(b, t, input); schema != nil || err != nil {
		return schema, err
	}
	if schema, err := systemVariantSchema(b, t, input); schema != nil || err != nil {
		return schema, err
	}
	if t == reflect.TypeFor[ExtensionCopyRequest]() {
		if !input {
			return nil, fmt.Errorf("extension upload fields can only appear in requests")
		}
		return extensionCopyRequestSchema(), nil
	}
	if t == reflect.TypeFor[PluginServiceContent]() {
		value, err := b.schema(reflect.TypeFor[JSONValue](), false)
		if err != nil {
			return nil, err
		}
		return &Schema{AnyOf: []*Schema{{Type: "string", Format: "binary"}, value}}, nil
	}
	if t == reflect.TypeFor[*NetworkEchoTLS]() || t == reflect.TypeFor[*NetworkEchoURL]() || t == reflect.TypeFor[*NetworkEchoCookies]() {
		schema, err := networkEchoSchema(b, t.Elem())
		if err != nil {
			return nil, err
		}
		return nullable(schema), nil
	}
	if t == reflect.TypeFor[NetworkEchoTLS]() || t == reflect.TypeFor[NetworkEchoURL]() || t == reflect.TypeFor[NetworkEchoCookies]() {
		return networkEchoSchema(b, t)
	}
	if t == reflect.TypeFor[*AISession]() {
		schema, err := aiSessionPayloadSchema(b, input)
		if err != nil {
			return nil, err
		}
		return nullable(schema), nil
	}
	if t == reflect.TypeFor[AISession]() {
		return aiSessionPayloadSchema(b, input)
	}
	if schema, err := bazaarPayloadSchema(b, t, input); schema != nil || err != nil {
		return schema, err
	}
	if schema, err := avPayloadSchema(b, t, input); schema != nil || err != nil {
		return schema, err
	}
	if t == reflect.TypeFor[PluginRPCMessage]() {
		response, err := b.schema(reflect.TypeFor[PluginRPCResponse](), false)
		if err != nil {
			return nil, err
		}
		notification, err := b.schema(reflect.TypeFor[PluginRPCNotification](), false)
		if err != nil {
			return nil, err
		}
		// 展开单条回复分支，使声明生成器能排除通知中的 ID 和回复中的 method。
		variants := append([]*Schema{}, response.AnyOf[0].AnyOf...)
		variants = append(variants, response.AnyOf[1], notification)
		return &Schema{AnyOf: variants}, nil
	}
	if t == reflect.TypeFor[*JSONValue]() {
		value, err := b.schema(reflect.TypeFor[JSONValue](), input)
		if err != nil {
			return nil, err
		}
		return nullable(value), nil
	}
	if t == reflect.TypeFor[PluginRPCID]() || t == reflect.TypeFor[*PluginRPCID]() {
		return &Schema{AnyOf: []*Schema{{Type: "string"}, {Type: "number"}, {Type: "null"}}}, nil
	}
	if t == reflect.TypeFor[PluginRPCParams]() {
		value, err := b.schema(reflect.TypeFor[JSONValue](), input)
		if err != nil {
			return nil, err
		}
		return &Schema{AnyOf: []*Schema{{Type: "array", Items: value}, {Type: "object", AdditionalProperties: value}}}, nil
	}
	if t == reflect.TypeFor[PluginRPCBatchRequest]() {
		call, err := b.schema(reflect.TypeFor[PluginRPCRequestFields](), true)
		if err != nil {
			return nil, err
		}
		return &Schema{AnyOf: []*Schema{call, {Type: "array", Items: call, MinItems: 1}}}, nil
	}
	if t == reflect.TypeFor[PluginRPCReply]() {
		success, err := b.schema(reflect.TypeFor[PluginRPCSuccess](), false)
		if err != nil {
			return nil, err
		}
		failure, err := b.schema(reflect.TypeFor[PluginRPCFailure](), false)
		if err != nil {
			return nil, err
		}
		return &Schema{AnyOf: []*Schema{success, failure}}, nil
	}
	if t == reflect.TypeFor[PluginRPCResponse]() {
		reply, err := b.schema(reflect.TypeFor[PluginRPCReply](), false)
		if err != nil {
			return nil, err
		}
		return &Schema{AnyOf: []*Schema{reply, {Type: "array", Items: reply, MinItems: 1}}}, nil
	}
	if t == reflect.TypeFor[ImportAutoData]() {
		var variants []*Schema
		for _, member := range []reflect.Type{reflect.TypeFor[ImportAutoDocument](), reflect.TypeFor[ImportAutoNotebook](), reflect.TypeFor[ImportAutoNotebooks]()} {
			variant, err := b.schema(member, false)
			if err != nil {
				return nil, err
			}
			variants = append(variants, variant)
		}
		return &Schema{AnyOf: variants}, nil
	}
	if t == reflect.TypeFor[ImportNotebookData]() {
		one, err := b.schema(reflect.TypeFor[ImportedNotebook](), false)
		if err != nil {
			return nil, err
		}
		many, err := b.schema(reflect.TypeFor[ImportedNotebooks](), false)
		if err != nil {
			return nil, err
		}
		return &Schema{AnyOf: []*Schema{one, many}}, nil
	}
	if t == reflect.TypeFor[BacklinkListData]() {
		list, err := b.schema(reflect.TypeFor[BacklinkList](), false)
		if err != nil {
			return nil, err
		}
		definitions, err := b.schema(reflect.TypeFor[BacklinkRefDefs](), false)
		if err != nil {
			return nil, err
		}
		return &Schema{AnyOf: []*Schema{list, definitions, {Type: "null"}}}, nil
	}
	if t == reflect.TypeFor[SearchRefData]() {
		result, err := b.schema(reflect.TypeFor[SearchRefResult](), false)
		if err != nil {
			return nil, err
		}
		correlation, err := b.schema(reflect.TypeFor[SearchRefCorrelation](), false)
		if err != nil {
			return nil, err
		}
		return &Schema{AnyOf: []*Schema{result, correlation}}, nil
	}
	if t == reflect.TypeFor[GlobalGraphData]() || t == reflect.TypeFor[LocalGraphData]() {
		resultType := reflect.TypeFor[GlobalGraphResult]()
		if t == reflect.TypeFor[LocalGraphData]() {
			resultType = reflect.TypeFor[LocalGraphResult]()
		}
		result, err := b.schema(resultType, false)
		if err != nil {
			return nil, err
		}
		correlation, err := b.schema(reflect.TypeFor[GraphCorrelation](), false)
		if err != nil {
			return nil, err
		}
		return &Schema{AnyOf: []*Schema{result, correlation}}, nil
	}
	if t == reflect.TypeFor[GraphConfiguration]() {
		return b.schema(reflect.TypeFor[GraphConfigurationFields](), true)
	}
	if t == reflect.TypeFor[GraphConfigurationData]() {
		global, err := b.schema(reflect.TypeFor[GlobalGraphConf](), false)
		if err != nil {
			return nil, err
		}
		local, err := b.schema(reflect.TypeFor[LocalGraphConf](), false)
		if err != nil {
			return nil, err
		}
		return &Schema{AnyOf: []*Schema{global, local}}, nil
	}
	if t == reflect.TypeFor[TemplateManagementData]() {
		var variants []*Schema
		for _, member := range []reflect.Type{reflect.TypeFor[[]TemplateFileEntry](), reflect.TypeFor[TemplateFileSource](), reflect.TypeFor[TemplateFileRevision]()} {
			variant, err := b.schema(member, false)
			if err != nil {
				return nil, err
			}
			variants = append(variants, nonnullable(variant))
		}
		return &Schema{AnyOf: append(variants, &Schema{Type: "null"})}, nil
	}
	if t == reflect.TypeFor[SQLValue]() || t == reflect.TypeFor[PublishDataValue]() {
		return &Schema{AnyOf: []*Schema{{Type: "null"}, {Type: "string"}, {Type: "number"}, {Type: "boolean"}}}, nil
	}
	if t == reflect.TypeFor[BinaryContent]() {
		if input {
			return nil, fmt.Errorf("binary content can only appear in responses")
		}
		return &Schema{Type: "string", Format: "binary"}, nil
	}
	if t == reflect.TypeFor[MultipartFields]() {
		if !input {
			return nil, fmt.Errorf("multipart fields can only appear in requests")
		}
		return &Schema{Type: "object", AdditionalProperties: &Schema{Type: "array", Items: &Schema{AnyOf: []*Schema{{Type: "string"}, {Type: "string", Format: "binary"}}}}}, nil
	}
	if t == reflect.TypeFor[HTMLClipboardData]() {
		preflight, err := b.schema(reflect.TypeFor[HTMLClipboardPreflight](), input)
		if err != nil {
			return nil, err
		}
		return &Schema{AnyOf: []*Schema{{Type: "string"}, preflight}}, nil
	}
	if t == reflect.TypeFor[BlockOperationData]() {
		options, err := b.schema(reflect.TypeFor[BlockDeleteData](), input)
		if err != nil {
			return nil, err
		}
		return &Schema{AnyOf: []*Schema{{Type: "null"}, {Type: "string"}, options}}, nil
	}
	if t == reflect.TypeFor[BlockOperationResult]() {
		return &Schema{AnyOf: []*Schema{{Type: "null"}, {Type: "string"}, {Type: "array", Items: &Schema{Type: "string"}}}}, nil
	}
	if t == reflect.TypeFor[*CloudLogin2faData]() {
		schema, err := b.cloudLogin2faDataSchema(input)
		if err != nil {
			return nil, err
		}
		return nullable(schema), nil
	}
	if t == reflect.TypeFor[CloudLogin2faData]() {
		return b.cloudLogin2faDataSchema(input)
	}
	if t == reflect.TypeFor[JSONValue]() {
		ref := &Schema{Ref: "#/$defs/JSONValue"}
		b.definitions["JSONValue"] = &Schema{AnyOf: []*Schema{
			{Type: "null"}, {Type: "boolean"}, {Type: "number"}, {Type: "string"},
			{Type: "array", Items: ref}, {Type: "object", AdditionalProperties: ref},
		}}
		return ref, nil
	}
	if t == reflect.TypeFor[Base64Bytes]() {
		if input {
			return nullable(&Schema{AnyOf: []*Schema{{Type: "string"}, {Type: "array", Items: &Schema{Type: "integer"}}}}), nil
		}
		return nullable(&Schema{Type: "string"}), nil
	}
	if t == reflect.TypeFor[[]*multipart.FileHeader]() {
		if !input {
			return nil, fmt.Errorf("uploaded files are request-only")
		}
		return &Schema{Type: "array", Items: &Schema{Type: "string", Format: "binary"}}, nil
	}
	if t == reflect.TypeFor[*multipart.FileHeader]() {
		if !input {
			return nil, fmt.Errorf("uploaded files are request-only")
		}
		return &Schema{Type: "string", Format: "binary"}, nil
	}
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
	case reflect.Array:
		if input {
			return nil, fmt.Errorf("fixed array request binding requires an explicit decoder: %s", t)
		}
		child, err := b.schema(t.Elem(), input)
		if err != nil {
			return nil, err
		}
		length := t.Len()
		return &Schema{Type: "array", Items: child, MinItems: length, MaxItems: &length}, nil
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
			case option == "legacyobject":
				if field.Type.Kind() != reflect.Pointer || field.Type.Elem().Kind() != reflect.Struct {
					return fmt.Errorf("legacyobject requires a struct pointer: %s.%s", t, name)
				}
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
			if field.Type.Kind() == reflect.Pointer {
				// 仅外层空指针被省略，内层指针或集合仍可序列化为 null。
				child, err = b.schema(field.Type.Elem(), false)
				if err != nil {
					return err
				}
			} else {
				child = nonnullable(child)
			}
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
		if err := validatePluginServiceDefinition(definition); err != nil {
			return nil, err
		}
		if err := validateProxyDefinition(definition); err != nil {
			return nil, err
		}
		for _, status := range definition.EmptyResponseStatuses {
			if status < 200 || status > 599 {
				return nil, fmt.Errorf("invalid empty response status: %s", definition.Name)
			}
		}
		if definition.FastJSON && definition.Output != "" {
			return nil, fmt.Errorf("fast JSON requires envelope output: %s", definition.Name)
		}
		if err := validateContentVariants(definition); err != nil {
			return nil, err
		}
		for _, status := range definition.AdditionalErrorStatuses {
			if (definition.Output != "" && definition.Output != SSEOutput) || status < 400 || status > 599 {
				return nil, fmt.Errorf("invalid JSON error status: %s", definition.Name)
			}
		}
		if definition.Output != "" && definition.Output != BinaryOutput && definition.Output != DirectJSONOutput && definition.Output != WebSocketOutput && definition.Output != SSEOutput && definition.Output != ProxyOutput && definition.Output != PluginServiceOutput {
			return nil, fmt.Errorf("unsupported response output: %s", definition.Name)
		}
		if definition.NoContent && definition.Output != DirectJSONOutput {
			return nil, fmt.Errorf("empty responses require direct JSON output: %s", definition.Name)
		}
		var websocket *WebSocketSchema
		var sse *SSESchema
		if (definition.Output == SSEOutput) != (definition.SSE != nil) {
			return nil, fmt.Errorf("SSE output requires event declarations: %s", definition.Name)
		}
		if definition.SSE != nil {
			if definition.DataOnError || definition.ErrorStatus != 0 || definition.DataNonNullable {
				return nil, fmt.Errorf("invalid SSE response options: %s", definition.Name)
			}
			var err error
			sse, err = b.sseSchema(definition.SSE)
			if err != nil {
				return nil, err
			}
		}
		if (definition.Output == WebSocketOutput) != (definition.WebSocket != nil) {
			return nil, fmt.Errorf("WebSocket output requires message declarations: %s", definition.Name)
		}
		if ws := definition.WebSocket; ws != nil {
			if definition.Body != NoBody || definition.DataOnError || definition.ErrorStatus != 0 || ws.Raw == nil && (ws.FailureStatus < 400 || ws.FailureStatus > 599) {
				return nil, fmt.Errorf("invalid WebSocket response options: %s", definition.Name)
			}
			for _, method := range definition.Methods {
				if method != "GET" {
					return nil, fmt.Errorf("WebSocket upgrade requires GET: %s", definition.Name)
				}
			}
			if ws.Raw != nil {
				if definition.Data != reflect.TypeFor[Null]() {
					return nil, fmt.Errorf("raw WebSocket output requires Null data: %s", definition.Name)
				}
				var err error
				websocket, err = rawWebSocketSchema(ws)
				if err != nil {
					return nil, err
				}
			} else {
				incoming, err := b.schema(ws.Incoming, true)
				if err != nil {
					return nil, err
				}
				outgoing, err := b.schema(ws.Outgoing, false)
				if err != nil {
					return nil, err
				}
				websocket = &WebSocketSchema{Incoming: incoming, Outgoing: outgoing, FailureStatus: ws.FailureStatus}
			}
		}
		if definition.Output == DirectJSONOutput && (definition.DataOnError || definition.ErrorStatus != 0) {
			return nil, fmt.Errorf("direct JSON output cannot use envelope data or error status options: %s", definition.Name)
		}
		if (definition.Output == BinaryOutput) != (definition.Data == reflect.TypeFor[BinaryContent]()) {
			return nil, fmt.Errorf("binary output requires BinaryContent: %s", definition.Name)
		}
		if definition.Output == BinaryOutput && (definition.DataOnError || definition.DataNonNullable) {
			return nil, fmt.Errorf("binary output cannot use JSON data options: %s", definition.Name)
		}
		if definition.Output == BinaryOutput && (definition.ErrorStatus < 200 || definition.ErrorStatus > 599) {
			return nil, fmt.Errorf("binary output requires an explicit error status: %s", definition.Name)
		}
		if definition.Request.Kind() != reflect.Struct {
			return nil, fmt.Errorf("request contract must be a struct: %s", definition.Name)
		}
		if definition.Body == MultipartBody || definition.Body == FormBody {
			if err := validateMultipartRequest(definition.Request); err != nil {
				return nil, err
			}
		}
		request, err := b.schema(definition.Request, true)
		if err != nil {
			return nil, err
		}
		if definition.Body == RawBody {
			request = &Schema{Type: "string", Format: "binary"}
		}
		data, err := b.schema(definition.Data, false)
		if err != nil {
			return nil, err
		}
		if definition.DataNonNullable {
			data = nonnullable(data)
		}
		success := object(map[string]*Schema{"code": {Type: "integer", Enum: []any{0}}, "msg": {Type: "string"}, "data": data}, "code", "msg", "data")
		if definition.Data == reflect.TypeFor[SQLRows]() {
			success.Properties["limit"] = &Schema{Type: "integer"}
			success.Properties["truncated"] = &Schema{Type: "boolean"}
			success.Required = append(success.Required, "limit", "truncated")
		}
		if definition.Output == BinaryOutput {
			success = data
			// fetch 按媒体类型将文件读作文本或 JSON，JSON 文件本身没有信封约束。
			if _, err := b.schema(reflect.TypeFor[JSONValue](), false); err != nil {
				return nil, err
			}
		}
		if definition.Output == DirectJSONOutput || definition.Output == WebSocketOutput || definition.Output == PluginServiceOutput {
			success = data
		}
		if definition.Output == SSEOutput {
			success = &Schema{Type: "string"}
		}
		if definition.Output == ProxyOutput {
			success = &Schema{Type: "string", Format: "binary"}
			if _, err := b.schema(reflect.TypeFor[JSONValue](), false); err != nil {
				return nil, err
			}
		}
		var codes []any
		for _, code := range definition.ErrorCodes {
			codes = append(codes, code)
		}
		// 只读中间件使用提示对象；其余业务错误没有数据，块信息还允许索引提示文本。
		errorData := nullable(object(map[string]*Schema{"closeTimeout": {Type: "number"}}, "closeTimeout"))
		if definition.ErrorText {
			errorData.AnyOf = append(errorData.AnyOf, &Schema{Type: "string"})
		}
		if definition.DataOnError {
			errorData.AnyOf = append(errorData.AnyOf, data)
		}
		failure := object(map[string]*Schema{"code": {Type: "integer", Enum: codes}, "msg": {Type: "string"}, "data": errorData}, "code", "msg", "data")
		// 中间件可能使用带命令元数据的统一信封，保留这些额外的顶层字段。
		failure.AdditionalProperties = true
		response := &Schema{AnyOf: []*Schema{success, failure}}
		for _, method := range ExpandMethods(definition.Methods) {
			bundle.Endpoints = append(bundle.Endpoints, EndpointSchema{Method: method, Path: definition.Path, Handler: definition.Name,
				Body: definition.Body, Request: request, Response: response, Output: definition.Output, ErrorStatus: definition.ErrorStatus, NoContent: definition.NoContent, WebSocket: websocket,
				AdditionalErrorStatuses: definition.AdditionalErrorStatuses, SSE: sse, Proxy: definition.Proxy, PluginService: definition.PluginService, ContentVariants: definition.ContentVariants, EmptyResponseStatuses: definition.EmptyResponseStatuses})
		}
	}
	sort.Slice(bundle.Endpoints, func(i, j int) bool {
		return bundle.Endpoints[i].Method+bundle.Endpoints[i].Path < bundle.Endpoints[j].Method+bundle.Endpoints[j].Path
	})
	return bundle, nil
}

// ValidateErrorResponse 在原始文件与错误共用 HTTP 状态时，单独验证已知的错误分支。
func (b *Bundle) ValidateErrorResponse(method, path string, payload []byte) error {
	var value any
	if err := decodeSchemaJSON(payload, &value); err != nil {
		return err
	}
	for _, endpoint := range b.Endpoints {
		if endpoint.Method == method && endpoint.Path == path {
			return b.validate(endpoint.Response.AnyOf[1], value, "$")
		}
	}
	return fmt.Errorf("unregistered API contract: %s %s", method, path)
}

func (b *Bundle) ValidateResponse(method, path string, payload []byte) error {
	var value any
	if err := decodeSchemaJSON(payload, &value); err != nil {
		return err
	}
	for _, endpoint := range b.Endpoints {
		if endpoint.Method == method && endpoint.Path == path {
			if endpoint.Output == BinaryOutput || endpoint.Output == WebSocketOutput || endpoint.Output == SSEOutput || endpoint.Output == ProxyOutput || endpoint.Output == PluginServiceOutput {
				return fmt.Errorf("binary endpoint requires HTTP response validation")
			}
			return b.validate(endpoint.Response, value, "$")
		}
	}
	return fmt.Errorf("unregistered API contract: %s %s", method, path)
}

// ValidateHTTPResponse 同时校验响应状态、媒体类型和对应的载荷，原始文件不尝试解析为 JSON。
func (b *Bundle) ValidateHTTPResponse(method, path string, status int, contentType string, payload []byte) error {
	for _, endpoint := range b.Endpoints {
		if endpoint.Method != method || endpoint.Path != path {
			continue
		}
		if endpoint.PluginService != nil {
			return b.validatePluginServiceHTTPResponse(endpoint, status, contentType, payload)
		}
		if endpoint.Proxy != nil {
			return b.validateProxyHTTPResponse(endpoint, status, contentType, payload)
		}
		for _, emptyStatus := range endpoint.EmptyResponseStatuses {
			if status == emptyStatus && len(payload) == 0 {
				return nil
			}
		}
		if endpoint.NoContent && status == 204 {
			if len(payload) != 0 {
				return fmt.Errorf("empty response must not contain a body")
			}
			return nil
		}
		if endpoint.WebSocket != nil {
			if handled, err := validateRawWebSocketHTTP(endpoint.WebSocket, status, contentType, payload); handled {
				return err
			}
		}
		if endpoint.WebSocket != nil && status == 101 {
			if len(payload) != 0 {
				return fmt.Errorf("WebSocket upgrade must not contain an HTTP body")
			}
			return nil
		}
		mediaType, _, err := mime.ParseMediaType(contentType)
		if err != nil {
			return fmt.Errorf("invalid response content type: %w", err)
		}
		if endpoint.Output == BinaryOutput {
			if len(endpoint.ContentVariants) == 0 && status == 200 || matchesContentVariant(endpoint.ContentVariants, status, mediaType) {
				return nil
			}
		}
		if endpoint.SSE != nil && status == 200 && mediaType == "text/event-stream" {
			return nil
		}
		expectedStatus := 200
		response := endpoint.Response
		if endpoint.SSE != nil {
			response = endpoint.Response.AnyOf[1]
		}
		for _, extraStatus := range endpoint.AdditionalErrorStatuses {
			if status == extraStatus {
				expectedStatus = status
				response = endpoint.Response.AnyOf[1]
			}
		}
		if endpoint.WebSocket != nil {
			if status == 400 && mediaType == "text/plain" {
				return nil
			}
			response = endpoint.Response.AnyOf[1]
			if status == endpoint.WebSocket.FailureStatus {
				expectedStatus = status
				response = endpoint.Response.AnyOf[0]
			}
		}
		if endpoint.Output == BinaryOutput {
			if endpoint.ErrorStatus != 0 {
				expectedStatus = endpoint.ErrorStatus
			}
			response = endpoint.Response.AnyOf[1]
		}
		if status != expectedStatus || mediaType != "application/json" {
			return fmt.Errorf("unexpected response status or media type: %d %s", status, contentType)
		}
		var value any
		if err := decodeSchemaJSON(payload, &value); err != nil {
			return err
		}
		return b.validate(response, value, "$")
	}
	return fmt.Errorf("unregistered API contract: %s %s", method, path)
}

func (b *Bundle) validate(schema *Schema, value any, path string) error {
	if schema.Not != nil && b.validate(schema.Not, value, path) == nil {
		return fmt.Errorf("%s matches an excluded value", path)
	}
	if len(schema.Enum) > 0 {
		matched := false
		for _, option := range schema.Enum {
			if equalSchemaValue(value, option) {
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
	case "":
		valid = true
	case "null":
		valid = value == nil
	case "string":
		_, valid = value.(string)
	case "boolean":
		_, valid = value.(bool)
	case "number", "integer":
		valid = validSchemaNumber(value, schema.Type == "integer")
	case "array":
		array, ok := value.([]any)
		valid = ok
		if ok {
			if len(array) < schema.MinItems {
				return fmt.Errorf("%s has too few array items", path)
			}
			if schema.MaxItems != nil && len(array) > *schema.MaxItems {
				return fmt.Errorf("%s has too many array items", path)
			}
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
