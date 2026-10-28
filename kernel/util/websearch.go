// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
)

const (
	defaultExaURL     = "https://mcp.exa.ai/mcp"
	maxWebSearchChars = 50000
)

var webSearchHTTPClient = httpclient.NewBrowserRequest().GetClient().Clone().SetTimeout(0)

type mcpRequest struct {
	JSONRPC string    `json:"jsonrpc"`
	ID      int       `json:"id"`
	Method  string    `json:"method"`
	Params  mcpParams `json:"params"`
}

type mcpParams struct {
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments"`
}

type mcpResponse struct {
	Result *mcpResult        `json:"result,omitempty"`
	Error  *mcpResponseError `json:"error,omitempty"`
}

type mcpResponseError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type mcpResult struct {
	Content []mcpContent `json:"content"`
	IsError bool         `json:"isError,omitempty"`
}

type mcpContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

func WebSearchContext(ctx context.Context, query, exaApiKey string, timeout int) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, time.Duration(NormalizeWebTimeout(timeout))*time.Second)
	defer cancel()
	exaURL := defaultExaURL
	if exaApiKey != "" {
		exaURL += "?exaApiKey=" + url.QueryEscape(exaApiKey)
	}

	reqBody := mcpRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "tools/call",
		Params: mcpParams{
			Name: "web_search_exa",
			Arguments: map[string]any{
				"query":      query,
				"type":       "auto",
				"numResults": 8,
				"livecrawl":  "fallback",
			},
		},
	}

	resp, err := webSearchHTTPClient.R().SetRetryCount(1).SetRetryFixedInterval(3*time.Second).
		SetContext(ctx).SetHeader("Accept", "application/json, text/event-stream").SetBody(reqBody).Post(exaURL)
	if err != nil {
		return "", errors.New("web search failed: " + err.Error())
	}
	return parseWebSearchResponse(resp.Response)
}

func parseWebSearchResponse(resp *http.Response) (string, error) {
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return "", fmt.Errorf("web search failed: HTTP %d", resp.StatusCode)
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", errors.New("web search read response failed: " + err.Error())
	}
	body := string(bodyBytes)

	preview := body
	if len(preview) > 500 {
		preview = body[:500]
	}
	logging.LogInfof("websearch response: status=%d, len=%d, preview=%s", resp.StatusCode, len(body), preview)

	text, err := parseMcpResponse(body)
	if err != nil {
		return "", err
	}
	if text == "" {
		return "No search results found. Please try a different query.", nil
	}

	return truncateRunes(text, maxWebSearchChars), nil
}

func parseMcpResponse(body string) (string, error) {
	if text, err := parseMcpJSON(body); text != "" || err != nil {
		return text, err
	}

	for line := range strings.SplitSeq(body, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "data:") {
			payload := strings.TrimSpace(line[5:])
			if text, err := parseMcpJSON(payload); text != "" || err != nil {
				return text, err
			}
		}
	}

	return "", nil
}

func parseMcpJSON(payload string) (string, error) {
	payload = strings.TrimSpace(payload)
	if !strings.HasPrefix(payload, "{") {
		return "", nil
	}

	var resp mcpResponse
	if err := json.Unmarshal([]byte(payload), &resp); err != nil {
		return "", fmt.Errorf("web search invalid response: %w", err)
	}
	if resp.Error != nil {
		return "", fmt.Errorf("web search RPC error %d: %s", resp.Error.Code, resp.Error.Message)
	}
	if resp.Result == nil {
		return "", nil
	}
	if resp.Result.IsError {
		message := ""
		for _, item := range resp.Result.Content {
			if item.Text != "" {
				message = item.Text
				break
			}
		}
		return "", fmt.Errorf("web search tool failed: %s", message)
	}
	for _, item := range resp.Result.Content {
		if item.Text != "" {
			return item.Text, nil
		}
	}
	return "", nil
}
