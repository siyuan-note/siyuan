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
	"testing"
)

func TestJSONRPCRequestStructure(t *testing.T) {
	req := JSONRPCRequest{
		JSONRPC: "2.0",
		Method:  "testMethod",
		Params:  map[string]interface{}{"key": "value"},
		ID:      1,
	}

	data, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("failed to marshal request: %v", err)
	}

	var decoded JSONRPCRequest
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal request: %v", err)
	}

	if decoded.JSONRPC != "2.0" {
		t.Errorf("expected jsonrpc=2.0, got %q", decoded.JSONRPC)
	}
	if decoded.Method != "testMethod" {
		t.Errorf("expected method=testMethod, got %q", decoded.Method)
	}
}

func TestJSONRPCResponseStructure(t *testing.T) {
	// Test success response
	resp := JSONRPCResponse{
		JSONRPC: "2.0",
		Result:  map[string]interface{}{"success": true},
		ID:      1,
	}

	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("failed to marshal response: %v", err)
	}

	var decoded JSONRPCResponse
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal response: %v", err)
	}

	if decoded.Error != nil {
		t.Error("expected no error in success response")
	}

	// Test error response
	resp = JSONRPCResponse{
		JSONRPC: "2.0",
		Error:   &JSONRPCError{Code: -32601, Message: "Method not found"},
		ID:      1,
	}

	data, err = json.Marshal(resp)
	if err != nil {
		t.Fatalf("failed to marshal error response: %v", err)
	}

	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal error response: %v", err)
	}

	if decoded.Error == nil {
		t.Fatal("expected error in error response")
	}
	if decoded.Error.Code != -32601 {
		t.Errorf("expected code=-32601, got %d", decoded.Error.Code)
	}
}

func TestJSONRPCErrorCodes(t *testing.T) {
	tests := []struct {
		code    int
		message string
	}{
		{-32700, "Parse error"},
		{-32600, "Invalid Request"},
		{-32601, "Method not found"},
		{-32602, "Invalid params"},
		{-32603, "Internal error"},
	}

	for _, tt := range tests {
		err := JSONRPCError{
			Code:    tt.code,
			Message: tt.message,
		}

		data, err2 := json.Marshal(err)
		if err2 != nil {
			t.Fatalf("failed to marshal error: %v", err2)
		}

		var decoded JSONRPCError
		if err3 := json.Unmarshal(data, &decoded); err3 != nil {
			t.Fatalf("failed to unmarshal error: %v", err3)
		}

		if decoded.Code != tt.code {
			t.Errorf("expected code=%d, got %d", tt.code, decoded.Code)
		}
	}
}

func TestDispatchRPCMethodNotFound(t *testing.T) {
	kp := NewKernelPlugin("test-dispatch")

	req := &JSONRPCRequest{
		JSONRPC: "2.0",
		Method:  "nonExistentMethod",
		Params:  nil,
		ID:      1,
	}

	// Plugin is not running, so method should not be found
	resp := dispatchRPC(kp, req)

	if resp.Error == nil {
		t.Fatal("expected error for method not found")
	}

	if resp.Error.Code != -32601 {
		t.Errorf("expected code=-32601 (Method not found), got %d", resp.Error.Code)
	}
}

func TestDispatchRPCPluginNotRunning(t *testing.T) {
	kp := NewKernelPlugin("test-not-running")
	// Plugin is in StateStopped, not StateRunning

	req := &JSONRPCRequest{
		JSONRPC: "2.0",
		Method:  "anyMethod",
		ID:      1,
	}

	resp := dispatchRPC(kp, req)

	if resp.Error == nil {
		t.Fatal("expected error for plugin not running")
	}

	// Should get Method not found (-32601) or Internal error (-32603)
	if resp.Error.Code != -32601 && resp.Error.Code != -32603 {
		t.Errorf("expected error code -32601 or -32603, got %d", resp.Error.Code)
	}
}

func TestDispatchRPCWithID(t *testing.T) {
	kp := NewKernelPlugin("test-id")

	// Test with numeric ID
	req := &JSONRPCRequest{
		JSONRPC: "2.0",
		Method:  "test",
		ID:      42,
	}
	resp := dispatchRPC(kp, req)
	if resp.ID != 42 {
		t.Errorf("expected ID=42, got %v", resp.ID)
	}

	// Test with string ID
	req.ID = "request-123"
	resp = dispatchRPC(kp, req)
	if resp.ID != "request-123" {
		t.Errorf("expected ID=request-123, got %v", resp.ID)
	}

	// Test with null ID (notification)
	req.ID = nil
	resp = dispatchRPC(kp, req)
	if resp.ID != nil {
		t.Errorf("expected ID=nil, got %v", resp.ID)
	}
}

func TestContainsHelper(t *testing.T) {
	tests := []struct {
		s      string
		substr string
		want   bool
	}{
		{"hello world", "world", true},
		{"hello world", "foo", false},
		{"", "foo", false},
		{"foo", "", true},
		{"foo", "foo", true},
		{"plugin not running (state=stopped)", "plugin not running", true},
	}

	for _, tt := range tests {
		got := contains(tt.s, tt.substr)
		if got != tt.want {
			t.Errorf("contains(%q, %q) = %v, want %v", tt.s, tt.substr, got, tt.want)
		}
	}
}

func TestJSONRPCResponseMarshal(t *testing.T) {
	// Test that Result is omitted when nil
	resp := JSONRPCResponse{
		JSONRPC: "2.0",
		ID:      1,
	}

	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if _, ok := raw["result"]; ok {
		t.Error("expected result to be omitted when nil")
	}

	// Test that Error is omitted when nil
	resp2 := JSONRPCResponse{
		JSONRPC: "2.0",
		Result:  "success",
		ID:      1,
	}

	data2, err := json.Marshal(resp2)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var raw2 map[string]interface{}
	if err := json.Unmarshal(data2, &raw2); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	if _, ok := raw2["error"]; ok {
		t.Error("expected error to be omitted when nil")
	}
}

func TestJSONRPCRequestUnmarshal(t *testing.T) {
	// Valid request
	jsonData := `{"jsonrpc":"2.0","method":"test","params":{"key":"value"},"id":1}`
	var req JSONRPCRequest
	if err := json.Unmarshal([]byte(jsonData), &req); err != nil {
		t.Fatalf("failed to unmarshal valid request: %v", err)
	}
	if req.Method != "test" {
		t.Errorf("expected method=test, got %q", req.Method)
	}

	// Request without params (should be valid)
	jsonData = `{"jsonrpc":"2.0","method":"test","id":2}`
	var req2 JSONRPCRequest
	if err := json.Unmarshal([]byte(jsonData), &req2); err != nil {
		t.Fatalf("failed to unmarshal request without params: %v", err)
	}

	// Request with array params
	jsonData = `{"jsonrpc":"2.0","method":"test","params":[1,2,3],"id":3}`
	var req3 JSONRPCRequest
	if err := json.Unmarshal([]byte(jsonData), &req3); err != nil {
		t.Fatalf("failed to unmarshal request with array params: %v", err)
	}
}
