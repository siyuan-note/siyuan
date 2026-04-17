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
	"encoding/json"
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

// JsonRpcResponse represents a JSON-RPC 2.0 response.
type JsonRpcResponse struct {
	JsonRpc string        `json:"jsonrpc"`
	Result  any           `json:"result,omitempty"`
	Error   *JsonRpcError `json:"error,omitempty"`
	ID      any           `json:"id,omitempty"`
}

// JsonRpcError represents a JSON-RPC 2.0 error.
type JsonRpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

// IsBatchRequest checks if the body is a batch request (starts with '[').
func IsBatchRequest(body []byte) bool {
	for _, b := range body {
		if b == ' ' || b == '\t' || b == '\n' || b == '\r' {
			continue
		}
		return b == '['
	}
	return false
}

// ParseRequests parses JSON-RPC requests from the body.
// Returns requests and a boolean indicating if it's a batch request.
func ParseRequests(body []byte) ([]*JsonRpcRequest, bool, *JsonRpcError) {
	if len(body) == 0 {
		return nil, false, JsonRpcErrorParseError
	}

	if IsBatchRequest(body) {
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

// HandleRpcHttp handles POST /api/plugin/rpc/:name
// Supports single call, batch call, and notification (no response for notification).
func HandleRpcHttp(c *gin.Context) {
	name := util.GetRequestUrlStringParam(c, "name")
	kp := GetManager().GetPlugin(name)
	if kp == nil || kp.State() != StateRunning {
		resp := JsonRpcResponse{
			JsonRpc: JsonRpcVersion,
			Error:   &JsonRpcError{Code: JsonRpcErrorCodeMethodNotFound, Message: "Plugin not found or not running"},
		}
		c.JSON(http.StatusOK, resp)
		return
	}

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, JsonRpcResponse{
			JsonRpc: JsonRpcVersion,
			Error:   JsonRpcErrorParseError,
		})
		return
	}

	requests, isBatch, jsonErr := ParseRequests(body)
	if jsonErr != nil {
		c.JSON(http.StatusOK, JsonRpcResponse{
			JsonRpc: JsonRpcVersion,
			Error:   jsonErr,
		})
		return
	}

	responses := dispatchRequests(kp, requests)

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
	filtered := make([]*JsonRpcResponse, 0, len(responses))
	for _, resp := range responses {
		if resp != nil {
			filtered = append(filtered, resp)
		}
	}

	if len(filtered) > 0 {
		c.JSON(http.StatusOK, filtered)
	} else {
		// All notifications in batch - return empty array per spec
		c.JSON(http.StatusOK, []*JsonRpcResponse{})
	}
}

// HandleRpcWebSocket handles GET /ws/plugin/rpc/:name
// Supports single call, batch call, notification, and server push notifications.
func HandleRpcWebSocket(c *gin.Context) {
	name := util.GetRequestUrlStringParam(c, "name")
	kp := GetManager().GetPlugin(name)
	if kp == nil || kp.State() != StateRunning {
		c.JSON(http.StatusNotFound, JsonRpcResponse{
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
	kp.TrackSocket(conn)
	defer kp.UntrackSocket(conn)

	for {
		_, message, readErr := conn.ReadMessage()
		if readErr != nil {
			if websocket.IsUnexpectedCloseError(readErr, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				logging.LogErrorf("[plugin:%s] ws read error: %s", name, readErr)
			}
			break
		}

		requests, isBatch, jsonErr := ParseRequests(message)
		if jsonErr != nil {
			resp := JsonRpcResponse{
				JsonRpc: JsonRpcVersion,
				Error:   jsonErr,
			}
			writeWsResponse(conn, &resp)
			continue
		}

		responses := dispatchRequests(kp, requests)

		if !isBatch {
			// Single request - send response only if not a notification
			if len(responses) > 0 && responses[0] != nil {
				writeWsResponse(conn, responses[0])
			}
			continue
		}

		// Batch request - filter out nil responses (notifications)
		filtered := make([]*JsonRpcResponse, 0, len(responses))
		for _, resp := range responses {
			if resp != nil {
				filtered = append(filtered, resp)
			}
		}

		// Send batch response (empty array if all were notifications)
		if len(filtered) == 0 {
			filtered = []*JsonRpcResponse{}
		}
		writeWsResponse(conn, filtered)
	}
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
func dispatchRequests(p *KernelPlugin, requests []*JsonRpcRequest) []*JsonRpcResponse {
	responses := make([]*JsonRpcResponse, len(requests))
	var wg sync.WaitGroup

	for i, req := range requests {
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
func dispatchRPC(p *KernelPlugin, req *JsonRpcRequest) *JsonRpcResponse {
	// Validate request structure
	if err := req.Validate(); err != nil {
		// For validation errors, still return error even for notifications
		return &JsonRpcResponse{
			JsonRpc: JsonRpcVersion,
			Error:   err,
			ID:      req.ID,
		}
	}

	// Parse params from raw JSON
	var params any
	if len(req.Params) > 0 {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return &JsonRpcResponse{
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
		if err.Error() == fmt.Sprintf("method %q not found", req.Method) ||
			contains(err.Error(), "plugin not running") {
			code = JsonRpcErrorCodeMethodNotFound
		}
		return &JsonRpcResponse{
			JsonRpc: JsonRpcVersion,
			Error: &JsonRpcError{
				Code:    code,
				Message: err.Error(),
			},
			ID: req.ID,
		}
	}

	return &JsonRpcResponse{
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

// BroadcastNotification broadcasts a notification to all connected WebSocket clients for a plugin.
func (p *KernelPlugin) BroadcastNotification(method string, params any) {
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
		logging.LogErrorf("[plugin:%s] failed to marshal broadcast: %s", p.Name, err)
		return
	}

	p.mu.RLock()
	defer p.mu.RUnlock()

	for conn := range p.sockets {
		if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
			// Connection may be closed, will be cleaned up on next write failure
			logging.LogDebugf("[plugin:%s] failed to broadcast to connection: %s", p.Name, err)
		}
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsHelper(s, substr))
}

func containsHelper(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
