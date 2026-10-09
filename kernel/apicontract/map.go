package apicontract

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"reflect"
)

// MapConfig 为脱敏配置，只提供服务标识、供应商和凭据存在状态，不返回凭据内容。
type MapConfig struct {
	Services []*MapService `json:"services"`
	Revision string        `json:"revision"`
}

type MapService struct {
	ID              string `json:"id"`
	Name            string `json:"name"`
	Provider        string `json:"provider" api:"enum=amap|tencent|baidu|openfreemap"`
	HasAPIKey       bool   `json:"hasAPIKey"`
	HasSecurityCode bool   `json:"hasSecurityCode"`
	Configured      bool   `json:"configured"`
}

// MapSetConfRequest 整体替换最多 100 个本机服务，要求管理员和可写工作空间。
// 空列表删除全部服务；不接受未知字段、null 或任意远程服务地址。
// expectedRevision 必须与读取的 revision 一致；旧配置初始为空字符串。
// 冲突返回 code=-1、msg=mapSettingsConflict，不修改服务和凭据；成功后生成新的独立版本号。
type MapSetConfRequest struct {
	Services         []MapServiceInput `json:"services"`
	ExpectedRevision string            `json:"expectedRevision"`
}

// MapServiceInput 的凭据省略时保留相同供应商的值，显式空字符串清除，切换供应商清除旧凭据。
// ID 省略或为空时生成；非空 ID 须匹配 [A-Za-z0-9][A-Za-z0-9_-]{0,127}，本机缺失时按原 ID 创建。
// 名称去除首尾空白后为 1 至 256 字节，凭据最多 4096 字节。
// AMap 需要 APIKey 和 SecurityCode，腾讯及百度需要 APIKey，OpenFreeMap 不使用凭据。
type MapServiceInput struct {
	ID           string  `json:"id" api:"optional"`
	Name         string  `json:"name" api:"trim"`
	Provider     string  `json:"provider" api:"enum=amap|tencent|baidu|openfreemap"`
	APIKey       *string `json:"apiKey,omitempty" api:"optional,nonnullable"`
	SecurityCode *string `json:"securityCode,omitempty" api:"optional,nonnullable"`
}

type MapRuntimeRequest struct {
	ServiceID string `json:"serviceID" api:"trim"`
}

// MapRuntime 只向管理员返回指定服务的运行凭据，响应禁止缓存；服务缺失或未配置时返回错误。
// 浏览器 SDK 凭据对当前浏览器和选中的地图供应商可见，不通过发布页或配置导出提供。
// 启用 SIYUAN_ACCESS_AUTH_CODE_BYPASS 的进程返回 code=-1、msg=mapAuthenticationBypass，
// 不提供运行凭据，避免沙箱导航后绕过内核鉴权。
type MapRuntime struct {
	Provider     string `json:"provider" api:"enum=amap|tencent|baidu|openfreemap"`
	APIKey       string `json:"apiKey,omitempty"`
	SecurityCode string `json:"securityCode,omitempty"`
}

func init() {
	MapSetConf.decodeRequest = decodeMapSetConf
}

func decodeMapSetConf(reader io.Reader) (request MapSetConfRequest, err error) {
	var fields map[string]json.RawMessage
	decoder := json.NewDecoder(reader)
	if err = decoder.Decode(&fields); err != nil {
		return request, errors.New("invalid map configuration request")
	}
	if decoder.Decode(new(json.RawMessage)) != io.EOF {
		return request, errors.New("unexpected data after map configuration")
	}
	if len(fields) != 2 || fields["services"] == nil || fields["expectedRevision"] == nil {
		return request, errors.New("map configuration must contain services and expectedRevision")
	}
	var services []map[string]json.RawMessage
	if err = json.Unmarshal(fields["services"], &services); err != nil || services == nil {
		return request, errors.New("map services must be an array")
	}
	for _, service := range services {
		for key, value := range service {
			switch key {
			case "id", "name", "provider", "apiKey", "securityCode":
			default:
				return request, errors.New("unknown map service field")
			}
			if bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
				return request, errors.New("map service fields must not be null")
			}
		}
	}
	err = decodeRequestFields(reflect.ValueOf(&request).Elem(), fields)
	return
}
