package apicontract

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

type PluginRPCID struct{ value JSONValue }

func (id PluginRPCID) MarshalJSON() ([]byte, error) { return json.Marshal(id.value) }
func (id *PluginRPCID) UnmarshalJSON(data []byte) error {
	data = bytes.TrimSpace(data)
	if !json.Valid(data) || len(data) == 0 {
		return fmt.Errorf("invalid RPC ID")
	}
	if data[0] != '"' && data[0] != '-' && (data[0] < '0' || data[0] > '9') && string(data) != "null" {
		return fmt.Errorf("invalid id field: must be string, number, null or omitted")
	}
	return json.Unmarshal(data, &id.value)
}

type PluginRPCParams struct{ value JSONValue }

type PluginRPCRequestFields struct {
	JSONRPC string           `json:"jsonrpc" api:"const=\"2.0\""`
	Method  string           `json:"method"`
	Params  *PluginRPCParams `json:"params" api:"optional"`
	ID      *PluginRPCID     `json:"id" api:"optional"`
}

type PluginRPCSuccess struct {
	JSONRPC string      `json:"jsonrpc" api:"const=\"2.0\""`
	Result  JSONValue   `json:"result"`
	ID      PluginRPCID `json:"id"`
}

type PluginRPCNotification struct {
	JSONRPC string     `json:"jsonrpc" api:"const=\"2.0\""`
	Method  string     `json:"method"`
	Params  *JSONValue `json:"params,omitempty"`
}

type PluginRPCError struct {
	Code    int        `json:"code"`
	Message string     `json:"message"`
	Data    *JSONValue `json:"data,omitempty"`
}

// PluginRPCMessage 是出站回复或主动通知，两者不共享可选的协议字段。
type PluginRPCMessage struct {
	response     *PluginRPCResponse
	notification *PluginRPCNotification
}

func RPCResponseMessage(response PluginRPCResponse) PluginRPCMessage {
	return PluginRPCMessage{response: &response}
}

func RPCNotificationMessage(notification PluginRPCNotification) PluginRPCMessage {
	return PluginRPCMessage{notification: &notification}
}

func (m PluginRPCMessage) MarshalJSON() ([]byte, error) {
	if m.response != nil {
		return json.Marshal(m.response)
	}
	if m.notification != nil {
		return json.Marshal(m.notification)
	}
	return nil, fmt.Errorf("RPC message requires a response or notification")
}

type PluginRPCFailure struct {
	JSONRPC string          `json:"jsonrpc" api:"const=\"2.0\""`
	Error   *PluginRPCError `json:"error"`
	ID      PluginRPCID     `json:"id"`
}

type PluginRPCReply struct {
	success *PluginRPCSuccess
	failure *PluginRPCFailure
}

func RPCSuccessReply(result PluginRPCSuccess) PluginRPCReply { return PluginRPCReply{success: &result} }
func RPCFailureReply(result PluginRPCFailure) PluginRPCReply { return PluginRPCReply{failure: &result} }
func (r PluginRPCReply) MarshalJSON() ([]byte, error) {
	if r.success != nil {
		return json.Marshal(r.success)
	}
	if r.failure != nil {
		return json.Marshal(r.failure)
	}
	return nil, fmt.Errorf("RPC reply requires success or failure")
}

type PluginRPCResponse struct {
	single *PluginRPCReply
	batch  []PluginRPCReply
}

func RPCSingleResponse(reply PluginRPCReply) PluginRPCResponse {
	return PluginRPCResponse{single: &reply}
}
func RPCBatchResponse(replies []PluginRPCReply) PluginRPCResponse {
	return PluginRPCResponse{batch: replies}
}
func (r PluginRPCResponse) MarshalJSON() ([]byte, error) {
	if r.single != nil {
		return json.Marshal(r.single)
	}
	if len(r.batch) == 0 {
		return nil, fmt.Errorf("RPC batch response must not be empty")
	}
	return json.Marshal(r.batch)
}

type PluginRPCCall struct {
	Method        string
	Params        JSONValue
	ParamsPresent bool
	ParamsNull    bool
	ID            PluginRPCID
	IDPresent     bool
}

type PluginRPCParsedCall struct {
	Request *PluginRPCCall
	Error   *PluginRPCFailure
}

type PluginRPCBatchRequest struct {
	Batch bool                  `json:"-"`
	Calls []PluginRPCParsedCall `json:"-"`
	Error *PluginRPCFailure     `json:"-"`
}

func RPCErrorResponse(code int, message, detail string) PluginRPCFailure {
	result := PluginRPCFailure{JSONRPC: "2.0", Error: &PluginRPCError{Code: code, Message: message}}
	if detail != "" {
		data, _ := json.Marshal(detail)
		var value JSONValue
		_ = json.Unmarshal(data, &value)
		result.Error.Data = &value
	}
	return result
}

type rpcOptional[T any] struct {
	Value  T
	Exists bool
	IsNull bool
}

func (o *rpcOptional[T]) UnmarshalJSON(data []byte) error {
	o.Exists = true
	if string(data) == "null" {
		o.IsNull = true
		return nil
	}
	o.IsNull = false
	return json.Unmarshal(data, &o.Value)
}

func parsePluginRPCCall(data []byte) PluginRPCParsedCall {
	type JsonRpcRequestObject struct {
		JsonRpc rpcOptional[string]    `json:"jsonrpc"`
		Method  rpcOptional[string]    `json:"method"`
		Params  rpcOptional[JSONValue] `json:"params"`
		ID      rpcOptional[JSONValue] `json:"id"`
	}
	var fields JsonRpcRequestObject
	err := json.Unmarshal(data, &fields)
	var id PluginRPCID
	if err == nil {
		switch {
		case !fields.JsonRpc.Exists:
			err = fmt.Errorf("missing jsonrpc field")
		case fields.JsonRpc.Value != "2.0":
			err = fmt.Errorf("invalid jsonrpc version: %s", fields.JsonRpc.Value)
		case !fields.Method.Exists || fields.Method.IsNull:
			err = fmt.Errorf("missing method field")
		default:
			if fields.ID.Exists && !fields.ID.IsNull {
				raw, _ := json.Marshal(fields.ID.Value)
				err = json.Unmarshal(raw, &id)
			}
		}
	}
	if err != nil {
		message := strings.ReplaceAll(err.Error(), "apicontract.JsonRpcRequestObject", "plugin.JsonRpcRequestObject")
		failure := RPCErrorResponse(-32600, "Invalid Request", "RPC request is not a valid JSON-RPC object: "+message)
		return PluginRPCParsedCall{Error: &failure}
	}
	return PluginRPCParsedCall{Request: &PluginRPCCall{Method: fields.Method.Value, Params: fields.Params.Value, ParamsPresent: fields.Params.Exists, ParamsNull: fields.Params.IsNull, ID: id, IDPresent: fields.ID.Exists}}
}

// RPC 请求保留批量中的单项结构错误，参数形状错误仍交给调用分发处理通知语义。
func DecodePluginRPC(reader io.Reader) (request PluginRPCBatchRequest, err error) {
	body, err := io.ReadAll(reader)
	if err != nil {
		return request, err
	}
	if !json.Valid(body) {
		failure := RPCErrorResponse(-32700, "Parse error", "RPC request is not valid JSON")
		request.Error = &failure
		return request, nil
	}
	var entries []json.RawMessage
	if json.Unmarshal(body, &entries) != nil {
		request.Calls = []PluginRPCParsedCall{parsePluginRPCCall(body)}
		return request, nil
	}
	if len(entries) == 0 {
		failure := RPCErrorResponse(-32600, "Invalid Request", "RPC request is not allowed to be an empty array")
		request.Error = &failure
		return request, nil
	}
	request.Batch = true
	request.Calls = make([]PluginRPCParsedCall, len(entries))
	for i, entry := range entries {
		request.Calls[i] = parsePluginRPCCall(entry)
	}
	return request, nil
}

func init() {
	for _, endpoint := range []*Endpoint[PluginRPCBatchRequest, PluginRPCResponse]{&PluginRPCHTTP, &PluginRPCHTTPByName} {
		endpoint.decodeRequest = DecodePluginRPC
		endpoint.decodeFailure = func(err error) Response[PluginRPCResponse] {
			failure := RPCErrorResponse(-32603, "Internal error", "Failed to read request body: "+err.Error())
			return SuccessDirectJSON(RPCSingleResponse(RPCFailureReply(failure)))
		}
	}
}
