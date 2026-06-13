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
	"encoding/hex"
	"encoding/json"
	"os"
	"strconv"

	"github.com/88250/lute/ast"
	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type AI struct {
	MCP       *MCP       `json:"mcp"`
	Embedding *Embedding `json:"embedding"`
	Agent     *Agent     `json:"agent"`
	Providers []*Provider `json:"providers"`
}

type Agent struct {
	SessionTimeout      int     `json:"sessionTimeout"`
	ConfirmTimeout      int     `json:"confirmTimeout"`
	MaxRetries          int     `json:"maxRetries"`
	Temperature         float64 `json:"temperature"`
	MaxCompletionTokens int     `json:"maxCompletionTokens"`
	MaxToolCallRounds   int     `json:"maxToolCallRounds"`
}

type Embedding struct {
	ID          string          `json:"id,omitempty"`
	DisplayName string          `json:"displayName,omitempty"`
	Enabled     bool            `json:"enabled,omitempty"`
	APIKey      string          `json:"apiKey"`
	BaseURL     string          `json:"baseURL"`
	Name        string          `json:"name"`
	Timeout     int             `json:"timeout"`
}

type Provider struct {
	ID             string          `json:"id,omitempty"`
	DisplayName    string          `json:"displayName,omitempty"`
	Enabled        bool            `json:"enabled,omitempty"`
	APIKey         string          `json:"apiKey"`
	BaseURL        string          `json:"baseURL"`
	RequestTimeout int             `json:"requestTimeout"`
	Models         []*Model        `json:"models"`
}

type Model struct {
	ID          string  `json:"id,omitempty"`
	DisplayName string  `json:"displayName,omitempty"`
	Enabled     bool    `json:"enabled,omitempty"`
	Name        string  `json:"name"`
	MaxTokens   int     `json:"maxTokens"`
	Temperature float64 `json:"temperature"`
	MaxContexts int     `json:"maxContexts"`
}

type MCP struct {
	Servers []MCPServer `json:"servers"`
}

type MCPServer struct {
	Name    string            `json:"name"`
	Enabled bool              `json:"enabled"`
	Type    string            `json:"type"`
	Command string            `json:"command"`
	Args    []string          `json:"args"`
	URL     string            `json:"url"`
	Headers map[string]string `json:"headers"`
	Timeout int               `json:"timeout"`
}

func NewAI() *AI {
	ai := &AI{
		Agent: &Agent{
			SessionTimeout:      600,
			ConfirmTimeout:      120,
			MaxRetries:          3,
			Temperature:         1.0,
			MaxCompletionTokens: 4096,
			MaxToolCallRounds:   64,
		},
	}

	provider := &Provider{
		BaseURL:        "https://api.openai.com/v1",
		RequestTimeout: 30,
	}
	provider.APIKey = os.Getenv("SIYUAN_OPENAI_API_KEY")

	if timeout := os.Getenv("SIYUAN_OPENAI_API_TIMEOUT"); "" != timeout {
		if v, err := strconv.Atoi(timeout); err == nil {
			provider.RequestTimeout = v
		}
	}
	if baseURL := os.Getenv("SIYUAN_OPENAI_API_BASE_URL"); "" != baseURL {
		provider.BaseURL = baseURL
	}

	model := &Model{
		Name:        openai.GPT3Dot5Turbo,
		Temperature: 1.0,
		MaxContexts: 7,
	}
	if maxTokens := os.Getenv("SIYUAN_OPENAI_API_MAX_TOKENS"); "" != maxTokens {
		if v, err := strconv.Atoi(maxTokens); err == nil {
			model.MaxTokens = v
		}
	}
	if temperature := os.Getenv("SIYUAN_OPENAI_API_TEMPERATURE"); "" != temperature {
		if v, err := strconv.ParseFloat(temperature, 64); err == nil {
			model.Temperature = v
		}
	}
	if maxContexts := os.Getenv("SIYUAN_OPENAI_API_MAX_CONTEXTS"); "" != maxContexts {
		if v, err := strconv.Atoi(maxContexts); err == nil {
			model.MaxContexts = v
		}
	}

	provider.Models = append(provider.Models, model)
	ai.Providers = append(ai.Providers, provider)

	if agentTimeout := os.Getenv("SIYUAN_OPENAI_AGENT_TIMEOUT"); "" != agentTimeout {
		if v, err := strconv.Atoi(agentTimeout); err == nil {
			ai.Agent.SessionTimeout = v
		}
	}
	if agentConfirmTimeout := os.Getenv("SIYUAN_OPENAI_AGENT_CONFIRM_TIMEOUT"); "" != agentConfirmTimeout {
		if v, err := strconv.Atoi(agentConfirmTimeout); err == nil {
			ai.Agent.ConfirmTimeout = v
		}
	}
	if agentMaxRetries := os.Getenv("SIYUAN_OPENAI_AGENT_MAX_RETRIES"); "" != agentMaxRetries {
		if v, err := strconv.Atoi(agentMaxRetries); err == nil {
			ai.Agent.MaxRetries = v
		}
	}
	if agentTemperature := os.Getenv("SIYUAN_OPENAI_AGENT_TEMPERATURE"); "" != agentTemperature {
		if v, err := strconv.ParseFloat(agentTemperature, 64); err == nil {
			ai.Agent.Temperature = v
		}
	}
	if agentMaxCompletionTokens := os.Getenv("SIYUAN_OPENAI_AGENT_MAX_COMPLETION_TOKENS"); "" != agentMaxCompletionTokens {
		if v, err := strconv.Atoi(agentMaxCompletionTokens); err == nil {
			ai.Agent.MaxCompletionTokens = v
		}
	}
	if agentMaxToolCallRounds := os.Getenv("SIYUAN_OPENAI_AGENT_MAX_TOOL_CALL_ROUNDS"); "" != agentMaxToolCallRounds {
		if v, err := strconv.Atoi(agentMaxToolCallRounds); err == nil {
			ai.Agent.MaxToolCallRounds = v
		}
	}

	embeddingKey := os.Getenv("SIYUAN_OPENAI_EMBEDDING_API_KEY")
	embeddingBaseURL := os.Getenv("SIYUAN_OPENAI_EMBEDDING_BASE_URL")
	embeddingModel := os.Getenv("SIYUAN_OPENAI_EMBEDDING_MODEL")
	if "" != embeddingKey && "" != embeddingBaseURL && "" != embeddingModel {
		ai.Embedding = &Embedding{
			APIKey:  embeddingKey,
			BaseURL: embeddingBaseURL,
			Name:    embeddingModel,
			Timeout: 30,
		}
	}

	return ai
}

func (ai *AI) HasAnyProvider() bool {
	for _, p := range ai.Providers {
		if p != nil && len(p.APIKey) > 0 {
			for _, m := range p.Models {
				if m.Name != "" {
					return true
				}
			}
		}
	}
	return false
}

func (ai *AI) GetModel(id string) (*Provider, *Model) {
	if id == "" {
		for _, p := range ai.Providers {
			if p == nil || len(p.APIKey) == 0 {
				continue
			}
			for _, m := range p.Models {
				if m.Name != "" {
					return p, m
				}
			}
		}
		if len(ai.Providers) > 0 && ai.Providers[0] != nil && len(ai.Providers[0].Models) > 0 {
			return ai.Providers[0], ai.Providers[0].Models[0]
		}
		return nil, nil
	}

	for _, p := range ai.Providers {
		if p == nil {
			continue
		}
		for _, m := range p.Models {
			if m.ID == id && len(p.APIKey) > 0 {
				return p, m
			}
		}
	}

	for _, p := range ai.Providers {
		if p == nil {
			continue
		}
		for _, m := range p.Models {
			if m.DisplayName == id && len(p.APIKey) > 0 {
				return p, m
			}
		}
	}

	for _, p := range ai.Providers {
		if p == nil {
			continue
		}
		for _, m := range p.Models {
			if m.Name == id && len(p.APIKey) > 0 {
				return p, m
			}
		}
	}

	if len(ai.Providers) > 0 && ai.Providers[0] != nil && len(ai.Providers[0].Models) > 0 {
		return ai.Providers[0], ai.Providers[0].Models[0]
	}
	return nil, nil
}

func (ai *AI) Normalize() {
	for _, p := range ai.Providers {
		if p == nil {
			continue
		}
		if p.ID == "" {
			p.ID = ast.NewNodeID()
		}
		for _, m := range p.Models {
			if m == nil {
				continue
			}
			if m.ID == "" {
				m.ID = ast.NewNodeID()
			}
			if m.DisplayName == "" {
				m.DisplayName = m.Name
			}
		}
	}
	if ai.Embedding != nil {
		if ai.Embedding.ID == "" {
			ai.Embedding.ID = ast.NewNodeID()
		}
		if ai.Embedding.DisplayName == "" {
			ai.Embedding.DisplayName = ai.Embedding.Name
		}
	}
}

func (ai *AI) DecryptAPIKeys() {
	for _, p := range ai.Providers {
		if p == nil || p.APIKey == "" {
			continue
		}
		if dec := util.AESDecrypt(p.APIKey); len(dec) > 0 {
			if plain, err := hex.DecodeString(string(dec)); err == nil {
				p.APIKey = string(plain)
			}
		}
	}
	if ai.Embedding != nil && ai.Embedding.APIKey != "" {
		if dec := util.AESDecrypt(ai.Embedding.APIKey); len(dec) > 0 {
			if plain, err := hex.DecodeString(string(dec)); err == nil {
				ai.Embedding.APIKey = string(plain)
			}
		}
	}
}

func (ai *AI) EncryptAPIKeys() {
	for _, p := range ai.Providers {
		if p == nil {
			continue
		}
		p.APIKey = util.AESEncrypt(p.APIKey)
	}
	if ai.Embedding != nil {
		ai.Embedding.APIKey = util.AESEncrypt(ai.Embedding.APIKey)
	}
}

func NeedsAIMigration(data []byte) bool {
	var topRaw map[string]json.RawMessage
	if err := json.Unmarshal(data, &topRaw); err != nil {
		return false
	}
	aiRaw, ok := topRaw["ai"]
	if !ok {
		return false
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(aiRaw, &raw); err != nil {
		return false
	}
	_, ok = raw["openAI"]
	return ok
}

func MigrateAI(data []byte) *AI {
	var topRaw map[string]json.RawMessage
	if err := json.Unmarshal(data, &topRaw); err != nil {
		return NewAI()
	}
	aiRaw, ok := topRaw["ai"]
	if !ok {
		return NewAI()
	}
	var raw map[string]any
	if err := json.Unmarshal(aiRaw, &raw); err != nil {
		return NewAI()
	}

	ai := &AI{}

	if mcp, ok := raw["mcp"].(map[string]any); ok {
		ai.MCP = migrateMCP(mcp)
	}

	if oai, ok := raw["openAI"].(map[string]any); ok {
		prov := migrateProvider(oai)
		m := migrateModel(oai)
		prov.Models = append(prov.Models, m)
		ai.Providers = append(ai.Providers, prov)

		ai.Agent = &Agent{
			SessionTimeout: getInt(oai, "agentTimeout"),
			ConfirmTimeout: getInt(oai, "agentConfirmTimeout"),
			MaxRetries:     getInt(oai, "agentMaxRetries"),
		}
	}

	if provs, ok := raw["providers"].([]any); ok {
		for _, item := range provs {
			p, ok2 := item.(map[string]any)
			if !ok2 {
				continue
			}
			if getString(p, "type") == "embedding" {
				ai.Embedding = migrateEmbedding(p)
			} else {
				m := migrateModel(p)
				oldBaseURL := getString(p, "apiBaseURL")
				if existing := findProviderByBaseURL(ai.Providers, oldBaseURL); existing != nil {
					existing.Models = append(existing.Models, m)
				} else {
					prov := migrateProvider(p)
					prov.Models = append(prov.Models, m)
					ai.Providers = append(ai.Providers, prov)
				}
			}
		}
	}

	return ai
}

func findProviderByBaseURL(providers []*Provider, baseURL string) *Provider {
	for _, p := range providers {
		if p != nil && p.BaseURL == baseURL && baseURL != "" {
			return p
		}
	}
	return nil
}

func migrateMCP(raw map[string]any) *MCP {
	mcp := &MCP{}
	servers, ok := raw["servers"].([]any)
	if !ok {
		return mcp
	}
	for _, s := range servers {
		sm, ok2 := s.(map[string]any)
		if !ok2 {
			continue
		}
		mcp.Servers = append(mcp.Servers, MCPServer{
			Name:    getString(sm, "name"),
			Enabled: getBool(sm, "enabled"),
			Type:    getString(sm, "type"),
			Command: getString(sm, "command"),
			Args:    getStringSlice(sm, "args"),
			URL:     getString(sm, "url"),
			Headers: getStringMap(sm, "headers"),
			Timeout: getInt(sm, "timeout"),
		})
	}
	return mcp
}

func migrateProvider(raw map[string]any) *Provider {
	return &Provider{
		ID:             getString(raw, "id"),
		Enabled:        true,
		APIKey:         getString(raw, "apiKey"),
		BaseURL:        getString(raw, "apiBaseURL"),
		RequestTimeout: getInt(raw, "apiTimeout"),
	}
}

func migrateModel(raw map[string]any) *Model {
	enabled := true
	if v, ok := raw["enabled"]; ok {
		if b, ok2 := v.(bool); ok2 && !b {
			enabled = false
		}
	}
	return &Model{
		ID:          getString(raw, "id"),
		DisplayName: getString(raw, "name"),
		Enabled:     enabled,
		Name:        getString(raw, "apiModel"),
		MaxTokens:   getInt(raw, "apiMaxTokens"),
		Temperature: getFloat(raw, "apiTemperature"),
		MaxContexts: getInt(raw, "apiMaxContexts"),
	}
}

func migrateEmbedding(raw map[string]any) *Embedding {
	return &Embedding{
		ID:          getString(raw, "id"),
		DisplayName: getString(raw, "name"),
		Enabled:     getBool(raw, "enabled"),
		APIKey:       getString(raw, "apiKey"),
		BaseURL:     getString(raw, "apiBaseURL"),
		Name:        getString(raw, "apiModel"),
		Timeout:     getInt(raw, "apiTimeout"),
	}
}

func getString(m map[string]any, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func getInt(m map[string]any, key string) int {
	if v, ok := m[key]; ok {
		if f, ok := v.(float64); ok {
			return int(f)
		}
	}
	return 0
}

func getFloat(m map[string]any, key string) float64 {
	if v, ok := m[key]; ok {
		if f, ok := v.(float64); ok {
			return f
		}
	}
	return 0
}

func getBool(m map[string]any, key string) bool {
	if v, ok := m[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return false
}

func getStringSlice(m map[string]any, key string) []string {
	if v, ok := m[key]; ok {
		if arr, ok := v.([]any); ok {
			ret := make([]string, 0, len(arr))
			for _, item := range arr {
				if s, ok := item.(string); ok {
					ret = append(ret, s)
				}
			}
			return ret
		}
	}
	return nil
}

func getStringMap(m map[string]any, key string) map[string]string {
	if v, ok := m[key]; ok {
		if sm, ok := v.(map[string]any); ok {
			ret := make(map[string]string)
			for k, val := range sm {
				if s, ok := val.(string); ok {
					ret[k] = s
				}
			}
			return ret
		}
	}
	return nil
}
