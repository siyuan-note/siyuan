// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"context"
	"errors"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestWebToolProvidersAndEffects(t *testing.T) {
	previous := model.Conf
	t.Cleanup(func() { model.Conf = previous })
	model.Conf = model.NewAppConf()
	model.Conf.AI.Store(conf.NewAI())
	for _, tool := range []*Tool{WebSearchTool, WebFetchTool} {
		if _, declared := tool.EffectsFor(""); declared {
			t.Fatal("default provider confirmation behavior changed")
		}
	}
	model.Conf.AI.Load().Web.ExaAPIKey = "exa-key"
	if effects, declared := WebSearchTool.EffectsFor(""); !declared || !effects.DataEgress || !effects.ExternalCost || effects.LocalWrite {
		t.Fatal("authenticated Exa search effects not declared")
	}
	if _, declared := WebFetchTool.EffectsFor(""); declared {
		t.Fatal("Exa credentials changed direct fetch effects")
	}
	model.Conf.AI.Load().Web.ExaAPIKey = ""
	if _, declared := WebSearchTool.EffectsFor(""); declared {
		t.Fatal("clearing Exa credentials did not restore anonymous search effects")
	}
	model.Conf.AI.Load().Web.SearchProvider = "deepseek"
	if effects, declared := WebSearchTool.EffectsFor(""); !declared || !effects.DataEgress || !effects.ExternalCost || effects.LocalWrite {
		t.Fatal("DeepSeek search effects not declared")
	}
	if _, declared := WebFetchTool.EffectsFor(""); declared {
		t.Fatal("search provider unexpectedly changed fetch provider")
	}
	model.Conf.AI.Load().Web.FetchProvider = "deepseek"
	if effects, declared := WebFetchTool.EffectsFor(""); !declared || !effects.ExternalCost || !effects.DataEgress {
		t.Fatal("DeepSeek fetch effects not declared")
	}
	search, _ := webSearchHandler(context.Background(), map[string]any{"query": "test"})
	fetch, _ := webFetchHandler(context.Background(), map[string]any{"url": "https://8.8.8.8"})
	if !search.IsError || !fetch.IsError {
		t.Fatal("missing credentials silently fell back to another provider")
	}
	model.Conf.AI.Load().Web.SearchProvider, model.Conf.AI.Load().Web.FetchProvider = "unknown", "unknown"
	search, _ = webSearchHandler(context.Background(), map[string]any{"query": "test"})
	fetch, _ = webFetchHandler(context.Background(), map[string]any{"url": "https://8.8.8.8"})
	if !search.IsError || !fetch.IsError {
		t.Fatal("unknown provider silently used a different service")
	}
}

func TestWebSearchExaCredentials(t *testing.T) {
	previousConf, previousSearch := model.Conf, exaWebSearch
	t.Cleanup(func() { model.Conf, exaWebSearch = previousConf, previousSearch })
	model.Conf = model.NewAppConf()
	model.Conf.AI.Store(conf.NewAI())
	web := model.Conf.AI.Load().Web
	web.APIKey, web.ExaAPIKey, web.Timeout = "deepseek-key", "exa-key", 45
	calls := 0
	exaWebSearch = func(ctx context.Context, query, key string, timeout int) (string, error) {
		calls++
		if query != "test" || key != web.ExaAPIKey || key == web.APIKey || timeout != 45 {
			t.Fatal("Exa configuration was not forwarded independently")
		}
		return "", errors.New("Exa authentication failed")
	}
	for _, key := range []string{"exa-key", ""} {
		web.ExaAPIKey = key
		result, err := webSearchHandler(context.Background(), map[string]any{"query": "test"})
		if err != nil || !result.IsError {
			t.Fatal("Exa failure was hidden or fell back")
		}
	}
	if calls != 2 {
		t.Fatal("Exa failure caused an extra request")
	}
}
