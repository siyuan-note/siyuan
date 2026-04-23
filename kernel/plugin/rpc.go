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

type JsonRpcErrorCode int

const (
	JsonRpcVersion = "2.0"

	JsonRpcErrorCodeParseError     JsonRpcErrorCode = -32700
	JsonRpcErrorCodeInvalidRequest JsonRpcErrorCode = -32600
	JsonRpcErrorCodeMethodNotFound JsonRpcErrorCode = -32601
	JsonRpcErrorCodeInvalidParams  JsonRpcErrorCode = -32602
	JsonRpcErrorCodeInternalError  JsonRpcErrorCode = -32603
)

var (
	JsonRpcErrorParseError     = &JsonRpcError{Code: JsonRpcErrorCodeParseError, Message: "Parse error"}
	JsonRpcErrorInvalidRequest = &JsonRpcError{Code: JsonRpcErrorCodeInvalidRequest, Message: "Invalid Request"}
	JsonRpcErrorMethodNotFound = &JsonRpcError{Code: JsonRpcErrorCodeMethodNotFound, Message: "Method not found"}
	JsonRpcErrorInvalidParams  = &JsonRpcError{Code: JsonRpcErrorCodeInvalidParams, Message: "Invalid params"}
	JsonRpcErrorInternalError  = &JsonRpcError{Code: JsonRpcErrorCodeInternalError, Message: "Internal error"}
)

func (e *JsonRpcError) Error() string {
	return fmt.Sprintf("JSON RPC Error: %d %s", e.Code, e.Message)
}

// JsonRpcRequest represents a JSON-RPC 2.0 request.
type JsonRpcRequest struct {
	JsonRpc string `json:"jsonrpc"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
	ID      any    `json:"id,omitempty"`
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

	requests, isBatch, jsonRpcErr := parseRpcRequests(body)
	if jsonRpcErr != nil {
		c.JSON(http.StatusOK, jsonRpcErr)
		return
	}

	responses := p.dispatchRpcRequests(requests)

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
			if websocket.IsUnexpectedCloseError(readErr, websocket.CloseNormalClosure) {
				logging.LogErrorf("[plugin:%s] RPC WebSocket error: %s", name, readErr)
			}
			break
		}

		requests, isBatch, jsonErr := parseRpcRequests(message)
		if jsonErr != nil {
			if respBytes, marshalErr := json.Marshal(&JsonRpcErrorResponse{
				JsonRpc: JsonRpcVersion,
				Error:   jsonErr,
			}); marshalErr == nil {
				if writeErr := p.writeWebSocketMessage(conn, respBytes); writeErr != nil {
					logging.LogWarnf("[plugin:%s] ws write: %s", name, writeErr)
				}
			}
			continue
		}

		responses := p.dispatchRpcRequests(requests)

		if !isBatch {
			// Single request - send response only if not a notification
			if len(responses) > 0 && responses[0] != nil {
				if respBytes, marshalErr := json.Marshal(responses[0]); marshalErr == nil {
					if writeErr := p.writeWebSocketMessage(conn, respBytes); writeErr != nil {
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
				if writeErr := p.writeWebSocketMessage(conn, respBytes); writeErr != nil {
					logging.LogWarnf("[plugin:%s] ws write: %s", name, writeErr)
				}
			}
		}
	}
}

// BroadcastNotification sends a JSON-RPC 2.0 notification to all inbound RPC WebSocket clients.
func (p *KernelPlugin) BroadcastNotification(method string, params any) {
	notification := JsonRpcRequest{
		JsonRpc: JsonRpcVersion,
		Method:  method,
		Params:  params,
	}
	data, err := json.Marshal(notification)
	if err != nil {
		logging.LogWarnf("[plugin:%s] broadcast marshal: %s", p.Name, err)
		return
	}

	p.socketsMu.RLock()
	conns := make([]*websocket.Conn, 0, len(p.sockets))
	for conn, isRpcConnection := range p.sockets {
		if isRpcConnection {
			conns = append(conns, conn)
		}
	}
	p.socketsMu.RUnlock()

	wg := sync.WaitGroup{}
	for _, conn := range conns {
		wg.Add(1)
		go func(c *websocket.Conn) {
			defer wg.Done()
			if err := p.writeWebSocketMessage(c, data); err != nil {
				logging.LogWarnf("[plugin:%s] broadcast: %s", p.Name, err)
			}
		}(conn)
	}
	wg.Wait()
}

// resolveRunningPlugin looks up the plugin by name and writes a -32601 error response if it is
// not found or not running. Returns nil when the caller should abort.
func resolveRunningPlugin(c *gin.Context, name string, errStatus int) *KernelPlugin {
	p := GetManager().GetPlugin(name)
	if p == nil || p.State() != PluginStateRunning {
		c.JSON(errStatus, &JsonRpcErrorResponse{
			JsonRpc: JsonRpcVersion,
			Error:   &JsonRpcError{Code: JsonRpcErrorCodeInternalError, Message: "Plugin not found or not running"},
		})
		return nil
	}
	return p
}

// isJsonArray checks if the json is a array (starts with '[' and ends with ']').
func isJsonArray[T ~[]byte | ~string](body T) bool {
	jsonStr := strings.TrimSpace(string(body))
	return len(jsonStr) > 0 && jsonStr[0] == '[' && jsonStr[len(jsonStr)-1] == ']'
}

// parseRpcRequests parses JSON-RPC requests from the body.
// Returns requests and a boolean indicating if it's a batch request.
func parseRpcRequests(body []byte) (requests []*JsonRpcRequest, isBatch bool, jsonRpcErr *JsonRpcError) {
	if len(body) == 0 {
		return nil, false, JsonRpcErrorParseError
	}

	if isJsonArray(body) {
		if err := json.Unmarshal(body, &requests); err != nil {
			return nil, true, JsonRpcErrorParseError
		}
		if len(requests) == 0 {
			return nil, true, JsonRpcErrorInvalidRequest
		}
		return requests, true, nil
	}

	var request JsonRpcRequest
	if err := json.Unmarshal(body, &request); err != nil {
		return nil, false, JsonRpcErrorParseError
	}
	requests = append(requests, &request)
	return requests, false, nil
}
