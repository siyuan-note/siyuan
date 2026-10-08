package plugin

import (
	"encoding/json"
	"fmt"
)

type JsonRpcRequestProcessingResults struct {
	Batch       bool                  // 是否为批量请求
	GlobalError *JsonRpcErrorResponse // 整个请求的错误
	Requests    []*JsonRpcProcessingRequest
}

// parseRpcRequest 保留契约迁移前的解析规则，作为兼容性测试的独立参照。
func parseRpcRequest(body []byte) (parsedRequest JsonRpcProcessingRequest) {
	var request JsonRpcRequest
	if !json.Valid(body) {
		// JSON 格式错误。
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
		// 请求结构错误。
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

// parseRpcRequests 为兼容性测试解析单次请求、批量请求与全局错误。
func parseRpcRequests(body []byte) (results JsonRpcRequestProcessingResults) {
	if !json.Valid(body) {
		// JSON 格式错误。
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
		// 单次请求。
		request := parseRpcRequest(body)
		results.Requests = append(results.Requests, &request)
		return
	} else {
		// 批量请求。
		if len(jsonArray) == 0 {
			// 规范不接受空数组。
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

// filterRpcResponses 为兼容性测试提取非通知响应。
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
