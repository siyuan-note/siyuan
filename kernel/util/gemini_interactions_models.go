// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
)

func listGeminiInteractionModels(ctx context.Context, client *AIClient) ([]AvailableModel, error) {
	endpoint, err := geminiInteractionsEndpoint(client.baseURL, "models")
	if err != nil {
		return nil, err
	}
	parsed, _ := url.Parse(endpoint)
	var models []AvailableModel
	seen, cursors := map[string]bool{}, map[string]bool{}
	cursor := ""
	for {
		query := parsed.Query()
		query.Set("pageSize", "1000")
		if cursor != "" {
			query.Set("pageToken", cursor)
		}
		parsed.RawQuery = query.Encode()
		req, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
		if reqErr != nil {
			return nil, reqErr
		}
		resp, reqErr := client.geminiHTTP.Do(req)
		if reqErr != nil {
			return nil, reqErr
		}
		page, pageErr := readGeminiModelsPage(resp)
		if pageErr != nil {
			return nil, pageErr
		}
		for _, model := range page.Models {
			id := strings.TrimPrefix(strings.TrimSpace(model.Name), "models/")
			if id == "" || seen[id] {
				continue
			}
			seen[id] = true
			models = append(models, AvailableModel{ID: id, ContextLength: firstValidModelContextLength(model.InputTokenLimit)})
		}
		cursor = page.NextPageToken
		if cursor == "" {
			return models, nil
		}
		if cursors[cursor] || len(models) > 100000 {
			return nil, errors.New("invalid Gemini model pagination")
		}
		cursors[cursor] = true
	}
}

type geminiModelsPage struct {
	Models []struct {
		Name            string          `json:"name"`
		InputTokenLimit json.RawMessage `json:"inputTokenLimit"`
	} `json:"models"`
	NextPageToken string `json:"nextPageToken"`
}

func readGeminiModelsPage(response *http.Response) (page geminiModelsPage, err error) {
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(response.Body, 64*1024))
		return page, geminiInteractionsError(data, response.StatusCode)
	}
	err = json.NewDecoder(io.LimitReader(response.Body, geminiResponseLimit)).Decode(&page)
	return
}
