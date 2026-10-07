// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package util

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
)

const (
	defaultExaURL     = "https://mcp.exa.ai/mcp"
	maxWebSearchChars = 50000
)

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

func WebSearch(query, exaApiKey string) (string, error) {
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

	resp, err := httpclient.NewBrowserRequest().SetHeader("Accept", "application/json, text/event-stream").SetBody(reqBody).Post(exaURL)
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
