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

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/siyuan-note/logging"
)

// JSONRPCRequest represents a JSON-RPC 2.0 request.
type JSONRPCRequest struct {
	JSONRPC string      `json:"jsonrpc"`
	Method  string      `json:"method"`
	Params  interface{} `json:"params"`
	ID      interface{} `json:"id"`
}

// JSONRPCResponse represents a JSON-RPC 2.0 response.
type JSONRPCResponse struct {
	JSONRPC string        `json:"jsonrpc"`
	Result  interface{}   `json:"result,omitempty"`
	Error   *JSONRPCError `json:"error,omitempty"`
	ID      interface{}   `json:"id"`
}

// JSONRPCError represents a JSON-RPC 2.0 error.
type JSONRPCError struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

// HandleRPCHTTP handles POST /api/plugin/rpc/:name
func HandleRPCHTTP(c *gin.Context) {
	name := c.Param("name")
	kp := GetManager().GetPlugin(name)
	if kp == nil || kp.State() != StateRunning {
		resp := JSONRPCResponse{
			JSONRPC: "2.0",
			Error:   &JSONRPCError{Code: -32601, Message: "Method not found"},
			ID:      nil,
		}
		c.JSON(http.StatusOK, resp)
		return
	}

	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, JSONRPCResponse{
			JSONRPC: "2.0",
			Error:   &JSONRPCError{Code: -32700, Message: "Parse error"},
		})
		return
	}

	var req JSONRPCRequest
	if err = json.Unmarshal(body, &req); err != nil {
		c.JSON(http.StatusOK, JSONRPCResponse{
			JSONRPC: "2.0",
			Error:   &JSONRPCError{Code: -32700, Message: "Parse error"},
		})
		return
	}

	c.JSON(http.StatusOK, dispatchRPC(kp, &req))
}

// HandleRPCWebSocket handles GET /ws/plugin/rpc/:name
func HandleRPCWebSocket(c *gin.Context) {
	name := c.Param("name")
	kp := GetManager().GetPlugin(name)
	if kp == nil || kp.State() != StateRunning {
		c.JSON(http.StatusNotFound, JSONRPCResponse{
			JSONRPC: "2.0",
			Error:   &JSONRPCError{Code: -32601, Message: "Method not found"},
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

	for {
		_, message, readErr := conn.ReadMessage()
		if readErr != nil {
			break
		}

		var req JSONRPCRequest
		if err = json.Unmarshal(message, &req); err != nil {
			resp, _ := json.Marshal(JSONRPCResponse{
				JSONRPC: "2.0",
				Error:   &JSONRPCError{Code: -32700, Message: "Parse error"},
			})
			conn.WriteMessage(websocket.TextMessage, resp)
			continue
		}

		resp := dispatchRPC(kp, &req)
		respBytes, _ := json.Marshal(resp)
		conn.WriteMessage(websocket.TextMessage, respBytes)
	}
}

// dispatchRPC routes a single JSON-RPC request to the plugin's registered JS method.
func dispatchRPC(p *KernelPlugin, req *JSONRPCRequest) JSONRPCResponse {
	result, err := p.CallRpcMethod(req.Method, req.Params)
	if err != nil {
		code := -32603 // internal error
		if err.Error() == fmt.Sprintf("method %q not found", req.Method) ||
			contains(err.Error(), "plugin not running") {
			code = -32601
		}
		return JSONRPCResponse{
			JSONRPC: "2.0",
			Error:   &JSONRPCError{Code: code, Message: err.Error()},
			ID:      req.ID,
		}
	}

	return JSONRPCResponse{
		JSONRPC: "2.0",
		Result:  result,
		ID:      req.ID,
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
