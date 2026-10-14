package sql

import (
	"strings"
	"testing"
)

func TestBlockCacheByteBudgetRejectsLargeReplacement(t *testing.T) {
	previousDisabled, previousCost := cacheDisabled, blockCache.MaxCost()
	cacheDisabled = false
	blockCache.UpdateMaxCost(4096)
	ClearCache()
	t.Cleanup(func() {
		ClearCache()
		cacheDisabled = previousDisabled
		blockCache.UpdateMaxCost(previousCost)
	})
	block := &Block{ID: "budget-block", Content: "small"}
	putBlockCache(block)
	blockCache.Wait()
	if getBlockCache(block.ID) == nil {
		t.Fatal("small block was not admitted")
	}
	block.Content = strings.Repeat("x", 4096)
	putBlockCache(block)
	blockCache.Wait()
	if getBlockCache(block.ID) != nil {
		t.Fatal("oversized replacement retained cached data")
	}
	if len(blockCacheKeys) != 0 {
		t.Fatal("rejected block retained an invalidation index")
	}
}

func TestBlockCacheReplacementRemainsInvalidatable(t *testing.T) {
	previousDisabled := cacheDisabled
	cacheDisabled = false
	ClearCache()
	t.Cleanup(func() { ClearCache(); cacheDisabled = previousDisabled })
	for i := 0; i < 64; i++ {
		putBlockCache(&Block{ID: "replaced", Content: strings.Repeat("x", i+1)})
	}
	blockCache.Wait()
	if block := getBlockCache("replaced"); block == nil || len(block.Content) != 64 {
		t.Fatalf("replacement was lost: %+v", block)
	}
	removeBlockCache("replaced")
	blockCache.Wait()
	if getBlockCache("replaced") != nil || len(blockCacheKeys) != 0 {
		t.Fatal("replacement survived invalidation")
	}
}

func TestBlockCacheGrowingReplacementRespectsBudget(t *testing.T) {
	previousDisabled, previousCost := cacheDisabled, blockCache.MaxCost()
	cacheDisabled = false
	ClearCache()
	t.Cleanup(func() { ClearCache(); cacheDisabled = previousDisabled; blockCache.UpdateMaxCost(previousCost) })
	ids := []string{"a", "b", "c"}
	budget := 3*blockCacheCost("a", &Block{ID: "a", Content: strings.Repeat("x", 64)}) + 512
	blockCache.UpdateMaxCost(budget)
	for _, id := range ids {
		putBlockCache(&Block{ID: id, Content: strings.Repeat("x", 64)})
		blockCache.Wait()
		if getBlockCache(id) == nil {
			t.Fatal("initial block was not admitted")
		}
	}
	putBlockCache(&Block{ID: "b", Content: strings.Repeat("x", int(budget/2))})
	blockCache.Wait()
	var used int64
	for _, id := range ids {
		if block := getBlockCache(id); block != nil {
			used += blockCacheCost(id, block)
		}
	}
	if used > budget {
		t.Fatalf("growing replacement exceeded budget: %d > %d", used, budget)
	}
}
