package model

import (
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// NewAIProviderClient 按认证方式创建生成客户端，账户凭证不进入提供商配置。
func NewAIProviderClient(provider *conf.Provider, model string) *util.AIClient {
	if provider.AuthType == "chatgpt" {
		return util.NewChatGPTClient(provider.AccountID)
	}
	return util.NewAIClientWithModel(provider.APIKey, provider.BaseURL, model, ResolveAIProviderHeaders(provider))
}
