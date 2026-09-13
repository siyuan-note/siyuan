package apicontract

import (
	"fmt"
	"mime"
	"reflect"
)

type RawSSEDefinition struct {
	EventNames   string `json:"eventNames"`
	DataEncoding string `json:"dataEncoding"`
	ID           bool   `json:"id"`
	Retry        bool   `json:"retry"`
}

type RawWebSocketDefinition struct {
	Frames               []int `json:"frames"`
	UpgradeErrorStatuses []int `json:"upgradeErrorStatuses"`
	EmptyClosedResponse  bool  `json:"emptyClosedResponse"`
}

func RawSSEOptions() ResponseOptions {
	return ResponseOptions{Output: SSEOutput, SSE: &SSEDefinition{Raw: &RawSSEDefinition{EventNames: "dynamic", DataEncoding: "raw", ID: true, Retry: true}}}
}

func RawWebSocketOptions() ResponseOptions {
	return ResponseOptions{Output: WebSocketOutput, WebSocket: &WebSocketDefinition{Raw: &RawWebSocketDefinition{Frames: []int{1, 2, 8, 9, 10}, UpgradeErrorStatuses: []int{400, 403, 405, 500}, EmptyClosedResponse: true}}}
}

func rawSSESchema(definition *SSEDefinition) (*SSESchema, error) {
	if len(definition.Events) != 0 || !reflect.DeepEqual(definition.Raw, RawSSEOptions().SSE.Raw) {
		return nil, fmt.Errorf("invalid raw SSE event declaration")
	}
	return &SSESchema{Raw: definition.Raw}, nil
}

func rawWebSocketSchema(definition *WebSocketDefinition) (*WebSocketSchema, error) {
	if definition.Incoming != nil || definition.Outgoing != nil || definition.FailureStatus != 0 || !reflect.DeepEqual(definition.Raw, RawWebSocketOptions().WebSocket.Raw) {
		return nil, fmt.Errorf("invalid raw WebSocket declaration")
	}
	return &WebSocketSchema{Incoming: &Schema{Type: "string", Format: "binary"}, Outgoing: &Schema{Type: "string", Format: "binary"}, Raw: definition.Raw}, nil
}

func validateRawWebSocketHTTP(schema *WebSocketSchema, status int, contentType string, payload []byte) (bool, error) {
	if schema.Raw == nil {
		return false, nil
	}
	if status == 101 {
		if len(payload) != 0 {
			return true, fmt.Errorf("WebSocket upgrade cannot contain a body")
		}
		return true, nil
	}
	if status == 200 && len(payload) == 0 && schema.Raw.EmptyClosedResponse {
		return true, nil
	}
	media, _, _ := mime.ParseMediaType(contentType)
	for _, allowed := range schema.Raw.UpgradeErrorStatuses {
		if status == allowed && media == "text/plain" {
			return true, nil
		}
	}
	return false, nil
}

// ValidateRawSSEEvent 校验事件协议；事件数据是原始字节，不进行 JSON 解码或 Base64 转码。
func (b *Bundle) ValidateRawSSEEvent(method, path, name, id string, retry uint, payload []byte) error {
	for _, endpoint := range b.Endpoints {
		if endpoint.Method == method && endpoint.Path == path {
			if endpoint.SSE == nil || endpoint.SSE.Raw == nil {
				return fmt.Errorf("endpoint does not declare raw SSE events")
			}
			return nil
		}
	}
	return fmt.Errorf("unregistered API contract: %s %s", method, path)
}

func (b *Bundle) ValidateRawWebSocketFrame(method, path string, incoming bool, frameType int, payload []byte) error {
	for _, endpoint := range b.Endpoints {
		if endpoint.Method == method && endpoint.Path == path {
			if endpoint.WebSocket == nil || endpoint.WebSocket.Raw == nil {
				return fmt.Errorf("endpoint does not declare raw WebSocket frames")
			}
			for _, allowed := range endpoint.WebSocket.Raw.Frames {
				if frameType == allowed {
					if frameType >= 8 && len(payload) > 125 {
						return fmt.Errorf("WebSocket control frame exceeds 125 bytes")
					}
					return nil
				}
			}
			return fmt.Errorf("undeclared raw WebSocket frame: %d", frameType)
		}
	}
	return fmt.Errorf("unregistered API contract: %s %s", method, path)
}
