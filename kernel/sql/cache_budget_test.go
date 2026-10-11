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
