package model

import (
	"net/url"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

// ResolveAIProviderHeaders 在创建请求客户端时解析密钥和变量，保留配置中的引用文本。
// 密钥只允许解析到其允许主机列表中的供应商地址，跨源重定向由请求传输层隔离。
func ResolveAIProviderHeaders(provider *conf.Provider) map[string]string {
	if provider == nil || len(provider.Headers) == 0 {
		return nil
	}
	host := ""
	if endpoint, err := url.Parse(provider.BaseURL); err == nil {
		host = endpoint.Hostname()
	}
	headers := make(map[string]string, len(provider.Headers))
	for name, value := range provider.Headers {
		if Conf != nil {
			value = conf.ResolveSecretsVarsForHost(Conf.Secrets, Conf.Variables, host, value)
		}
		headers[name] = value
	}
	return headers
}
