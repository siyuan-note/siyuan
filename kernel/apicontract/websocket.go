package apicontract

import (
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
)

// WebSocketDefinition 分别声明连接升级后的入站、出站消息和升级失败状态。
type WebSocketDefinition struct {
	Incoming      reflect.Type
	Outgoing      reflect.Type
	FailureStatus int
	Raw           *RawWebSocketDefinition
}

func WebSocketOptions[Incoming, Outgoing any](failureStatus int) ResponseOptions {
	return ResponseOptions{Output: WebSocketOutput, WebSocket: &WebSocketDefinition{
		Incoming: reflect.TypeFor[Incoming](), Outgoing: reflect.TypeFor[Outgoing](), FailureStatus: failureStatus,
	}}
}

// UpgradeWebSocket 延迟升级，使契约适配器在响应阶段接管连接生命周期。
func UpgradeWebSocket[Data any](serve func(http.ResponseWriter, *http.Request)) Response[Data] {
	if serve == nil {
		panic("WebSocket upgrade requires a connection handler")
	}
	return Response[Data]{upgrade: serve}
}

func RejectWebSocket[Data any](data Data) Response[Data] {
	return Response[Data]{data: data, websocketFailure: true}
}

func (r Response[Data]) Upgrade() func(http.ResponseWriter, *http.Request) { return r.upgrade }

// ValidateWebSocketMessage 校验消息载荷，不将 HTTP 中间件信封混入连接内的消息协议。
func (b *Bundle) ValidateWebSocketMessage(method, path string, incoming bool, payload []byte) error {
	for _, endpoint := range b.Endpoints {
		if endpoint.Method != method || endpoint.Path != path {
			continue
		}
		if endpoint.WebSocket == nil {
			return fmt.Errorf("endpoint does not declare WebSocket messages")
		}
		if endpoint.WebSocket.Raw != nil {
			return nil
		}
		schema := endpoint.WebSocket.Outgoing
		if incoming {
			schema = endpoint.WebSocket.Incoming
		}
		var value any
		if err := json.Unmarshal(payload, &value); err != nil {
			return err
		}
		return b.validate(schema, value, "$")
	}
	return fmt.Errorf("unregistered API contract: %s %s", method, path)
}
