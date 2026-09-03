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

package agent

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
)

const (
	modelsDevCatalogURL        = "https://models.dev/api.json"
	modelsDevCatalogCacheTTL   = 24 * time.Hour
	modelsDevCatalogRetryDelay = time.Hour
	modelsDevCatalogTimeout    = 30 * time.Second
	modelsDevCatalogMaxBytes   = 64 * 1024 * 1024
	maxModelContextLength      = 100 * 1000 * 1000
)

type modelsDevLimit struct {
	Context int `json:"context"`
}

type modelsDevModel struct {
	Limit modelsDevLimit `json:"limit"`
}

type modelsDevProvider struct {
	API    string                    `json:"api"`
	Models map[string]modelsDevModel `json:"models"`
}

type modelsDevProviderCatalog struct {
	models   map[string]int
	suffixes map[string]int
}

type modelsDevContextCatalog struct {
	providers map[string]*modelsDevProviderCatalog
	models    map[string]int
	suffixes  map[string]int
}

var (
	modelsDevEndpoint   = modelsDevCatalogURL
	modelsDevNow        = time.Now
	modelsDevAPIAliases = map[string][]string{
		"openai":     {"https://api.openai.com/v1"},
		"google":     {"https://generativelanguage.googleapis.com/v1beta/openai"},
		"mistral":    {"https://api.mistral.ai/v1"},
		"groq":       {"https://api.groq.com/openai/v1"},
		"minimax":    {"https://api.minimax.io/v1"},
		"minimax-cn": {"https://api.minimaxi.com/v1"},
	}

	modelsDevState = struct {
		sync.RWMutex
		catalog    *modelsDevContextCatalog
		expiresAt  time.Time
		retryAt    time.Time
		refreshing bool
	}{}
)

// StartModelMetadataRefresh 在后台刷新 models.dev 模型目录，不阻塞内核启动。
func StartModelMetadataRefresh() {
	refreshModelsDevContextCatalogAsync()
}

func getModelsDevContextLimit(providerBaseURL, model string) int {
	if providerBaseURL == "" || model == "" {
		return 0
	}
	now := modelsDevNow()
	modelsDevState.RLock()
	catalog := modelsDevState.catalog
	fresh := catalog != nil && now.Before(modelsDevState.expiresAt)
	canRetry := modelsDevState.retryAt.IsZero() || !now.Before(modelsDevState.retryAt)
	modelsDevState.RUnlock()

	if !fresh && canRetry {
		refreshModelsDevContextCatalogAsync()
	}
	if catalog == nil {
		return 0
	}
	return catalog.contextLimit(providerBaseURL, model)
}

func (catalog *modelsDevContextCatalog) contextLimit(providerBaseURL, model string) int {
	if catalog == nil || model == "" {
		return 0
	}
	provider := catalog.providers[normalizeModelsDevAPI(providerBaseURL)]
	lower := strings.ToLower(strings.TrimSpace(model))
	if provider != nil {
		if limit := provider.models[lower]; 0 < limit {
			return limit
		}
		if idx := strings.LastIndexByte(lower, '/'); idx >= 0 {
			if limit := provider.suffixes[lower[idx+1:]]; 0 < limit {
				return limit
			}
		} else if limit := provider.suffixes[lower]; 0 < limit {
			return limit
		}
	}
	if limit := catalog.models[lower]; 0 < limit {
		return limit
	}
	if idx := strings.LastIndexByte(lower, '/'); idx >= 0 {
		lower = lower[idx+1:]
	}
	return catalog.suffixes[lower]
}

func refreshModelsDevContextCatalogAsync() {
	modelsDevState.Lock()
	if modelsDevState.refreshing {
		modelsDevState.Unlock()
		return
	}
	now := modelsDevNow()
	if modelsDevState.catalog != nil && now.Before(modelsDevState.expiresAt) {
		modelsDevState.Unlock()
		return
	}
	if !modelsDevState.retryAt.IsZero() && now.Before(modelsDevState.retryAt) {
		modelsDevState.Unlock()
		return
	}
	modelsDevState.refreshing = true
	modelsDevState.Unlock()

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), modelsDevCatalogTimeout)
		defer cancel()
		if err := refreshModelsDevContextCatalog(ctx); err != nil {
			logging.LogWarnf("refresh models.dev model metadata failed: %s", err)
		}
	}()
}

func refreshModelsDevContextCatalog(ctx context.Context) error {
	catalog, err := fetchModelsDevContextCatalog(ctx)
	completedAt := modelsDevNow()

	modelsDevState.Lock()
	defer modelsDevState.Unlock()
	modelsDevState.refreshing = false
	if err != nil {
		modelsDevState.retryAt = completedAt.Add(modelsDevCatalogRetryDelay)
		return err
	}
	modelsDevState.catalog = catalog
	modelsDevState.expiresAt = completedAt.Add(modelsDevCatalogCacheTTL)
	modelsDevState.retryAt = time.Time{}
	return nil
}

func fetchModelsDevContextCatalog(ctx context.Context) (*modelsDevContextCatalog, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, modelsDevEndpoint, nil)
	if err != nil {
		return nil, err
	}
	resp, err := httpclient.NewUserAgentClient(nil).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	providers := map[string]modelsDevProvider{}
	limited := io.LimitReader(resp.Body, modelsDevCatalogMaxBytes+1)
	if err = json.NewDecoder(limited).Decode(&providers); err != nil {
		return nil, err
	}
	if len(providers) == 0 {
		return nil, errors.New("empty catalog")
	}

	catalog := &modelsDevContextCatalog{
		providers: map[string]*modelsDevProviderCatalog{},
		models:    map[string]int{},
		suffixes:  map[string]int{},
	}
	ambiguousModels := map[string]bool{}
	ambiguousSuffixes := map[string]bool{}
	for providerID, provider := range providers {
		providerCatalog := &modelsDevProviderCatalog{
			models:   map[string]int{},
			suffixes: map[string]int{},
		}
		providerAmbiguousSuffixes := map[string]bool{}
		for name, model := range provider.Models {
			limit := model.Limit.Context
			if limit < 1 || maxModelContextLength < limit {
				continue
			}
			lower := strings.ToLower(strings.TrimSpace(name))
			if lower == "" {
				continue
			}
			setUniqueModelContextLimit(providerCatalog.models, lower, limit)
			suffix := lower
			if idx := strings.LastIndexByte(suffix, '/'); idx >= 0 {
				suffix = suffix[idx+1:]
			}
			setConsistentModelContextLimit(providerCatalog.suffixes, providerAmbiguousSuffixes, suffix, limit)
			setConsistentModelContextLimit(catalog.models, ambiguousModels, lower, limit)
			setConsistentModelContextLimit(catalog.suffixes, ambiguousSuffixes, suffix, limit)
		}
		if len(providerCatalog.models) == 0 {
			continue
		}
		apis := append([]string{provider.API}, modelsDevAPIAliases[providerID]...)
		for _, providerAPI := range apis {
			api := normalizeModelsDevAPI(providerAPI)
			if api != "" {
				catalog.providers[api] = providerCatalog
			}
		}
	}
	if len(catalog.providers) == 0 {
		return nil, errors.New("catalog has no providers with API endpoints and valid models")
	}
	return catalog, nil
}

func setUniqueModelContextLimit(limits map[string]int, model string, limit int) {
	if existing := limits[model]; existing == 0 || existing == limit {
		limits[model] = limit
		return
	}
	delete(limits, model)
}

func setConsistentModelContextLimit(limits map[string]int, ambiguous map[string]bool, model string, limit int) {
	if ambiguous[model] {
		return
	}
	if existing := limits[model]; existing != 0 && existing != limit {
		delete(limits, model)
		ambiguous[model] = true
		return
	}
	limits[model] = limit
}

func normalizeModelsDevAPI(api string) string {
	return strings.ToLower(strings.TrimRight(strings.TrimSpace(api), "/"))
}
