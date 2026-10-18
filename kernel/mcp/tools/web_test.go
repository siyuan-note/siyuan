package tools

import (
	"context"
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
