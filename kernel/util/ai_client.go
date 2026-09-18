package util

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/sashabaranov/go-openai"
)

const AnthropicProtocolMessages = "anthropic-messages"

// AIClient 共享生成调用的连接配置，按协议选择独立的请求适配器。
type AIClient struct {
	*openai.Client
	baseURL       string
	anthropicHTTP *http.Client
}

// AIMessageContent 保存供应商原生内容，显示文本与恢复上下文分别使用各自的表示。
type AIMessageContent struct {
	Protocol string            `json:"protocol"`
	Version  int               `json:"version"`
	Blocks   []json.RawMessage `json:"blocks"`
}

func CloneAIMessageContent(content *AIMessageContent) *AIMessageContent {
	if content == nil {
		return nil
	}
	ret := *content
	ret.Blocks = CloneOpenAIResponseOutput(content.Blocks)
	return &ret
}

func IsAnthropicMessagesProtocol(protocol string) bool {
	return strings.EqualFold(strings.TrimSpace(protocol), AnthropicProtocolMessages)
}

type aiMessageContentContextKey struct{}

// ContextWithAIMessageContents 按助手消息顺序附加原生内容，图片降级不会改变消息对应关系。
func ContextWithAIMessageContents(ctx context.Context, contents []*AIMessageContent) context.Context {
	return context.WithValue(ctx, aiMessageContentContextKey{}, contents)
}

func aiMessageContents(ctx context.Context) []*AIMessageContent {
	contents, _ := ctx.Value(aiMessageContentContextKey{}).([]*AIMessageContent)
	return contents
}
