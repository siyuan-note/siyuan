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

package plugin

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	JsonRpcVersion                 = "2.0"
	JsonRpcErrorCodeParseError     = -32700
	JsonRpcErrorCodeInvalidRequest = -32600
	JsonRpcErrorCodeMethodNotFound = -32601
	JsonRpcErrorCodeInvalidParams  = -32602
	JsonRpcErrorCodeInternalError  = -32603
)

var (
	JsonRpcErrorParseError     = &JsonRpcError{Code: JsonRpcErrorCodeParseError, Message: "Parse error"}
	JsonRpcErrorInvalidRequest = &JsonRpcError{Code: JsonRpcErrorCodeInvalidRequest, Message: "Invalid Request"}
	JsonRpcErrorMethodNotFound = &JsonRpcError{Code: JsonRpcErrorCodeMethodNotFound, Message: "Method not found"}
	JsonRpcErrorInvalidParams  = &JsonRpcError{Code: JsonRpcErrorCodeInvalidParams, Message: "Invalid params"}
	JsonRpcErrorInternalError  = &JsonRpcError{Code: JsonRpcErrorCodeInternalError, Message: "Internal error"}
)

// JsonRpcRequest represents a JSON-RPC 2.0 request.
type JsonRpcRequest struct {
	JsonRpc string          `json:"jsonrpc"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
	ID      *any            `json:"id,omitempty"`
}

// IsNotification returns true if this request is a notification (no ID field).
func (r *JsonRpcRequest) IsNotification() bool {
	return r.ID == nil
}

// Validate validates the JSON-RPC request structure.
func (r *JsonRpcRequest) Validate() *JsonRpcError {
	if r.JsonRpc != JsonRpcVersion {
		return &JsonRpcError{Code: JsonRpcErrorCodeInvalidRequest, Message: "Invalid jsonrpc version"}
	}
	if strings.TrimSpace(r.Method) == "" {
		return &JsonRpcError{Code: JsonRpcErrorCodeInvalidRequest, Message: "Method is required"}
	}
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
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

// HandleRpcHttp handles POST /api/plugin/rpc/:name
// Supports single call, batch call, and notification (no response for notification).
func HandleRpcHttp(c *gin.Context) {
	name := util.GetRequestUrlStringParam(c, "name")
	p := GetManager().GetPlugin(name)
	if p == nil || p.State() != StateRunning {
		c.JSON(http.StatusOK, &JsonRpcErrorResponse{
			JsonRpc: JsonRpcVersion,
			Error:   &JsonRpcError{Code: JsonRpcErrorCodeMethodNotFound, Message: "Plugin not found or not running"},
		})
		return
	}

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusOK, &JsonRpcErrorResponse{
			JsonRpc: JsonRpcVersion,
			Error:   JsonRpcErrorParseError,
		})
		return
	}

	requests, isBatch, jsonErr := parseRequests(body)
	if jsonErr != nil {
		c.JSON(http.StatusOK, &JsonRpcErrorResponse{
			JsonRpc: JsonRpcVersion,
			Error:   jsonErr,
		})
		return
	}

	responses := dispatchRequests(p, requests)

	if !isBatch {
		// Single request - return single response (or empty for notification)
		if len(responses) > 0 && responses[0] != nil {
			c.JSON(http.StatusOK, responses[0])
		} else {
			c.Status(http.StatusNoContent)
		}
		return
	}

	// Batch request - filter out nil responses (notifications) and return array
	filtered := make([]any, 0, len(responses))
	for _, resp := range responses {
		if resp != nil {
			filtered = append(filtered, resp)
		}
	}

	if len(filtered) > 0 {
		c.JSON(http.StatusOK, filtered)
	} else {
		// All notifications in batch - send nothing per spec (MUST NOT return empty array)
		c.Status(http.StatusNoContent)
	}
}

// HandleRpcWebSocket handles GET /ws/plugin/rpc/:name
// Supports single call, batch call, notification, and server push notifications.
func HandleRpcWebSocket(c *gin.Context) {
	name := util.GetRequestUrlStringParam(c, "name")
	p := GetManager().GetPlugin(name)
	if p == nil || p.State() != StateRunning {
		c.JSON(http.StatusNotFound, &JsonRpcErrorResponse{
			JsonRpc: JsonRpcVersion,
			Error:   &JsonRpcError{Code: JsonRpcErrorCodeMethodNotFound, Message: "Plugin not found or not running"},
		})
		return
	}

	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		logging.LogErrorf("[plugin:%s] ws upgrade failed: %s", name, err)
		return
	}
	defer conn.Close()

	// Track this connection for server push notifications
	p.TrackSocket(conn)
	defer p.UntrackSocket(conn)

	for {
		_, message, readErr := conn.ReadMessage()
		if readErr != nil {
			if websocket.IsUnexpectedCloseError(readErr, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				logging.LogErrorf("[plugin:%s] ws read error: %s", name, readErr)
			}
			break
		}

		requests, isBatch, jsonErr := parseRequests(message)
		if jsonErr != nil {
			writeWsResponse(conn, &JsonRpcErrorResponse{
				JsonRpc: JsonRpcVersion,
				Error:   jsonErr,
			})
			continue
		}

		responses := dispatchRequests(p, requests)

		if !isBatch {
			// Single request - send response only if not a notification
			if len(responses) > 0 && responses[0] != nil {
				writeWsResponse(conn, responses[0])
			}
			continue
		}

		// Batch request - filter out nil responses (notifications)
		filtered := make([]any, 0, len(responses))
		for _, resp := range responses {
			if resp != nil {
				filtered = append(filtered, resp)
			}
		}

		// Send batch response; if all were notifications, send nothing per spec
		if len(filtered) > 0 {
			writeWsResponse(conn, filtered)
		}
	}
}

// isBatchRequest checks if the body is a batch request (starts with '[' and ends with ']').
func isBatchRequest(body []byte) bool {
	body = bytes.Trim(body, " \t\n\r")
	return len(body) > 0 && body[0] == '[' && body[len(body)-1] == ']'
}

// parseRequests parses JSON-RPC requests from the body.
// Returns requests and a boolean indicating if it's a batch request.
func parseRequests(body []byte) (requests []*JsonRpcRequest, isBatch bool, jsonErr *JsonRpcError) {
	if len(body) == 0 {
		return nil, false, JsonRpcErrorParseError
	}

	if isBatchRequest(body) {
		var requests []*JsonRpcRequest
		if err := json.Unmarshal(body, &requests); err != nil {
			return nil, true, JsonRpcErrorParseError
		}
		if len(requests) == 0 {
			return nil, true, JsonRpcErrorInvalidRequest
		}
		return requests, true, nil
	}

	var req JsonRpcRequest
	if err := json.Unmarshal(body, &req); err != nil {
		return nil, false, JsonRpcErrorParseError
	}
	return []*JsonRpcRequest{&req}, false, nil
}

// writeWsResponse writes a response to the WebSocket connection.
func writeWsResponse(conn *websocket.Conn, data any) {
	respBytes, err := json.Marshal(data)
	if err != nil {
		logging.LogErrorf("failed to marshal ws response: %s", err)
		return
	}
	if err := conn.WriteMessage(websocket.TextMessage, respBytes); err != nil {
		logging.LogErrorf("failed to write ws message: %s", err)
	}
}

// dispatchRequests dispatches multiple JSON-RPC requests concurrently.
// Returns responses in the same order as requests. Nil responses indicate notifications.
func dispatchRequests(p *KernelPlugin, requests []*JsonRpcRequest) []any {
	responses := make([]any, len(requests))
	var wg sync.WaitGroup

	for i, req := range requests {
		if req.IsNotification() {
			go func(request *JsonRpcRequest) {
				dispatchRPC(p, request)
			}(req)
			continue
		}
		wg.Add(1)
		go func(index int, request *JsonRpcRequest) {
			defer wg.Done()
			responses[index] = dispatchRPC(p, request)
		}(i, req)
	}

	wg.Wait()
	return responses
}

// dispatchRPC routes a single JSON-RPC request to the plugin's registered JS method.
// Returns nil for notifications (no ID field).
func dispatchRPC(p *KernelPlugin, req *JsonRpcRequest) any {
	// Validate request structure
	if err := req.Validate(); err != nil {
		if req.IsNotification() {
			return nil
		}
		return &JsonRpcErrorResponse{
			JsonRpc: JsonRpcVersion,
			Error:   err,
			ID:      req.ID,
		}
	}

	// Parse params from raw JSON
	var params any
	if len(req.Params) > 0 {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			if req.IsNotification() {
				return nil
			}
			return &JsonRpcErrorResponse{
				JsonRpc: JsonRpcVersion,
				Error:   JsonRpcErrorInvalidParams,
				ID:      req.ID,
			}
		}
	}

	result, err := p.CallRpcMethod(req.Method, params)

	// For notifications, return nil (no response)
	if req.IsNotification() {
		return nil
	}

	if err != nil {
		code := JsonRpcErrorCodeInternalError
		if errors.Is(err, ErrMethodNotFound) || errors.Is(err, ErrPluginNotRunning) {
			code = JsonRpcErrorCodeMethodNotFound
		}
		return &JsonRpcErrorResponse{
			JsonRpc: JsonRpcVersion,
			Error: &JsonRpcError{
				Code:    code,
				Message: err.Error(),
			},
			ID: req.ID,
		}
	}

	return &JsonRpcRequestResponse{
		JsonRpc: JsonRpcVersion,
		Result:  result,
		ID:      req.ID,
	}
}

// PushNotification sends a server-to-client notification via WebSocket.
// This is used for the server to push notifications to connected clients.
func PushNotification(conn *websocket.Conn, method string, params any) error {
	notification := struct {
		JsonRpc string `json:"jsonrpc"`
		Method  string `json:"method"`
		Params  any    `json:"params"`
	}{
		JsonRpc: JsonRpcVersion,
		Method:  method,
		Params:  params,
	}

	data, err := json.Marshal(notification)
	if err != nil {
		return fmt.Errorf("marshal notification: %w", err)
	}

	if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
		return fmt.Errorf("write notification: %w", err)
	}
	return nil
}
