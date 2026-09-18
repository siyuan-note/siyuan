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
	Conf.AI = conf.NewAI()
	Conf.AI.Embedding = &conf.Embedding{Enabled: true, APIKey: "embedding-key"}
	Conf.AI.Rerank = &conf.Rerank{Enabled: true, APIKey: "rerank-key"}
	util.DisabledFeatures = []string{"ai"}
	if isEmbeddingEnabled() || isRerankEnabled() {
		t.Fatal("AI background features are enabled")
	}
	fullReindexEmbedding()
	retryFailedEmbedding()
	if !Conf.AI.Embedding.Enabled || !Conf.AI.Rerank.Enabled || Conf.AI.Embedding.APIKey != "embedding-key" {
		t.Fatal("disabling AI modified stored configuration")
	}
	util.DisabledFeatures = nil
	if !isEmbeddingEnabled() || !isRerankEnabled() {
		t.Fatal("AI configuration did not become available again")
	}
}
