package util

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"sync"

	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/siyuan/kernel/chatgpt"
)

var chatGPTServices sync.Map

// ChatGPTService 按主机配置目录保存账户，移动端复用 BootMobile 配置的私有 HomeDir。
func ChatGPTService() *chatgpt.Service {
	dir := filepath.Join(HomeDir, ".config", "siyuan", "chatgpt")
	client := httpclient.NewUserAgentClient(nil)
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	service, _ := chatGPTServices.LoadOrStore(dir, chatgpt.Open(dir, client))
	return service.(*chatgpt.Service)
}

type chatGPTTransport struct {
	accountID string
	service   *chatgpt.Service
}

// NewChatGPTClient 使用可刷新账户凭证，并固定公开套餐端点及请求能力。
func NewChatGPTClient(accountID string) *AIClient {
	config := openai.DefaultConfig("")
	config.BaseURL = chatgpt.Resource
	config.HTTPClient = &chatGPTTransport{accountID: accountID, service: ChatGPTService()}
	return &AIClient{Client: openai.NewClientWithConfig(config), baseURL: chatgpt.Resource, ChatGPT: true}
}

func (t *chatGPTTransport) Do(request *http.Request) (*http.Response, error) {
	if request.URL.String() != chatgpt.Resource+"/responses" || request.Method != "POST" {
		return nil, errors.New("unsupported ChatGPT plan route")
	}
	data, err := io.ReadAll(io.LimitReader(request.Body, 32*1024*1024+1))
	request.Body.Close()
	if err != nil || len(data) > 32*1024*1024 {
		return nil, errors.New("invalid ChatGPT inference request")
	}
	data, err = chatGPTRequestBody(data)
	if err != nil {
		return nil, err
	}
	clone := request.Clone(request.Context())
	clone.Body = io.NopCloser(bytes.NewReader(data))
	clone.ContentLength = int64(len(data))
	clone.GetBody = func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(data)), nil }
	return t.service.Do(clone, t.accountID)
}

func chatGPTRequestBody(data []byte) ([]byte, error) {
	var body map[string]json.RawMessage
	if err := json.Unmarshal(data, &body); err != nil {
		return nil, err
	}
	for _, key := range []string{"background", "conversation", "max_output_tokens", "max_tool_calls", "metadata", "moderation",
		"multi_agent", "prompt", "prompt_cache_retention", "safety_identifier", "temperature", "top_logprobs", "top_p", "truncation", "user", "previous_response_id"} {
		delete(body, key)
	}
	body["store"] = json.RawMessage("false")
	body["stream"] = json.RawMessage("true")
	var input []map[string]json.RawMessage
	if err := json.Unmarshal(body["input"], &input); err != nil || input == nil {
		return nil, errors.New("ChatGPT input must contain the conversation history")
	}
	for _, item := range input {
		if string(item["role"]) == `"system"` {
			item["role"] = json.RawMessage(`"developer"`)
		}
		if string(item["type"]) == `"function_call"` {
			item["namespace"] = json.RawMessage(`"siyuan"`)
		}
	}
	body["input"], _ = json.Marshal(input)
	var tools []json.RawMessage
	if raw, exists := body["tools"]; exists {
		if err := json.Unmarshal(raw, &tools); err != nil {
			return nil, err
		}
		if len(tools) > 0 {
			for _, rawTool := range tools {
				var tool struct {
					Type string `json:"type"`
				}
				if err := json.Unmarshal(rawTool, &tool); err != nil {
					return nil, err
				}
				if tool.Type != "function" && tool.Type != "custom" {
					return nil, errors.New("unsupported ChatGPT plan tool")
				}
			}
			body["tools"], _ = json.Marshal([]struct {
				Type        string            `json:"type"`
				Name        string            `json:"name"`
				Description string            `json:"description"`
				Tools       []json.RawMessage `json:"tools"`
			}{
				{Type: "namespace", Name: "siyuan", Description: "Tools for working with notes and the SiYuan workspace", Tools: tools},
			})
		}
	}
	return json.Marshal(body)
}
