package apicontract

import (
	"encoding/json"
	"fmt"
	"mime"
	"net/http"
	"reflect"
)

const RawBody BodyMode = "raw"
const ProxyOutput OutputMode = "proxy"

type ProxyKind string

const (
	HTTPProxy        ProxyKind = "http"
	EventSourceProxy ProxyKind = "eventSource"
	WebSocketProxy   ProxyKind = "websocket"
)

// ProxyDefinition 明确上游字节或帧透传，不将上游状态解释为内核业务结果。
type ProxyDefinition struct {
	Kind             ProxyKind `json:"kind"`
	ContentType      string    `json:"contentType,omitempty"`
	UpstreamStatuses bool      `json:"upstreamStatuses"`
	Frames           []string  `json:"frames,omitempty"`
}

type ProxyFailure struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
}

func ProxyOptions(kind ProxyKind) ResponseOptions {
	definition := &ProxyDefinition{Kind: kind, UpstreamStatuses: true}
	switch kind {
	case HTTPProxy:
		definition.ContentType = "application/octet-stream"
	case EventSourceProxy:
		definition.ContentType = "text/event-stream"
	case WebSocketProxy:
		definition.UpstreamStatuses = false
		definition.Frames = []string{"text", "binary", "close"}
	default:
		panic("unsupported proxy protocol")
	}
	return ResponseOptions{Output: ProxyOutput, Proxy: definition}
}

func StreamProxy(status int, serve func(http.ResponseWriter, *http.Request)) Response[ProxyFailure] {
	if serve == nil {
		panic("proxy response requires a stream lifecycle")
	}
	return Response[ProxyFailure]{httpStatus: status, stream: serve}
}

func RejectProxy(status int, message string) Response[ProxyFailure] {
	return Response[ProxyFailure]{httpStatus: status, directJSON: true, data: ProxyFailure{Code: -1, Msg: message}}
}

func (e Endpoint[Request, Data]) proxyStatus(response Response[Data]) int {
	definition := e.definition.Proxy
	if e.definition.Output != ProxyOutput || definition == nil {
		panic("endpoint does not declare proxy output")
	}
	if response.stream != nil {
		if definition.Kind == WebSocketProxy {
			if response.httpStatus != 101 {
				panic("WebSocket proxy requires upgrade status")
			}
		} else if response.httpStatus < 100 || response.httpStatus > 999 {
			panic("invalid upstream proxy status")
		}
		return response.httpStatus
	}
	if response.directJSON {
		if response.httpStatus != 400 && response.httpStatus != 502 {
			panic("undeclared proxy rejection status")
		}
		return response.httpStatus
	}
	if response.code == 0 {
		panic("proxy response requires a stream or rejection")
	}
	return 200
}

func validateProxyDefinition(definition Definition) error {
	if (definition.Output == ProxyOutput) != (definition.Proxy != nil) {
		return fmt.Errorf("proxy output requires a protocol declaration: %s", definition.Name)
	}
	if definition.Proxy == nil {
		return nil
	}
	if definition.Proxy.Kind != HTTPProxy && definition.Proxy.Kind != EventSourceProxy && definition.Proxy.Kind != WebSocketProxy {
		return fmt.Errorf("unsupported proxy protocol: %s", definition.Proxy.Kind)
	}
	if definition.Data != reflect.TypeFor[ProxyFailure]() || definition.DataOnError || definition.ErrorStatus != 0 || definition.SSE != nil || definition.WebSocket != nil {
		return fmt.Errorf("invalid proxy response options: %s", definition.Name)
	}
	want := ProxyOptions(definition.Proxy.Kind).Proxy
	if !reflect.DeepEqual(want, definition.Proxy) {
		return fmt.Errorf("invalid proxy protocol declaration: %s", definition.Name)
	}
	return nil
}

// validateProxyHTTPResponse 按媒体类型区分上游字节和内核准入失败，同状态不代表同协议。
func (b *Bundle) validateProxyHTTPResponse(endpoint EndpointSchema, status int, contentType string, payload []byte) error {
	definition := endpoint.Proxy
	media, _, _ := mime.ParseMediaType(contentType)
	if definition.Kind != WebSocketProxy && endpoint.Method == "HEAD" {
		if len(payload) != 0 {
			return fmt.Errorf("HEAD proxy response forbids a body")
		}
		if status >= 100 && status <= 999 && (media == "" || media == definition.ContentType || media == "application/json") {
			return nil
		}
	}
	if definition.Kind != WebSocketProxy && (status < 200 || status == 204 || status == 304) && media == "" && status >= 100 && len(payload) == 0 {
		return nil
	}
	if definition.Kind == WebSocketProxy {
		if status == 101 && len(payload) == 0 {
			return nil
		}
		if (status == 400 || status == 403 || status == 405 || status == 500) && media == "text/plain" {
			return nil
		}
	} else if status >= 100 && status <= 999 && media == definition.ContentType {
		if (endpoint.Method == "HEAD" || status < 200 || status == 204 || status == 304) && len(payload) != 0 {
			return fmt.Errorf("proxy response status/method forbids a body")
		}
		return nil
	}
	if media != "application/json" {
		return fmt.Errorf("undeclared proxy response media/status: %d %s", status, contentType)
	}
	var value any
	if err := json.Unmarshal(payload, &value); err != nil {
		return err
	}
	if status == 400 || status == 502 {
		return b.validate(object(map[string]*Schema{"code": {Type: "integer", Enum: []any{-1}}, "msg": {Type: "string"}}, "code", "msg"), value, "$")
	}
	if status != 200 {
		return fmt.Errorf("undeclared proxy middleware status: %d", status)
	}
	return b.validate(endpoint.Response.AnyOf[1], value, "$")
}

func (b *Bundle) ValidateProxyFrame(method, path string, frameType int, payload []byte) error {
	for _, endpoint := range b.Endpoints {
		if endpoint.Method != method || endpoint.Path != path {
			continue
		}
		if endpoint.Proxy == nil || endpoint.Proxy.Kind != WebSocketProxy {
			return fmt.Errorf("endpoint does not declare WebSocket proxy frames")
		}
		if frameType != 1 && frameType != 2 && frameType != 8 {
			return fmt.Errorf("undeclared forwarded WebSocket frame type: %d", frameType)
		}
		return nil
	}
	return fmt.Errorf("unregistered API contract: %s %s", method, path)
}
