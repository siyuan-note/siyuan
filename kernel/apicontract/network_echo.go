package apicontract

import (
	"crypto/tls"
	"encoding/json"
	"net/http"
	"net/url"
)

// 标准库诊断对象保持其原始 JSON 编码；已发布字段由仓库显式声明，不随工具链增加字段。
// 标准库新增字段作为额外 JSON 诊断值保留，已有字段的必填要求、类型和有限多态值仍严格验证。
type NetworkEchoTLS struct{ value *tls.ConnectionState }
type NetworkEchoURL struct{ value *url.URL }
type NetworkEchoCookies struct{ value []*http.Cookie }

func EchoTLS(value *tls.ConnectionState) *NetworkEchoTLS {
	if value == nil {
		return nil
	}
	return &NetworkEchoTLS{value: value}
}
func EchoURL(value *url.URL) *NetworkEchoURL {
	if value == nil {
		return nil
	}
	return &NetworkEchoURL{value: value}
}
func EchoCookies(value []*http.Cookie) NetworkEchoCookies     { return NetworkEchoCookies{value: value} }
func (value NetworkEchoTLS) MarshalJSON() ([]byte, error)     { return json.Marshal(value.value) }
func (value NetworkEchoURL) MarshalJSON() ([]byte, error)     { return json.Marshal(value.value) }
func (value NetworkEchoCookies) MarshalJSON() ([]byte, error) { return json.Marshal(value.value) }
