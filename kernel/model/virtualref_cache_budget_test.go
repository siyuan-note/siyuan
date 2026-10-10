package model

import (
	"strings"
	"testing"
	"time"
)

func TestVirtualRefCacheByteBudgetAndTTL(t *testing.T) {
	previous := virtualBlockRefCache.MaxCost()
	virtualBlockRefCache.Clear()
	virtualBlockRefCache.UpdateMaxCost(4096)
	t.Cleanup(func() {
		virtualBlockRefCache.Clear()
		virtualBlockRefCache.UpdateMaxCost(previous)
	})
	putVirtualRefCache("box\x00doc", []string{"keyword"}, time.Minute)
	virtualBlockRefCache.Wait()
	if ttl, ok := virtualBlockRefCache.GetTTL("box\x00doc"); !ok || ttl <= 0 || ttl > time.Minute {
		t.Fatalf("cached document lost its TTL: %v, %v", ttl, ok)
	}
	putVirtualRefCache("box\x00doc", []string{strings.Repeat("x", 4096)}, time.Minute)
	virtualBlockRefCache.Wait()
	if _, ok := virtualBlockRefCache.Get("box\x00doc"); ok {
		t.Fatal("oversized keywords retained the old cached value")
	}
	putVirtualRefCache("box\x00virtual_ref", []string{"keyword"}, 0)
	virtualBlockRefCache.Wait()
	if ttl, ok := virtualBlockRefCache.GetTTL("box\x00virtual_ref"); !ok || ttl != 0 {
		t.Fatalf("keyword list unexpectedly expires: %v, %v", ttl, ok)
	}
}
