package apicontract

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"reflect"
	"strings"

	"github.com/pelletier/go-toml/v2"
	"google.golang.org/protobuf/encoding/protowire"
	"gopkg.in/yaml.v3"
)

const PluginServiceOutput OutputMode = "pluginService"

type PluginServiceMode string

const (
	PluginServiceJSON         PluginServiceMode = "JSON"
	PluginServiceJSONP        PluginServiceMode = "JSONP"
	PluginServiceASCIIJSON    PluginServiceMode = "AsciiJSON"
	PluginServiceIndentedJSON PluginServiceMode = "IndentedJSON"
	PluginServicePureJSON     PluginServiceMode = "PureJSON"
	PluginServiceSecureJSON   PluginServiceMode = "SecureJSON"
	PluginServiceXML          PluginServiceMode = "XML"
	PluginServiceYAML         PluginServiceMode = "YAML"
	PluginServiceTOML         PluginServiceMode = "TOML"
	PluginServiceProtoBuf     PluginServiceMode = "ProtoBuf"
	PluginServiceFile         PluginServiceMode = "file"
	PluginServiceString       PluginServiceMode = "string"
	PluginServiceRaw          PluginServiceMode = "raw"
	PluginServiceRedirect     PluginServiceMode = "redirect"
	PluginServiceProxy        PluginServiceMode = "proxy"
	PluginServiceEmpty        PluginServiceMode = "empty"
	PluginServiceWebSocket    PluginServiceMode = "websocket"
	PluginServiceSSE          PluginServiceMode = "sse"
	PluginServiceAdmission    PluginServiceMode = "admission"
)

type PluginServiceVariant struct {
	Mode                 PluginServiceMode `json:"mode"`
	StatusPolicy         string            `json:"statusPolicy"`
	MediaTypes           []string          `json:"mediaTypes"`
	Payload              string            `json:"payload"`
	HeadersOverrideMedia bool              `json:"headersOverrideMedia"`
}
type PluginServiceDefinition struct {
	Variants          []PluginServiceVariant `json:"variants"`
	AdmissionStatuses []int                  `json:"admissionStatuses"`
	WebSocketFrames   []string               `json:"webSocketFrames"`
	SSEEventNames     string                 `json:"sseEventNames"`
	SSEData           string                 `json:"sseData"`
	SSEEvent          *Schema                `json:"sseEvent"`
}

// PluginServiceContent 标记扩展服务载荷，具体模式由有限构造器写入响应的私有元数据。
type PluginServiceContent struct{}

func PluginServiceOptions() ResponseOptions {
	variants := []PluginServiceVariant{
		{PluginServiceJSON, "plugin", []string{"application/json"}, "json", true},
		{PluginServiceJSONP, "plugin", []string{"application/javascript", "application/json"}, "jsonp-or-json", true},
		{PluginServiceASCIIJSON, "plugin", []string{"application/json"}, "json", true},
		{PluginServiceIndentedJSON, "plugin", []string{"application/json"}, "json", true},
		{PluginServicePureJSON, "plugin", []string{"application/json"}, "json", true},
		{PluginServiceSecureJSON, "plugin", []string{"application/json"}, "secure-json", true},
		{PluginServiceXML, "plugin", []string{"application/xml"}, "xml", true},
		{PluginServiceYAML, "plugin", []string{"application/yaml"}, "yaml", true},
		{PluginServiceTOML, "plugin", []string{"application/toml"}, "toml", true},
		{PluginServiceProtoBuf, "plugin", []string{"application/x-protobuf"}, "protobuf", true},
		{PluginServiceFile, "file", []string{"dynamic"}, "bytes", true},
		{PluginServiceString, "plugin", []string{"text/plain"}, "text", true},
		{PluginServiceRaw, "plugin", []string{"dynamic"}, "bytes", true},
		{PluginServiceRedirect, "redirect", []string{"text/html"}, "redirect", true},
		{PluginServiceProxy, "proxy", []string{"upstream"}, "bytes", true},
		{PluginServiceEmpty, "plugin", []string{"optional"}, "none", true},
		{PluginServiceWebSocket, "websocket", []string{"upgrade-or-text"}, "frames", false},
		{PluginServiceSSE, "sse", []string{"text/event-stream"}, "events", false},
		{PluginServiceAdmission, "admission", []string{"text/plain"}, "text", true},
	}
	event := object(map[string]*Schema{"event": {Type: "string"}, "id": {Type: "string"}, "retry": {Type: "integer"}, "data": {Ref: "#/$defs/JSONValue"}}, "data")
	return ResponseOptions{Output: PluginServiceOutput, PluginService: &PluginServiceDefinition{Variants: variants, AdmissionStatuses: []int{400, 404, 500, 503}, WebSocketFrames: []string{"text", "binary", "close", "ping", "pong"}, SSEEventNames: "dynamic", SSEData: "json-or-text", SSEEvent: event}}
}

func StreamPluginService(mode PluginServiceMode, status int, serve func(http.ResponseWriter, *http.Request)) Response[PluginServiceContent] {
	if serve == nil {
		panic("plugin service requires a lifecycle")
	}
	if status <= 0 {
		status = 200
	}
	if err := validatePluginServiceStatus(mode, status); err != nil {
		panic(err)
	}
	return Response[PluginServiceContent]{pluginServiceMode: mode, httpStatus: status, stream: serve}
}

func (e Endpoint[Request, Data]) pluginServiceStatus(response Response[Data]) int {
	if e.definition.Output != PluginServiceOutput || e.definition.PluginService == nil {
		panic("endpoint does not declare plugin service output")
	}
	if response.stream == nil {
		if response.code == 0 {
			panic("plugin service requires a selected response mode")
		}
		return 200
	}
	if err := validatePluginServiceStatus(response.pluginServiceMode, response.httpStatus); err != nil {
		panic(err)
	}
	return response.httpStatus
}

func validatePluginServiceDefinition(definition Definition) error {
	if (definition.Output == PluginServiceOutput) != (definition.PluginService != nil) {
		return fmt.Errorf("plugin service output requires a protocol declaration")
	}
	if definition.PluginService == nil {
		return nil
	}
	if definition.Data != reflect.TypeFor[PluginServiceContent]() || definition.SSE != nil || definition.Proxy != nil || definition.WebSocket != nil || definition.DataOnError || definition.ErrorStatus != 0 {
		return fmt.Errorf("invalid plugin service response options")
	}
	if !reflect.DeepEqual(definition.PluginService, PluginServiceOptions().PluginService) {
		return fmt.Errorf("invalid plugin service protocol variants")
	}
	return nil
}

func validatePluginServiceStatus(mode PluginServiceMode, status int) error {
	if status < 100 || status > 999 {
		return fmt.Errorf("invalid plugin service HTTP status: %d", status)
	}
	known := false
	for _, variant := range PluginServiceOptions().PluginService.Variants {
		if variant.Mode == mode {
			known = true
			break
		}
	}
	if !known {
		return fmt.Errorf("unknown plugin service mode: %s", mode)
	}
	switch mode {
	case PluginServiceAdmission:
		if status != 400 && status != 404 && status != 500 && status != 503 {
			return fmt.Errorf("undeclared plugin admission status")
		}
	case PluginServiceRedirect:
		if status != 201 && (status < 300 || status > 308) {
			return fmt.Errorf("invalid plugin redirect status")
		}
	case PluginServiceWebSocket:
		if status != 101 && status != 400 && status != 500 {
			return fmt.Errorf("invalid plugin WebSocket status")
		}
	case PluginServiceSSE:
		if status != 200 && status != 500 {
			return fmt.Errorf("invalid plugin SSE status")
		}
	}
	return nil
}

func (b *Bundle) validatePluginServiceHTTPResponse(endpoint EndpointSchema, status int, contentType string, payload []byte) error {
	if status < 100 || status > 999 {
		return fmt.Errorf("invalid plugin service HTTP status")
	}
	if endpoint.Method == "HEAD" || status < 200 || status == 204 || status == 304 {
		if len(payload) > 0 {
			return fmt.Errorf("plugin service response forbids a body")
		}
		return nil
	}
	// 原始文件、代理及插件自选媒体允许任意字节，具体分支由 ValidatePluginServiceResponse 校验。
	return nil
}

func (b *Bundle) ValidatePluginServiceResponse(method, path string, mode PluginServiceMode, status int, contentType string, payload []byte) error {
	var found bool
	for _, endpoint := range b.Endpoints {
		if endpoint.Method == method && endpoint.Path == path && endpoint.PluginService != nil {
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("unregistered plugin service: %s %s", method, path)
	}
	if err := validatePluginServiceStatus(mode, status); err != nil {
		return err
	}
	if method == "HEAD" || status < 200 || status == 204 || status == 304 {
		if len(payload) != 0 {
			return fmt.Errorf("plugin service response forbids a body")
		}
		return nil
	}
	switch mode {
	case PluginServiceEmpty:
		if len(payload) != 0 {
			return fmt.Errorf("empty plugin response contains a body")
		}
	case PluginServiceJSON, PluginServiceASCIIJSON, PluginServiceIndentedJSON, PluginServicePureJSON:
		if !json.Valid(payload) {
			return fmt.Errorf("invalid plugin JSON response")
		}
	case PluginServiceJSONP:
		valid := json.Valid(payload)
		if tail, ok := strings.CutSuffix(string(payload), ");"); ok {
			for index, char := range tail {
				if char == '(' && json.Valid([]byte(tail[index+1:])) {
					valid = true
					break
				}
			}
		}
		if !valid {
			return fmt.Errorf("invalid plugin JSONP response")
		}
	case PluginServiceSecureJSON:
		if !json.Valid(payload) && !json.Valid([]byte(strings.TrimPrefix(string(payload), "while(1);"))) {
			return fmt.Errorf("invalid plugin secure JSON response")
		}
	case PluginServiceWebSocket:
		if status == 101 && len(payload) != 0 {
			return fmt.Errorf("WebSocket handshake contains a body")
		}
	case PluginServiceXML:
		decoder := xml.NewDecoder(strings.NewReader(string(payload)))
		for {
			if _, err := decoder.Token(); err != nil {
				if err == io.EOF {
					break
				}
				return err
			}
		}
	case PluginServiceYAML:
		var value yaml.Node
		if err := yaml.Unmarshal(payload, &value); err != nil {
			return err
		}
	case PluginServiceTOML:
		var value map[string]any
		if err := toml.Unmarshal(payload, &value); err != nil {
			return err
		}
	case PluginServiceProtoBuf:
		for len(payload) > 0 {
			_, _, size := protowire.ConsumeField(payload)
			if size < 0 {
				return protowire.ParseError(size)
			}
			payload = payload[size:]
		}
	}
	return nil
}

func (b *Bundle) ValidatePluginServiceFrame(method, path string, frameType int, payload []byte) error {
	for _, endpoint := range b.Endpoints {
		if endpoint.Method == method && endpoint.Path == path && endpoint.PluginService != nil {
			if frameType != 1 && frameType != 2 && frameType != 8 && frameType != 9 && frameType != 10 {
				return fmt.Errorf("undeclared plugin WebSocket frame: %d", frameType)
			}
			if frameType >= 8 && len(payload) > 125 {
				return fmt.Errorf("plugin WebSocket control frame exceeds 125 bytes")
			}
			return nil
		}
	}
	return fmt.Errorf("unregistered plugin service: %s %s", method, path)
}

func (b *Bundle) ValidatePluginServiceEvent(method, path string, payload []byte) error {
	for _, endpoint := range b.Endpoints {
		if endpoint.Method == method && endpoint.Path == path && endpoint.PluginService != nil {
			var event any
			if err := json.Unmarshal(payload, &event); err != nil {
				return err
			}
			return b.validate(endpoint.PluginService.SSEEvent, event, "$")
		}
	}
	return fmt.Errorf("unregistered plugin service: %s %s", method, path)
}
