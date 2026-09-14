package apicontract

import (
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"strings"
)

const SSEOutput OutputMode = "sse"

// SSEEventDefinition 将事件名称与对应的 JSON 载荷类型绑定。
type SSEEventDefinition struct {
	name    string
	payload reflect.Type
}

func SSEEvent[Payload any](name string) SSEEventDefinition {
	if strings.ContainsAny(name, "\r\n") {
		panic("SSE event name cannot contain a newline")
	}
	return SSEEventDefinition{name: name, payload: reflect.TypeFor[Payload]()}
}

type SSEDefinition struct {
	Events []SSEEventDefinition
	Raw    *RawSSEDefinition
}
type SSESchema struct {
	Events map[string]*Schema `json:"events,omitempty"`
	Raw    *RawSSEDefinition  `json:"raw,omitempty"`
}

func SSEOptions(events ...SSEEventDefinition) ResponseOptions {
	return ResponseOptions{Output: SSEOutput, SSE: &SSEDefinition{Events: events}}
}

// StreamSSE 保留流的完整生命周期，适配器在请求上下文内执行写入与清理。
func StreamSSE[Data any](serve func(http.ResponseWriter, *http.Request)) Response[Data] {
	if serve == nil {
		panic("SSE output requires a stream handler")
	}
	return Response[Data]{stream: serve}
}

func (r Response[Data]) Stream() func(http.ResponseWriter, *http.Request) { return r.stream }

func (b *schemaBuilder) sseSchema(definition *SSEDefinition) (*SSESchema, error) {
	if definition != nil && definition.Raw != nil {
		return rawSSESchema(definition)
	}
	if definition == nil || len(definition.Events) == 0 {
		return nil, fmt.Errorf("SSE output requires event declarations")
	}
	result := &SSESchema{Events: map[string]*Schema{}}
	for _, event := range definition.Events {
		if _, exists := result.Events[event.name]; exists {
			return nil, fmt.Errorf("duplicate SSE event: %s", event.name)
		}
		payload, err := b.schema(event.payload, false)
		if err != nil {
			return nil, err
		}
		result.Events[event.name] = payload
	}
	return result, nil
}

// ValidateSSEEvent 独立校验流事件；流建立前的错误由 HTTP 响应契约校验。
func (b *Bundle) ValidateSSEEvent(method, path, name string, payload []byte) error {
	for _, endpoint := range b.Endpoints {
		if endpoint.Method != method || endpoint.Path != path {
			continue
		}
		if endpoint.SSE == nil {
			return fmt.Errorf("endpoint does not declare SSE events")
		}
		if endpoint.SSE.Raw != nil {
			return b.ValidateRawSSEEvent(method, path, name, "", 0, payload)
		}
		schema, exists := endpoint.SSE.Events[name]
		if !exists {
			return fmt.Errorf("undeclared SSE event: %s", name)
		}
		var value any
		if err := json.Unmarshal(payload, &value); err != nil {
			return err
		}
		return b.validate(schema, value, "$")
	}
	return fmt.Errorf("unregistered API contract: %s %s", method, path)
}
