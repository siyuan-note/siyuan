// SiYuan - From thought to insight, with agents
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

package plugin

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/lxzan/gws"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type JsonRpcErrorCode int

const (
	JsonRpcVersion = "2.0"

	JsonRpcErrorCodeParseError     JsonRpcErrorCode = -32700
	JsonRpcErrorCodeInvalidRequest JsonRpcErrorCode = -32600
	JsonRpcErrorCodeMethodNotFound JsonRpcErrorCode = -32601
	JsonRpcErrorCodeInvalidParams  JsonRpcErrorCode = -32602
	JsonRpcErrorCodeInternalError  JsonRpcErrorCode = -32603

	// Server-defined error codes (-32099 to -32000)
	JsonRpcErrorCodePluginNotLoaded  JsonRpcErrorCode = -32001
	JsonRpcErrorCodePluginNotRunning JsonRpcErrorCode = -32002
)

var (
	JsonRpcErrorParseError     = &JsonRpcError{Code: JsonRpcErrorCodeParseError, Message: "Parse error"}
	JsonRpcErrorInvalidRequest = &JsonRpcError{Code: JsonRpcErrorCodeInvalidRequest, Message: "Invalid Request"}
	JsonRpcErrorMethodNotFound = &JsonRpcError{Code: JsonRpcErrorCodeMethodNotFound, Message: "Method not found"}
	JsonRpcErrorInvalidParams  = &JsonRpcError{Code: JsonRpcErrorCodeInvalidParams, Message: "Invalid params"}
	JsonRpcErrorInternalError  = &JsonRpcError{Code: JsonRpcErrorCodeInternalError, Message: "Internal error"}

	JsonRpcErrorPluginNotLoaded  = &JsonRpcError{Code: JsonRpcErrorCodePluginNotLoaded, Message: "Plugin not loaded"}
	JsonRpcErrorPluginNotRunning = &JsonRpcError{Code: JsonRpcErrorCodePluginNotRunning, Message: "Plugin not running"}
)

func (e *JsonRpcError) Error() string {
	return fmt.Sprintf("JSON RPC Error: %d %s", e.Code, e.Message)
}

// JsonRpcRequest represents a JSON-RPC 2.0 request.
type JsonRpcRequest struct {
	JsonRpc string             `json:"jsonrpc"`
	Method  string             `json:"method"`
	Params  util.Optional[any] `json:"params"`
	ID      util.Optional[any] `json:"id"`
}

func (r JsonRpcRequest) MarshalJSON() ([]byte, error) {
	m := map[string]any{
		"jsonrpc": r.JsonRpc,
		"method":  r.Method,
	}
	if r.Params.Exists {
		if r.Params.IsNull {
			m["params"] = nil
		} else {
			m["params"] = r.Params.Value
		}
	}
	if r.ID.Exists {
		if r.ID.IsNull {
			m["id"] = nil
		} else {
			m["id"] = r.ID.Value
		}
	}
	return json.Marshal(m)
}

func (r *JsonRpcRequest) UnmarshalJSON(data []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	// decoder.DisallowUnknownFields() // Reject unknown fields violates the JSON-RPC spec
	type JsonRpcRequestObject struct {
		JsonRpc util.Optional[string] `json:"jsonrpc"`
		Method  util.Optional[string] `json:"method"`
		Params  util.Optional[any]    `json:"params"`
		ID      util.Optional[any]    `json:"id"`
	}
	request := JsonRpcRequestObject{}
	if err := decoder.Decode(&request); err != nil {
		return err
	}

	// Validate jsonrpc field
	if !request.JsonRpc.Exists {
		return fmt.Errorf("missing jsonrpc field")
	}
	if request.JsonRpc.Value != JsonRpcVersion {
		return fmt.Errorf("invalid jsonrpc version: %s", request.JsonRpc.Value)
	}

	// Validate method field
	if !request.Method.HasValue() {
		return fmt.Errorf("missing method field")
	}

	// Validate id field
	if !request.ID.Exists {
	} else if request.ID.IsNull {
	} else if _, ok := request.ID.Value.(string); ok {
	} else if _, ok := request.ID.Value.(float64); ok {
	} else {
		return fmt.Errorf("invalid id field: must be string, number, null or omitted")
	}

	r.JsonRpc = request.JsonRpc.Value
	r.Method = request.Method.Value
	r.Params = request.Params
	r.ID = request.ID
	return nil
}

// IsNotification returns true if this request is a notification (no ID field).
func (r *JsonRpcRequest) IsNotification() bool {
	return r.ID.Exists == false
}

// Validate validates the JSON-RPC request structure.
func (r *JsonRpcRequest) Validate() *JsonRpcError {
	// params is optional, but if present must be either an array (for positional parameters) or an object (for named parameters)
	if !r.Params.Exists {
	} else if _, ok := r.Params.Value.([]any); ok {
	} else if _, ok := r.Params.Value.(map[string]any); ok {
	} else {
		return &JsonRpcError{
			Code:    JsonRpcErrorCodeInvalidParams,
			Message: JsonRpcErrorInvalidParams.Message,
			Data:    "Invalid params: must be array or object if present",
		}
	}

	// ✅ jsonrpc, method and id fields are validated during unmarshaling, so do not need to validate again here.

	// if r.JsonRpc != JsonRpcVersion {
	// 	return JsonRpcErrorInvalidRequest
	// }

	// if !r.ID.Exists {
	// } else if r.ID.IsNull {
	// } else if _, ok := r.ID.Value.(string); ok {
	// } else if _, ok := r.ID.Value.(float64); ok {
	// } else {
	// 	return JsonRpcErrorInvalidRequest
	// }

	return nil
}

// JsonRpcRequestResponse represents a JSON-RPC 2.0 success response.
// result MUST be present (even if null); error MUST NOT be present.
type JsonRpcRequestResponse struct {
	JsonRpc string `json:"jsonrpc"`
	Result  any    `json:"result"`
	ID      any    `json:"id"`
}

// JsonRpcErrorResponse represents a JSON-RPC 2.0 error response.
// error MUST be present; result MUST NOT be present.
type JsonRpcErrorResponse struct {
	JsonRpc string        `json:"jsonrpc"`
	Error   *JsonRpcError `json:"error"`
	ID      any           `json:"id"`
}

// JsonRpcError represents a JSON-RPC 2.0 error.
type JsonRpcError struct {
	Code    JsonRpcErrorCode `json:"code"`
	Message string           `json:"message"`
	Data    any              `json:"data,omitempty"`
}

// JsonRpcProcessingRequest represents the result of parsing and validating a single JSON-RPC request, including any error if the request is invalid.
type JsonRpcProcessingRequest struct {
	Request *JsonRpcRequest       // The parsed request, or nil if the request was invalid
	Error   *JsonRpcErrorResponse // The error if the request was invalid, or nil if the request is valid
}

// JsonRpcProcessingResponse represents the response to a JSON-RPC request, including either the success response or the error response (but not both).
//   - For notifications, both fields will be nil, indicating that no response should be sent.
//   - For successful requests, Response will be non-nil and Error will be nil.
//   - For failed requests, Error will be non-nil and Response will be nil.
type JsonRpcProcessingResponse struct {
	Response *JsonRpcRequestResponse // The success response, or nil if the request was a notification or the response is an error
	Error    *JsonRpcErrorResponse   // The error response, or nil if the request was a notification or the response is a success
}

func (p *KernelPlugin) serveRPCWebSocket(writer http.ResponseWriter, request *http.Request) {
	name := p.Name
	if !strings.EqualFold(request.Header.Get("Upgrade"), "websocket") || !strings.Contains(strings.ToLower(request.Header.Get("Connection")), "upgrade") {
		writer.Header().Set("Content-Type", "text/plain; charset=utf-8")
		writer.WriteHeader(http.StatusBadRequest)
		_, _ = io.WriteString(writer, "This endpoint only accepts WebSocket connections")
		return
	}

	h := &WsEventHandler{p: p}

	h.onMessage = func(socket *gws.Conn, message *gws.Message) {
		defer message.Close()

		request, err := apicontract.DecodePluginRPC(bytes.NewReader(message.Bytes()))
		if err != nil {
			logging.LogErrorf("[plugin:%s] RPC WebSocket request read failed: %s", name, err)
			return
		}
		// WebSocket 调用随插件停止退出，不使用 HTTP 握手请求的上下文。
		response, err := p.dispatchRPCContract(p.context, request)
		if err != nil {
			logging.LogErrorf("[plugin:%s] RPC response marshal failed: %s", name, err)
			return
		}
		if response == nil {
			return
		}
		responseBytes, err := json.Marshal(apicontract.RPCResponseMessage(*response))
		if err != nil {
			logging.LogErrorf("[plugin:%s] RPC response marshal failed: %s", name, err)
			return
		}
		socket.WriteAsync(gws.OpcodeText, responseBytes, func(err error) {
			if err != nil {
				logging.LogWarnf("[plugin:%s] RPC WebSocket response write failed: %s", name, err)
			}
		})
	}

	upgrader := gws.NewUpgrader(h, &gws.ServerOption{
		// 校验 Origin，防止跨站 WebSocket 劫持（CSWSH） https://github.com/siyuan-note/siyuan/security/advisories/GHSA-3cc2-h3v6-rqpq
		Authorize: func(r *http.Request, _ gws.SessionStorage) bool {
			return util.IsSessionOriginAllowedRequest(r)
		},
	})
	socket, err := upgrader.Upgrade(writer, request)
	if err != nil {
		logging.LogErrorf("[plugin:%s] RPC WebSocket upgrade failed: %s", name, err)
		return
	}

	ctx, cancel := context.WithCancel(p.context)

	var openOnce sync.Once
	var closeOnce sync.Once

	doOpen := func() {
		go openOnce.Do(func() {
			p.TrackRpcSocket(socket)
			socket.ReadLoop()
			cancel()
		})
	}

	doClose := func() {
		closeOnce.Do(func() {
			p.UntrackRpcSocket(socket)
			socket.NetConn().Close()
			cancel()
		})
	}

	defer doClose()
	doOpen()
	<-ctx.Done()
}
