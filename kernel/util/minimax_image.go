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
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/sashabaranov/go-openai"
)

func isMiniMaxImageEndpoint(baseURL string) bool {
	u, err := url.Parse(baseURL)
	if err != nil || u.Scheme != "https" || strings.TrimRight(u.Path, "/") != "/v1" {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return host == "api.minimax.io" || host == "api.minimax.cn" || host == "api.minimaxi.com"
}

type miniMaxImageTransport struct {
	base openai.HTTPDoer
}

func (t *miniMaxImageTransport) Do(req *http.Request) (*http.Response, error) {
	if req.Method != http.MethodPost || !strings.HasSuffix(req.URL.Path, "/images/generations") {
		return t.base.Do(req)
	}
	var input struct {
		Model  string `json:"model"`
		Prompt string `json:"prompt"`
		Size   string `json:"size"`
		N      int    `json:"n"`
	}
	err := json.NewDecoder(req.Body).Decode(&input)
	req.Body.Close()
	if err != nil {
		return nil, err
	}
	payload := map[string]any{
		"model": input.Model, "prompt": input.Prompt, "n": input.N,
		"response_format": "url", "prompt_optimizer": true,
	}
	if input.Size == "" || input.Size == "auto" {
		payload["aspect_ratio"] = "1:1"
	} else {
		dimensions := strings.Split(input.Size, "x")
		if len(dimensions) != 2 {
			return nil, errors.New("MiniMax image size must be WIDTHxHEIGHT")
		}
		width, widthErr := strconv.Atoi(dimensions[0])
		height, heightErr := strconv.Atoi(dimensions[1])
		if widthErr != nil || heightErr != nil || width <= 0 || height <= 0 {
			return nil, errors.New("MiniMax image dimensions must be positive integers")
		}
		payload["width"], payload["height"] = width, height
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	converted := req.Clone(req.Context())
	converted.URL.Path = strings.TrimSuffix(req.URL.Path, "/images/generations") + "/image_generation"
	converted.URL.RawPath = ""
	converted.Body = io.NopCloser(bytes.NewReader(body))
	converted.ContentLength = int64(len(body))
	converted.GetBody = func() (io.ReadCloser, error) { return io.NopCloser(bytes.NewReader(body)), nil }
	resp, err := t.base.Do(converted)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		resp.Body.Close()
		return nil, fmt.Errorf("MiniMax image request failed with HTTP status %d", resp.StatusCode)
	}
	var output struct {
		Data struct {
			URLs []string `json:"image_urls"`
		} `json:"data"`
		BaseResp *struct {
			StatusCode int `json:"status_code"`
		} `json:"base_resp"`
	}
	err = json.NewDecoder(io.LimitReader(resp.Body, 1024*1024)).Decode(&output)
	resp.Body.Close()
	if err != nil {
		return nil, err
	}
	if output.BaseResp == nil || output.BaseResp.StatusCode != 0 {
		return nil, errors.New("MiniMax image generation failed")
	}
	if len(output.Data.URLs) == 0 || output.Data.URLs[0] == "" {
		return nil, errors.New("MiniMax image model returned no image")
	}
	data := make([]map[string]string, 0, len(output.Data.URLs))
	for _, imageURL := range output.Data.URLs {
		data = append(data, map[string]string{"url": imageURL})
	}
	body, err = json.Marshal(map[string]any{"data": data})
	if err != nil {
		return nil, err
	}
	resp.Body = io.NopCloser(bytes.NewReader(body))
	resp.ContentLength = int64(len(body))
	resp.Header.Set("Content-Length", strconv.Itoa(len(body)))
	return resp, nil
}
