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
	OpenAI *OpenAI `json:"openAI"`
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
	EmbeddingModel      string  `json:"embeddingModel"`
	EmbeddingBaseURL    string  `json:"embeddingBaseURL"`
	EmbeddingAPIKey     string  `json:"embeddingAPIKey"`
	AgentTimeout        int     `json:"agentTimeout"`        // total session timeout, seconds, 0 = no limit
	AgentConfirmTimeout int     `json:"agentConfirmTimeout"` // confirmation timeout, seconds
	AgentMaxRetries     int     `json:"agentMaxRetries"`     // max API retry attempts on failure
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
	if embeddingBaseURL := os.Getenv("SIYUAN_OPENAI_EMBEDDING_BASE_URL"); "" != embeddingBaseURL {
		openAI.EmbeddingBaseURL = embeddingBaseURL
	}
	if embeddingAPIKey := os.Getenv("SIYUAN_OPENAI_EMBEDDING_API_KEY"); "" != embeddingAPIKey {
		openAI.EmbeddingAPIKey = embeddingAPIKey
	}
	if embeddingModel := os.Getenv("SIYUAN_OPENAI_EMBEDDING_MODEL"); "" != embeddingModel {
		openAI.EmbeddingModel = embeddingModel
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
	return &AI{OpenAI: openAI}
}
