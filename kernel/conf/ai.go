// SiYuan - Refactor your thinking
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

package conf

import (
	"os"
	"strconv"

	"github.com/siyuan-note/siyuan/kernel/util"

	"github.com/sashabaranov/go-openai"
)

type AI struct {
	OpenAI    *OpenAI    `json:"openAI"`
	MCP       *MCPConfig `json:"mcp"`
	Providers []*OpenAI  `json:"providers,omitempty"`
}

type MCPConfig struct {
	Servers []MCPServer `json:"servers"`
}

type MCPServer struct {
	Name    string            `json:"name"`
	Enabled bool              `json:"enabled"`
	Type    string            `json:"type"` // "stdio" | "http"
	Command string            `json:"command"`
	Args    []string          `json:"args"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
	Timeout int               `json:"timeout"`
}

type OpenAI struct {
	APIKey              string  `json:"apiKey"`
	APITimeout          int     `json:"apiTimeout"`
	APIProxy            string  `json:"apiProxy"`
	APIModel            string  `json:"apiModel"`
	APIMaxTokens        int     `json:"apiMaxTokens"`
	APITemperature      float64 `json:"apiTemperature"`
	APIMaxContexts      int     `json:"apiMaxContexts"`
	APIBaseURL          string  `json:"apiBaseURL"`
	APIUserAgent        string  `json:"apiUserAgent"`
	APIProvider         string  `json:"apiProvider"` // OpenAI, Azure
	APIVersion          string  `json:"apiVersion"`  // Azure API version
	Type                string  `json:"type,omitempty"`      // empty or "chat" = chat model, "embedding" = embedding model
	AgentTimeout        int     `json:"agentTimeout"`        // total session timeout, seconds, 0 = no limit
	AgentConfirmTimeout int     `json:"agentConfirmTimeout"` // confirmation timeout, seconds
	AgentMaxRetries     int     `json:"agentMaxRetries"`     // max API retry attempts on failure
	Enabled             *bool   `json:"enabled,omitempty"`
}

func NewAI() *AI {
	openAI := &OpenAI{
		APITemperature:      1.0,
		APIMaxContexts:      7,
		APITimeout:          30,
		APIModel:            openai.GPT3Dot5Turbo,
		APIBaseURL:          "https://api.openai.com/v1",
		APIUserAgent:        util.UserAgent,
		APIProvider:         "OpenAI",
		AgentTimeout:        600,
		AgentConfirmTimeout: 120,
		AgentMaxRetries:     3,
	}

	openAI.APIKey = os.Getenv("SIYUAN_OPENAI_API_KEY")

	if timeout := os.Getenv("SIYUAN_OPENAI_API_TIMEOUT"); "" != timeout {
		timeoutInt, err := strconv.Atoi(timeout)
		if err == nil {
			openAI.APITimeout = timeoutInt
		}
	}

	if proxy := os.Getenv("SIYUAN_OPENAI_API_PROXY"); "" != proxy {
		openAI.APIProxy = proxy
	}

	if maxTokens := os.Getenv("SIYUAN_OPENAI_API_MAX_TOKENS"); "" != maxTokens {
		maxTokensInt, err := strconv.Atoi(maxTokens)
		if err == nil {
			openAI.APIMaxTokens = maxTokensInt
		}
	}

	if temperature := os.Getenv("SIYUAN_OPENAI_API_TEMPERATURE"); "" != temperature {
		temperatureFloat, err := strconv.ParseFloat(temperature, 64)
		if err == nil {
			openAI.APITemperature = temperatureFloat
		}
	}

	if maxContexts := os.Getenv("SIYUAN_OPENAI_API_MAX_CONTEXTS"); "" != maxContexts {
		maxContextsInt, err := strconv.Atoi(maxContexts)
		if err == nil {
			openAI.APIMaxContexts = maxContextsInt
		}
	}

	if baseURL := os.Getenv("SIYUAN_OPENAI_API_BASE_URL"); "" != baseURL {
		openAI.APIBaseURL = baseURL
	}

	if userAgent := os.Getenv("SIYUAN_OPENAI_API_USER_AGENT"); "" != userAgent {
		openAI.APIUserAgent = userAgent
	}
	embeddingAPIKey := os.Getenv("SIYUAN_OPENAI_EMBEDDING_API_KEY")
	embeddingBaseURL := os.Getenv("SIYUAN_OPENAI_EMBEDDING_BASE_URL")
	embeddingModel := os.Getenv("SIYUAN_OPENAI_EMBEDDING_MODEL")
	var providers []*OpenAI
	if "" != embeddingAPIKey && "" != embeddingBaseURL && "" != embeddingModel {
		providers = append(providers, &OpenAI{
			APIKey:     embeddingAPIKey,
			APITimeout: 30,
			APIBaseURL: embeddingBaseURL,
			APIModel:   embeddingModel,
			Type:       "embedding",
			Enabled:    &[]bool{true}[0],
		})
	}
	if agentTimeout := os.Getenv("SIYUAN_OPENAI_AGENT_TIMEOUT"); "" != agentTimeout {
		if v, err := strconv.Atoi(agentTimeout); err == nil {
			openAI.AgentTimeout = v
		}
	}
	if agentConfirmTimeout := os.Getenv("SIYUAN_OPENAI_AGENT_CONFIRM_TIMEOUT"); "" != agentConfirmTimeout {
		if v, err := strconv.Atoi(agentConfirmTimeout); err == nil {
			openAI.AgentConfirmTimeout = v
		}
	}
	if agentMaxRetries := os.Getenv("SIYUAN_OPENAI_AGENT_MAX_RETRIES"); "" != agentMaxRetries {
		if v, err := strconv.Atoi(agentMaxRetries); err == nil {
			openAI.AgentMaxRetries = v
		}
	}
	return &AI{OpenAI: openAI, Providers: providers}
}

func (p *OpenAI) IsEnabled() bool {
	return p.Enabled == nil || *p.Enabled
}

func (ai *AI) HasAnyProvider() bool {
	if ai.OpenAI != nil && ai.OpenAI.APIKey != "" && ai.OpenAI.IsEnabled() {
		return true
	}
	for _, p := range ai.Providers {
		if p != nil && p.APIKey != "" && p.IsEnabled() {
			return true
		}
	}
	return false
}

func (ai *AI) GetProvider(model string) *OpenAI {
	if model == "" {
		if ai.OpenAI != nil && ai.OpenAI.IsEnabled() && ai.OpenAI.APIKey != "" {
			return ai.OpenAI
		}
		for _, p := range ai.Providers {
			if p != nil && p.IsEnabled() && p.APIKey != "" {
				return p
			}
		}
		return ai.OpenAI
	}
	for _, p := range ai.Providers {
		if p != nil && p.APIModel == model && p.IsEnabled() && p.APIKey != "" {
			return p
		}
	}
	return ai.OpenAI
}

func (ai *AI) GetEmbeddingProvider() *OpenAI {
	for _, p := range ai.Providers {
		if p != nil && p.Type == "embedding" {
			return p
		}
	}
	if ai.OpenAI != nil && ai.OpenAI.Type == "embedding" {
		return ai.OpenAI
	}
	return nil
}
