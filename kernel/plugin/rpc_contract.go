package plugin

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const rpcContractPluginKey = "siyuan.plugin.rpc.contract.plugin"

func OpenRPCWebSocket(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.PluginRPCFailure] {
	name := util.GetRequestUrlStringParam(c, "name")
	p := GetManager().GetPlugin(name)
	if p == nil {
		return apicontract.RejectWebSocket(apicontract.RPCErrorResponse(-32001, "Plugin not loaded", ""))
	}
	if p.State() != PluginStateRunning {
		return apicontract.RejectWebSocket(apicontract.RPCErrorResponse(-32002, "Plugin not running", ""))
	}
	return apicontract.UpgradeWebSocket[apicontract.PluginRPCFailure](p.serveRPCWebSocket)
}

// PrepareRPCContract 在读取请求体前选定运行中的插件，请求期间继续使用同一实例。
func PrepareRPCContract(c *gin.Context) *apicontract.Response[apicontract.PluginRPCResponse] {
	name := util.GetRequestUrlStringParam(c, "name")
	p := GetManager().GetPlugin(name)
	var failure apicontract.PluginRPCFailure
	if p == nil {
		failure = apicontract.RPCErrorResponse(-32001, "Plugin not loaded", "")
	} else if p.State() != PluginStateRunning {
		failure = apicontract.RPCErrorResponse(-32002, "Plugin not running", "")
	} else {
		c.Set(rpcContractPluginKey, p)
		return nil
	}
	response := apicontract.SuccessDirectJSON(apicontract.RPCSingleResponse(apicontract.RPCFailureReply(failure)))
	return &response
}

func DispatchRPCContract(c *gin.Context, request apicontract.PluginRPCBatchRequest) apicontract.Response[apicontract.PluginRPCResponse] {
	// 此上下文值只由请求的准备阶段写入，不参与请求参数解码。
	value, _ := c.Get(rpcContractPluginKey)
	p, ok := value.(*KernelPlugin)
	if !ok {
		panic("RPC plugin was not prepared")
	}
	response, err := p.dispatchRPCContract(c.Request.Context(), request)
	if err != nil {
		return rpcContractInternalError(err)
	}
	if response == nil {
		return apicontract.SuccessNoContent[apicontract.PluginRPCResponse]()
	}
	return apicontract.SuccessDirectJSON(*response)
}

// dispatchRPCContract 共用单次与批量调用的类型化响应，空值表示不发送通知回复。
func (p *KernelPlugin) dispatchRPCContract(ctx context.Context, request apicontract.PluginRPCBatchRequest) (*apicontract.PluginRPCResponse, error) {
	if request.Error != nil {
		response := apicontract.RPCSingleResponse(apicontract.RPCFailureReply(*request.Error))
		return &response, nil
	}
	requests, err := pluginRPCRequests(request.Calls)
	if err != nil {
		return nil, err
	}
	responses := p.dispatchRpcRequests(ctx, requests)
	var replies []apicontract.PluginRPCReply
	for _, response := range responses {
		if response == nil || response.Response == nil && response.Error == nil {
			continue
		}
		reply, err := pluginRPCReply(response)
		if err != nil {
			return nil, err
		}
		replies = append(replies, reply)
	}
	if len(replies) == 0 {
		return nil, nil
	}
	if request.Batch {
		response := apicontract.RPCBatchResponse(replies)
		return &response, nil
	}
	response := apicontract.RPCSingleResponse(replies[0])
	return &response, nil
}

func rpcContractInternalError(err error) apicontract.Response[apicontract.PluginRPCResponse] {
	failure := apicontract.RPCErrorResponse(-32603, "Internal error", err.Error())
	return apicontract.SuccessDirectJSON(apicontract.RPCSingleResponse(apicontract.RPCFailureReply(failure)))
}

func pluginRPCRequests(calls []apicontract.PluginRPCParsedCall) ([]*JsonRpcProcessingRequest, error) {
	requests := make([]*JsonRpcProcessingRequest, len(calls))
	for i, call := range calls {
		if call.Error != nil {
			data, err := json.Marshal(call.Error)
			if err != nil {
				return nil, err
			}
			var failure JsonRpcErrorResponse
			if err := json.Unmarshal(data, &failure); err != nil {
				return nil, err
			}
			requests[i] = &JsonRpcProcessingRequest{Error: &failure}
			continue
		}
		if call.Request == nil {
			return nil, fmt.Errorf("RPC call requires a request or error")
		}
		request := &JsonRpcRequest{JsonRpc: JsonRpcVersion, Method: call.Request.Method}
		request.Params.Exists, request.ID.Exists = call.Request.ParamsPresent, call.Request.IDPresent
		// 只有 RPC 的参数和关联标识进入脚本运行时的动态值，方法和请求结构保持类型约束。
		params, err := json.Marshal(call.Request.Params)
		if err != nil {
			return nil, err
		}
		if err := json.Unmarshal(params, &request.Params.Value); err != nil {
			return nil, err
		}
		request.Params.IsNull = call.Request.ParamsNull
		id, err := json.Marshal(call.Request.ID)
		if err != nil {
			return nil, err
		}
		if err := json.Unmarshal(id, &request.ID.Value); err != nil {
			return nil, err
		}
		request.ID.IsNull = string(id) == "null" && request.ID.Exists
		requests[i] = &JsonRpcProcessingRequest{Request: request}
	}
	return requests, nil
}

func pluginRPCReply(response *JsonRpcProcessingResponse) (apicontract.PluginRPCReply, error) {
	if response.Response != nil {
		value := response.Response
		result, err := json.Marshal(value.Result)
		if err != nil {
			return apicontract.PluginRPCReply{}, err
		}
		encoded, err := apicontract.EncodedJSONValue(result)
		if err != nil {
			return apicontract.PluginRPCReply{}, err
		}
		id, err := pluginRPCID(value.ID)
		if err != nil {
			return apicontract.PluginRPCReply{}, err
		}
		return apicontract.RPCSuccessReply(apicontract.PluginRPCSuccess{JSONRPC: value.JsonRpc, Result: encoded, ID: id}), nil
	}
	value := response.Error
	if value == nil {
		return apicontract.PluginRPCReply{}, fmt.Errorf("RPC reply requires a response or error")
	}
	id, err := pluginRPCID(value.ID)
	if err != nil {
		return apicontract.PluginRPCReply{}, err
	}
	result := apicontract.PluginRPCFailure{JSONRPC: value.JsonRpc, ID: id}
	if value.Error != nil {
		result.Error = &apicontract.PluginRPCError{Code: int(value.Error.Code), Message: value.Error.Message}
		if value.Error.Data != nil {
			data, err := json.Marshal(value.Error.Data)
			if err != nil {
				return apicontract.PluginRPCReply{}, err
			}
			encoded, err := apicontract.EncodedJSONValue(data)
			if err != nil {
				return apicontract.PluginRPCReply{}, err
			}
			result.Error.Data = &encoded
		}
	}
	return apicontract.RPCFailureReply(result), nil
}

func pluginRPCID(value interface{}) (id apicontract.PluginRPCID, err error) {
	data, err := json.Marshal(value)
	if err == nil {
		err = json.Unmarshal(data, &id)
	}
	return
}

func pluginRPCNotification(method string, params util.Optional[any]) (apicontract.PluginRPCNotification, error) {
	result := apicontract.PluginRPCNotification{JSONRPC: JsonRpcVersion, Method: method}
	if params.Exists {
		data, err := json.Marshal(params)
		if err != nil {
			return result, err
		}
		value, err := apicontract.EncodedJSONValue(data)
		if err != nil {
			return result, err
		}
		result.Params = &value
	}
	return result, nil
}
