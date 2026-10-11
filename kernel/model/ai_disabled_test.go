package model

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAIDisabledBackgroundFeatures(t *testing.T) {
	previousConf, previousFeatures := Conf, util.DisabledFeatures
	t.Cleanup(func() { Conf, util.DisabledFeatures = previousConf, previousFeatures })
	Conf = NewAppConf()
	Conf.AI.Store(conf.NewAI())
	Conf.AI.Load().Embedding = &conf.Embedding{Enabled: true, APIKey: "embedding-key"}
	Conf.AI.Load().Rerank = &conf.Rerank{Enabled: true, APIKey: "rerank-key"}
	util.DisabledFeatures = []string{"ai"}
	if isEmbeddingEnabled() || isRerankEnabled() {
		t.Fatal("AI background features are enabled")
	}
	fullReindexEmbedding()
	retryFailedEmbedding()
	if !Conf.AI.Load().Embedding.Enabled || !Conf.AI.Load().Rerank.Enabled || Conf.AI.Load().Embedding.APIKey != "embedding-key" {
		t.Fatal("disabling AI modified stored configuration")
	}
	util.DisabledFeatures = nil
	if !isEmbeddingEnabled() || !isRerankEnabled() {
		t.Fatal("AI configuration did not become available again")
	}
}
