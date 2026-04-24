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
	"fmt"
	"io"
	"net/http"

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
	JsonRpc string             `json:"jsonrpc"`
	Method  string             `json:"method"`
	Params  util.Optional[any] `json:"params,omitempty"`
	ID      util.Optional[any] `json:"id,omitempty"`
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
	decoder.DisallowUnknownFields() // Reject unknown fields to prevent silent errors from typos
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
	if !request.Method.Exists {
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
			Code:    JsonRpcErrorCodeInvalidRequest,
			Message: JsonRpcErrorInvalidRequest.Message,
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

// JsonRpcRequestProcessingResults represents the results of parsing and validating JSON-RPC requests, including any global error and the individual results for each request in a batch.
type JsonRpcRequestProcessingResults struct {
	Batch       bool                  // Whether the original request was a batch (array) or single request
	GlobalError *JsonRpcErrorResponse // If the entire request is invalid
	Requests    []*JsonRpcProcessingRequest
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

// JsonRpcResponse returns the appropriate response (either success or error) to be sent back to the client, or nil if this is a notification and no response should be sent.
func (r *JsonRpcProcessingResponse) JsonRpcResponse() any {
	if r.Response != nil {
		return r.Response
	}
	if r.Error != nil {
		return r.Error
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
			Error: &JsonRpcError{
				Code:    JsonRpcErrorCodeInternalError,
				Message: JsonRpcErrorInternalError.Message,
				Data:    fmt.Sprintf("Failed to read request body: %s", err),
			},
			ID: nil,
		})
		return
	}

	results := parseRpcRequests(body)
	if results.GlobalError != nil {
		c.JSON(http.StatusOK, results.GlobalError)
		return
	}

	responses := p.dispatchRpcRequests(results.Requests)

	if !results.Batch {
		// Single request - return single response (or empty for notification)
		if len(responses) > 0 && responses[0] != nil {
			response := responses[0]
			if response.Response != nil {
				c.JSON(http.StatusOK, response.Response)
				return
			} else if response.Error != nil {
				c.JSON(http.StatusOK, response.Error)
				return
			}
		}
		c.Status(http.StatusNoContent)
		return
	}

	// Batch request - filter out nil responses (notifications) and return array
	filtered := filterRpcResponses(responses)

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
		logging.LogErrorf("[plugin:%s] RPC WebSocket upgrade failed: %s", name, err)
		// upgrader.Upgrade has already written an HTTP error response, so just return without writing another response
		return
	}
	defer conn.Close()

	// Track this connection for server push notifications
	p.TrackSocket(conn, true)
	defer p.UntrackSocket(conn)

	for {
		_, message, readErr := conn.ReadMessage()
		if readErr != nil {
			if websocket.IsUnexpectedCloseError(readErr, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				logging.LogErrorf("[plugin:%s] RPC WebSocket read failed: %s", name, readErr)
			}
			break
		}

		results := parseRpcRequests(message)
		if results.GlobalError != nil {
			if respBytes, marshalErr := json.Marshal(results.GlobalError); marshalErr == nil {
				if writeErr := p.writeWebSocketMessage(conn, websocket.TextMessage, respBytes); writeErr != nil {
					logging.LogWarnf("[plugin:%s] RPC WebSocket response write failed: %s", name, writeErr)
				}
			}
			continue
		}

		responses := p.dispatchRpcRequests(results.Requests)

		var needToSend bool
		var responseBytes []byte
		var marshalErr error

		if !results.Batch {
			// Single request - send response only if not a notification
			if len(responses) > 0 && responses[0] != nil {
				if response := responses[0].JsonRpcResponse(); response != nil {
					needToSend = true
					responseBytes, marshalErr = json.Marshal(response)
				}
			}
		} else {
			// Batch request - filter out nil responses (notifications)
			filtered := filterRpcResponses(responses)

			// Send batch response; if all were notifications, send nothing per spec
			if len(filtered) > 0 {
				needToSend = true
				responseBytes, marshalErr = json.Marshal(filtered)
			}
		}

		if needToSend {
			if marshalErr == nil {
				if writeErr := p.writeWebSocketMessage(conn, websocket.TextMessage, responseBytes); writeErr != nil {
					logging.LogWarnf("[plugin:%s] RPC WebSocket response write failed: %s", name, writeErr)
				}
			} else {
				logging.LogErrorf("[plugin:%s] RPC response marshal failed: %s", name, marshalErr)
			}
		}
	}
}

// resolveRunningPlugin looks up the plugin by name and writes a -32601 error response if it is
// not found or not running. Returns nil when the caller should abort.
func resolveRunningPlugin(c *gin.Context, name string, errStatus int) *KernelPlugin {
	p := GetManager().GetPlugin(name)
	if p == nil {
		c.JSON(errStatus, &JsonRpcErrorResponse{
			JsonRpc: JsonRpcVersion,
			Error: &JsonRpcError{
				Code:    JsonRpcErrorInternalError.Code,
				Message: JsonRpcErrorInternalError.Message,
				Data:    "Plugin not loaded",
			},
		})
		return nil
	}
	if p.State() != PluginStateRunning {
		c.JSON(errStatus, &JsonRpcErrorResponse{
			JsonRpc: JsonRpcVersion,
			Error: &JsonRpcError{
				Code:    JsonRpcErrorInternalError.Code,
				Message: JsonRpcErrorInternalError.Message,
				Data:    "Plugin not running",
			},
		})
		return nil
	}
	return p
}

// parseRpcRequest parses a single JSON-RPC request from the given body. The body must be a JSON object.
func parseRpcRequest(body []byte) (parsedRequest JsonRpcProcessingRequest) {
	var request JsonRpcRequest
	if !json.Valid(body) {
		// Invalid JSON
		parsedRequest.Error = &JsonRpcErrorResponse{
			JsonRpc: JsonRpcVersion,
			Error: &JsonRpcError{
				Code:    JsonRpcErrorCodeParseError,
				Message: JsonRpcErrorParseError.Message,
				Data:    "RPC request is not valid JSON",
			},
			ID: nil,
		}
		return
	}
	if err := json.Unmarshal(body, &request); err != nil {
		// Invalid request structure
		parsedRequest.Error = &JsonRpcErrorResponse{
			JsonRpc: JsonRpcVersion,
			Error: &JsonRpcError{
				Code:    JsonRpcErrorCodeInvalidRequest,
				Message: JsonRpcErrorInvalidRequest.Message,
				Data:    fmt.Sprintf("RPC request is not a valid JSON-RPC object: %s", err),
			},
			ID: nil,
		}
		return
	}
	parsedRequest.Request = &request
	return
}

// parseRpcRequests parses the given body into one or more JSON-RPC requests, handling both single and batch requests.
func parseRpcRequests(body []byte) (results JsonRpcRequestProcessingResults) {
	if !json.Valid(body) {
		// Invalid JSON
		results.GlobalError = &JsonRpcErrorResponse{
			JsonRpc: JsonRpcVersion,
			Error: &JsonRpcError{
				Code:    JsonRpcErrorCodeParseError,
				Message: JsonRpcErrorParseError.Message,
				Data:    "RPC request is not valid JSON",
			},
			ID: nil,
		}
		return
	}

	var jsonArray []json.RawMessage
	if err := json.Unmarshal(body, &jsonArray); err != nil {
		// single request
		request := parseRpcRequest(body)
		results.Requests = append(results.Requests, &request)
		return
	} else {
		// batch request
		if len(jsonArray) == 0 {
			// per spec, an empty array is invalid
			results.GlobalError = &JsonRpcErrorResponse{
				JsonRpc: JsonRpcVersion,
				Error: &JsonRpcError{
					Code:    JsonRpcErrorCodeInvalidRequest,
					Message: JsonRpcErrorInvalidRequest.Message,
					Data:    "RPC request is not allowed to be an empty array",
				},
				ID: nil,
			}
			return
		}

		results.Batch = true
		results.Requests = make([]*JsonRpcProcessingRequest, len(jsonArray))
		for i, raw := range jsonArray {
			request := parseRpcRequest(raw)
			results.Requests[i] = &request
		}
	}
	return
}

// filterRpcResponses filters out nil responses (for notifications) and extracts the actual response objects for non-nil responses.
func filterRpcResponses(responses []*JsonRpcProcessingResponse) []any {
	filtered := make([]any, 0, len(responses))
	for _, response := range responses {
		if response != nil {
			if response.Response != nil {
				filtered = append(filtered, response.Response)
			} else if response.Error != nil {
				filtered = append(filtered, response.Error)
			}
		}
	}
	return filtered
}
