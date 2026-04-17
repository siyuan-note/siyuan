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

// resolveRunningPlugin looks up the plugin by name and writes a -32601 error response if it is
// not found or not running. Returns nil when the caller should abort.
func resolveRunningPlugin(c *gin.Context, name string, errStatus int) *KernelPlugin {
	p := GetManager().GetPlugin(name)
	if p == nil || p.State() != StateRunning {
		c.JSON(errStatus, &JsonRpcErrorResponse{
			JsonRpc: JsonRpcVersion,
			Error:   &JsonRpcError{Code: JsonRpcErrorCodeMethodNotFound, Message: "Plugin not found or not running"},
		})
		return nil
	}
	return p
}

// HandleRpcHttp handles POST /api/plugin/rpc/:name
// Supports single call, batch call, and notification (no response for notification).
func HandleRpcHttp(c *gin.Context) {
	name := util.GetRequestUrlStringParam(c, "name")
	p := resolveRunningPlugin(c, name, http.StatusOK)
	if p == nil {
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

	requests, isBatch, jsonRpcErr := parseRequests(body)
	if jsonRpcErr != nil {
		c.JSON(http.StatusOK, jsonRpcErr)
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
	p := resolveRunningPlugin(c, name, http.StatusNotFound)
	if p == nil {
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
	p.TrackSocket(conn, true)
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
			if respBytes, marshalErr := json.Marshal(&JsonRpcErrorResponse{
				JsonRpc: JsonRpcVersion,
				Error:   jsonErr,
			}); marshalErr == nil {
				if writeErr := p.wsWrite(conn, respBytes); writeErr != nil {
					logging.LogWarnf("[plugin:%s] ws write: %s", name, writeErr)
				}
			}
			continue
		}

		responses := dispatchRequests(p, requests)

		if !isBatch {
			// Single request - send response only if not a notification
			if len(responses) > 0 && responses[0] != nil {
				if respBytes, marshalErr := json.Marshal(responses[0]); marshalErr == nil {
					if writeErr := p.wsWrite(conn, respBytes); writeErr != nil {
						logging.LogWarnf("[plugin:%s] ws write: %s", name, writeErr)
					}
				}
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
			if respBytes, marshalErr := json.Marshal(filtered); marshalErr == nil {
				if writeErr := p.wsWrite(conn, respBytes); writeErr != nil {
					logging.LogWarnf("[plugin:%s] ws write: %s", name, writeErr)
				}
			}
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
func parseRequests(body []byte) (requests []*JsonRpcRequest, isBatch bool, jsonRpcErr *JsonRpcError) {
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
		Params  any    `json:"params,omitempty"`
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

// BroadcastNotification sends a JSON-RPC 2.0 notification to all inbound RPC WebSocket clients.
func (p *KernelPlugin) BroadcastNotification(method string, params any) {
	notification := struct {
		JsonRpc string `json:"jsonrpc"`
		Method  string `json:"method"`
		Params  any    `json:"params,omitempty"`
	}{
		JsonRpc: JsonRpcVersion,
		Method:  method,
		Params:  params,
	}
	data, err := json.Marshal(notification)
	if err != nil {
		logging.LogWarnf("[plugin:%s] broadcast marshal: %s", p.Name, err)
		return
	}

	p.mu.RLock()
	conns := make([]*websocket.Conn, 0, len(p.sockets))
	for conn, isServer := range p.sockets {
		if isServer {
			conns = append(conns, conn)
		}
	}
	p.mu.RUnlock()

	for _, conn := range conns {
		if err := p.wsWrite(conn, data); err != nil {
			logging.LogWarnf("[plugin:%s] broadcast: %s", p.Name, err)
		}
	}
}

// wsWrite serializes a single write to conn using the per-connection mutex.
// Returns nil immediately if conn is no longer tracked (already removed by Stop or UntrackSocket).
// If Stop races and closes the connection after the tracking check, WriteMessage returns
// an error which is propagated to the caller.
func (p *KernelPlugin) wsWrite(conn *websocket.Conn, data []byte) error {
	p.mu.RLock()
	mu, ok := p.socketMus[conn]
	p.mu.RUnlock()
	if !ok {
		return nil
	}
	// Between RUnlock above and mu.Lock below, Stop() may close the connection.
	// The subsequent WriteMessage will return an error (use of closed connection),
	// which callers log and discard.
	mu.Lock()
	defer mu.Unlock()
	return conn.WriteMessage(websocket.TextMessage, data)
}
