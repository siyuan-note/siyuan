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
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type AI struct {
	MCP       *MCP        `json:"mcp"`
	Embedding *Embedding  `json:"embedding"`
	Rerank    *Rerank     `json:"rerank"`
	Agent     *Agent      `json:"agent"`
	Editing   *Editing    `json:"editing"`
	Providers []*Provider `json:"providers"`
}

type Agent struct {
	ModelID             string  `json:"modelId"`
	SessionTimeout      int     `json:"sessionTimeout"`
	ConfirmTimeout      int     `json:"confirmTimeout"`
	MaxRetries          int     `json:"maxRetries"`
	Temperature         float64 `json:"temperature"`
	MaxCompletionTokens int     `json:"maxCompletionTokens"`
	MaxToolCallRounds   int     `json:"maxToolCallRounds"`
}

// Editing holds behavior parameters used by the in-editor chat scenario. They
// are kept here (instead of on Model) to mirror Agent and to decouple scenario
// behavior from the model registry. See https://github.com/siyuan-note/siyuan/issues/17797
type Editing struct {
	ModelID             string  `json:"modelId"`
	MaxHistoryMessages  int     `json:"maxHistoryMessages"`  // Max number of prior turns kept as context
	Temperature         float64 `json:"temperature"`         // Alignment with Agent.Temperature
	MaxCompletionTokens int     `json:"maxCompletionTokens"` // Alignment with Agent.MaxCompletionTokens
}

type Embedding struct {
	ID         string `json:"id"`
	Enabled    bool   `json:"enabled"`
	APIKey     string `json:"apiKey"`
	BaseURL    string `json:"baseURL"`
	Name       string `json:"name"`
	Timeout    int    `json:"timeout"`
	Dimensions int    `json:"dimensions"` // 输出向量维度，仅 text-embedding-3 及以上模型支持；0 表示用模型默认值（不传该参数）
}

// Rerank 配置语义搜索结果的重排模型。重排在向量召回后对 query 与候选文档逐对精排，
// 采用主流重排服务的 /rerank 协议（OpenAI 官方暂无 rerank API）。
// 各服务商端点路径不一（Jina /v1/rerank、阿里云 /v1/reranks 等），故 Endpoint 为完整端点地址。
type Rerank struct {
	ID             string `json:"id"`
	Enabled        bool   `json:"enabled"`
	APIKey         string `json:"apiKey"`
	Endpoint       string `json:"endpoint"` // 完整重排端点 URL，按目标模型文档填写
	Name           string `json:"name"`
	Timeout        int    `json:"timeout"`
	CandidateCount int    `json:"candidateCount"` // 向量召回后送入重排的候选文档数，默认 30；越大越准但越慢
}

type Provider struct {
	ID             string   `json:"id"`
	DisplayName    string   `json:"displayName,omitempty"`
	Enabled        bool     `json:"enabled"`
	APIKey         string   `json:"apiKey"`
	BaseURL        string   `json:"baseURL"`
	RequestTimeout int      `json:"requestTimeout"`
	Models         []*Model `json:"models"`
}

// Model is the provider-scoped model registry entry. MaxTokens/Temperature/
// MaxContexts remain the persisted UI-facing config (the settings page still
// reads/writes them). Editing holds the runtime view derived from them.
type Model struct {
	ID          string `json:"id"`
	DisplayName string `json:"displayName,omitempty"`
	Enabled     bool   `json:"enabled"`
	Name        string `json:"name"`
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

func defaultEmbedding() *Embedding {
	return &Embedding{Timeout: 30}
}

func defaultRerank() *Rerank {
	return &Rerank{Timeout: 30, CandidateCount: 30}
}

func defaultAgent() *Agent {
	return &Agent{
		SessionTimeout:      600,
		ConfirmTimeout:      120,
		MaxRetries:          3,
		Temperature:         1.0,
		MaxCompletionTokens: 0,
		MaxToolCallRounds:   64,
	}
}

func defaultEditing() *Editing {
	return &Editing{
		MaxHistoryMessages:  7,
		Temperature:         1.0,
		MaxCompletionTokens: 0,
	}
}

func NewAI() *AI {
	ai := &AI{
		Providers: []*Provider{},
		MCP:       &MCP{Servers: []MCPServer{}},
		Embedding: defaultEmbedding(),
		Rerank:    defaultRerank(),
		Agent:     defaultAgent(),
		Editing:   defaultEditing(),
	}

	apiKey := os.Getenv("SIYUAN_OPENAI_API_KEY")
	apiModel := os.Getenv("SIYUAN_OPENAI_API_MODEL")
	apiBaseURL := os.Getenv("SIYUAN_OPENAI_API_BASE_URL")

	if apiKey != "" && apiModel != "" && apiBaseURL != "" {
		provider := &Provider{
			BaseURL:        apiBaseURL,
			RequestTimeout: 30,
			Enabled:        true,
			APIKey:         apiKey,
		}
		if timeout := os.Getenv("SIYUAN_OPENAI_API_TIMEOUT"); "" != timeout {
			if v, err := strconv.Atoi(timeout); err == nil {
				provider.RequestTimeout = v
			}
		}

		model := &Model{
			Name:    apiModel,
			Enabled: true,
		}
		if maxTokens := os.Getenv("SIYUAN_OPENAI_API_MAX_TOKENS"); "" != maxTokens {
			if v, err := strconv.Atoi(maxTokens); err == nil {
				ai.Editing.MaxCompletionTokens = v
			}
		}
		if temperature := os.Getenv("SIYUAN_OPENAI_API_TEMPERATURE"); "" != temperature {
			if v, err := strconv.ParseFloat(temperature, 64); err == nil {
				ai.Editing.Temperature = v
			}
		}
		if maxContexts := os.Getenv("SIYUAN_OPENAI_API_MAX_CONTEXTS"); "" != maxContexts {
			if v, err := strconv.Atoi(maxContexts); err == nil {
				ai.Editing.MaxHistoryMessages = v
			}
		}

		provider.Models = append(provider.Models, model)
		ai.Providers = append(ai.Providers, provider)
	}

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

	rerankKey := os.Getenv("SIYUAN_OPENAI_RERANK_API_KEY")
	rerankEndpoint := os.Getenv("SIYUAN_OPENAI_RERANK_ENDPOINT")
	rerankModel := os.Getenv("SIYUAN_OPENAI_RERANK_MODEL")
	if "" != rerankKey && "" != rerankEndpoint && "" != rerankModel {
		ai.Rerank = &Rerank{
			APIKey:         rerankKey,
			Endpoint:       rerankEndpoint,
			Name:           rerankModel,
			Timeout:        30,
			CandidateCount: 30,
		}
	}

	return ai
}

func (ai *AI) HasAnyProvider() bool {
	for _, p := range ai.Providers {
		if p != nil && len(p.APIKey) > 0 && p.Enabled {
			for _, m := range p.Models {
				if m.Name != "" && m.Enabled {
					return true
				}
			}
		}
	}
	return false
}

func (ai *AI) GetModel(id string) (*Provider, *Model) {
	if id == "" {
		return nil, nil
	}

	for _, p := range ai.Providers {
		if p == nil || len(p.APIKey) == 0 || !p.Enabled {
			continue
		}
		for _, m := range p.Models {
			if m.ID == id && m.Enabled {
				return p, m
			}
		}
	}

	for _, p := range ai.Providers {
		if p == nil || len(p.APIKey) == 0 || !p.Enabled {
			continue
		}
		for _, m := range p.Models {
			if m.DisplayName == id && m.Enabled {
				return p, m
			}
		}
	}

	for _, p := range ai.Providers {
		if p == nil || len(p.APIKey) == 0 || !p.Enabled {
			continue
		}
		for _, m := range p.Models {
			if m.Name == id && m.Enabled {
				return p, m
			}
		}
	}

	return nil, nil
}

func (ai *AI) GetEditingModel() (*Provider, *Model) {
	if ai.Editing == nil || ai.Editing.ModelID == "" {
		return nil, nil
	}
	return ai.GetModel(ai.Editing.ModelID)
}

func (ai *AI) GetAgentModel() (*Provider, *Model) {
	if ai.Agent == nil || ai.Agent.ModelID == "" {
		return nil, nil
	}
	return ai.GetModel(ai.Agent.ModelID)
}

func (ai *AI) Normalize() {
	if ai.Providers == nil {
		ai.Providers = []*Provider{}
	}
	if ai.MCP == nil {
		ai.MCP = &MCP{Servers: []MCPServer{}}
	} else if ai.MCP.Servers == nil {
		ai.MCP.Servers = []MCPServer{}
	}
	if ai.Agent == nil {
		ai.Agent = defaultAgent()
	}
	if ai.Editing == nil {
		ai.Editing = defaultEditing()
	} else {
		if 0 > ai.Editing.MaxCompletionTokens {
			ai.Editing.MaxCompletionTokens = 0
		}
		if 0 > ai.Editing.Temperature {
			ai.Editing.Temperature = 0
		} else if 2 < ai.Editing.Temperature {
			ai.Editing.Temperature = 2
		}
		if 1 > ai.Editing.MaxHistoryMessages {
			ai.Editing.MaxHistoryMessages = 1
		} else if 64 < ai.Editing.MaxHistoryMessages {
			ai.Editing.MaxHistoryMessages = 64
		}
	}
	providers := make([]*Provider, 0, len(ai.Providers))
	for _, p := range ai.Providers {
		if p == nil {
			continue
		}
		p.BaseURL = strings.TrimSpace(p.BaseURL)
		if "" == p.BaseURL {
			p.BaseURL = "https://api.openai.com/v1"
		}
		p.DisplayName = strings.TrimSpace(p.DisplayName)
		p.APIKey = strings.TrimSpace(p.APIKey)
		if 1 > p.RequestTimeout {
			p.RequestTimeout = 30
		} else if 600 < p.RequestTimeout {
			p.RequestTimeout = 600
		}
		if !ast.IsNodeIDPattern(p.ID) {
			p.ID = ast.NewNodeID()
		}
		models := make([]*Model, 0, len(p.Models))
		for _, m := range p.Models {
			if m == nil {
				continue
			}
			m.Name = strings.TrimSpace(m.Name)
			if "" == m.Name {
				m.Name = "model"
			}
			m.DisplayName = strings.TrimSpace(m.DisplayName)
			if !ast.IsNodeIDPattern(m.ID) {
				m.ID = ast.NewNodeID()
			}
			models = append(models, m)
		}
		p.Models = models
		providers = append(providers, p)
	}
	ai.Providers = providers
	if ai.Embedding == nil {
		ai.Embedding = defaultEmbedding()
	}
	if ai.Embedding.Timeout < 1 {
		ai.Embedding.Timeout = 30
	}
	if ai.Embedding.Dimensions < 0 {
		ai.Embedding.Dimensions = 0 // 负值非法，归零表示用模型默认维度
	}
	if !ast.IsNodeIDPattern(ai.Embedding.ID) {
		ai.Embedding.ID = ast.NewNodeID()
	}
	if ai.Rerank == nil {
		ai.Rerank = defaultRerank()
	}
	if ai.Rerank.Timeout < 1 {
		ai.Rerank.Timeout = 30
	}
	if ai.Rerank.CandidateCount < 5 {
		ai.Rerank.CandidateCount = 5
	} else if ai.Rerank.CandidateCount > 100 {
		ai.Rerank.CandidateCount = 100
	}
	if !ast.IsNodeIDPattern(ai.Rerank.ID) {
		ai.Rerank.ID = ast.NewNodeID()
	}
}

func (ai *AI) DecryptAPIKeys() {
	for _, p := range ai.Providers {
		if p == nil || p.APIKey == "" {
			continue
		}
		dec := util.AESDecrypt(p.APIKey)
		if dec == nil {
			continue
		}
		if plain, err := hex.DecodeString(string(dec)); err == nil {
			p.APIKey = string(plain)
		}
	}
	if ai.Embedding != nil && ai.Embedding.APIKey != "" {
		dec := util.AESDecrypt(ai.Embedding.APIKey)
		if dec == nil {
			return
		}
		if plain, err := hex.DecodeString(string(dec)); err == nil {
			ai.Embedding.APIKey = string(plain)
		}
	}
	if ai.Rerank != nil && ai.Rerank.APIKey != "" {
		dec := util.AESDecrypt(ai.Rerank.APIKey)
		if dec == nil {
			return
		}
		if plain, err := hex.DecodeString(string(dec)); err == nil {
			ai.Rerank.APIKey = string(plain)
		}
	}
}

func (ai *AI) EncryptAPIKeys() {
	for _, p := range ai.Providers {
		if p == nil || p.APIKey == "" {
			continue
		}
		p.APIKey = util.AESEncrypt(p.APIKey)
	}
	if ai.Embedding != nil && ai.Embedding.APIKey != "" {
		ai.Embedding.APIKey = util.AESEncrypt(ai.Embedding.APIKey)
	}
	if ai.Rerank != nil && ai.Rerank.APIKey != "" {
		ai.Rerank.APIKey = util.AESEncrypt(ai.Rerank.APIKey)
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
			SessionTimeout:    getInt(oai, "agentTimeout"),
			ConfirmTimeout:    getInt(oai, "agentConfirmTimeout"),
			MaxRetries:        getInt(oai, "agentMaxRetries"),
			MaxToolCallRounds: 64,
		}

		maxContexts := getInt(oai, "apiMaxContexts")
		ai.Editing = &Editing{
			MaxHistoryMessages:  maxContexts,
			Temperature:         getFloat(oai, "apiTemperature"),
			MaxCompletionTokens: getInt(oai, "apiMaxTokens"),
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

	ai.Normalize()
	assignDefaultModelIDs(ai)

	return ai
}

func assignDefaultModelIDs(ai *AI) {
	if (ai.Editing != nil && ai.Editing.ModelID != "") || (ai.Agent != nil && ai.Agent.ModelID != "") {
		return
	}
	var m *Model
	for _, p := range ai.Providers {
		if p == nil || len(p.APIKey) == 0 || !p.Enabled {
			continue
		}
		for _, model := range p.Models {
			if model != nil && model.Name != "" && model.Enabled {
				m = model
				break
			}
		}
		if m != nil {
			break
		}
	}
	if m == nil && len(ai.Providers) > 0 && ai.Providers[0] != nil && len(ai.Providers[0].Models) > 0 {
		m = ai.Providers[0].Models[0]
	}
	if m == nil || m.ID == "" {
		return
	}
	if ai.Editing == nil {
		ai.Editing = &Editing{}
	}
	if ai.Editing.ModelID == "" {
		ai.Editing.ModelID = m.ID
	}
	if ai.Agent == nil {
		ai.Agent = &Agent{MaxToolCallRounds: 64}
	}
	if ai.Agent.ModelID == "" {
		ai.Agent.ModelID = m.ID
	}
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
	}
}

func migrateEmbedding(raw map[string]any) *Embedding {
	return &Embedding{
		ID:      getString(raw, "id"),
		Enabled: getBool(raw, "enabled"),
		APIKey:  getString(raw, "apiKey"),
		BaseURL: getString(raw, "apiBaseURL"),
		Name:    getString(raw, "apiModel"),
		Timeout: getInt(raw, "apiTimeout"),
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
