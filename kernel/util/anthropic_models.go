package util

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ListProviderModels 按提供商协议读取模型清单，保持通用接口的返回结构。
func ListProviderModels(apiKey, baseURL, protocol string, timeout int, headers ...map[string]string) ([]AvailableModel, error) {
	if !IsAnthropicMessagesProtocol(protocol) {
		return ListAvailableModelsWithContext(apiKey, baseURL, timeout, headers...)
	}
	if modelsBaseURL := anthropicModelsBaseURL(baseURL); modelsBaseURL != "" {
		return ListAvailableModelsWithContext(apiKey, modelsBaseURL, timeout, headers...)
	}
	if timeout < 1 {
		timeout = 30
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeout)*time.Second)
	defer cancel()
	return listAnthropicModels(ctx, NewAIClientWithModel(apiKey, baseURL, "", headers...))
}

// 百炼的 Messages 入口不提供模型列表，使用同一源站的 OpenAI 兼容入口。
func anthropicModelsBaseURL(baseURL string) string {
	endpoint, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || endpoint.Scheme != "https" || endpoint.User != nil || endpoint.RawQuery != "" || endpoint.Fragment != "" {
		return ""
	}
	switch strings.ToLower(endpoint.Host) {
	case "dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com":
	default:
		return ""
	}
	path := strings.TrimRight(endpoint.Path, "/")
	if path != "/apps/anthropic" && path != "/apps/anthropic/v1" {
		return ""
	}
	endpoint.Path = "/compatible-mode/v1"
	endpoint.RawPath = ""
	return endpoint.String()
}

func listAnthropicModels(ctx context.Context, client *AIClient) ([]AvailableModel, error) {
	var models []AvailableModel
	cursor := ""
	seen := map[string]bool{}
	cursors := map[string]bool{}
	for {
		endpoint, err := anthropicEndpoint(client.baseURL, "models")
		if err != nil {
			return nil, err
		}
		parsed, _ := url.Parse(endpoint)
		query := parsed.Query()
		query.Set("limit", "1000")
		if cursor != "" {
			query.Set("after_id", cursor)
		}
		parsed.RawQuery = query.Encode()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
		if err != nil {
			return nil, err
		}
		resp, err := client.anthropicHTTP.Do(req)
		if err != nil {
			return nil, err
		}
		page, err := readAnthropicModelsPage(resp)
		if err != nil {
			return nil, err
		}
		for _, item := range page.Data {
			id := strings.TrimSpace(item.ID)
			if id == "" || seen[id] {
				continue
			}
			seen[id] = true
			models = append(models, AvailableModel{ID: id,
				ContextLength: firstValidModelContextLength(item.MaxInputTokens, item.ContextLength)})
		}
		if !page.HasMore {
			return models, nil
		}
		if page.LastID == "" || cursors[page.LastID] || len(models) > 100000 {
			return nil, errors.New("invalid Anthropic model pagination")
		}
		cursors[page.LastID] = true
		cursor = page.LastID
	}
}

type anthropicModelsPage struct {
	Data []struct {
		ID             string          `json:"id"`
		MaxInputTokens json.RawMessage `json:"max_input_tokens"`
		ContextLength  json.RawMessage `json:"context_length"`
	} `json:"data"`
	HasMore bool   `json:"has_more"`
	LastID  string `json:"last_id"`
}

func readAnthropicModelsPage(response *http.Response) (page anthropicModelsPage, err error) {
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(response.Body, 64*1024))
		return page, anthropicError(data, response.StatusCode)
	}
	err = json.NewDecoder(io.LimitReader(response.Body, 32*1024*1024)).Decode(&page)
	return
}
