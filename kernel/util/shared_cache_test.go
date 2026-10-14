package util

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestNativeEmojiCacheReplacementAndConcurrentReads(t *testing.T) {
	oldAppearance := AppearancePath
	nativeEmojiCharsLock.RLock()
	oldChars := nativeEmojiChars
	nativeEmojiCharsLock.RUnlock()
	AppearancePath = t.TempDir()
	t.Cleanup(func() {
		AppearancePath = oldAppearance
		nativeEmojiCharsLock.Lock()
		nativeEmojiChars = oldChars
		nativeEmojiCharsLock.Unlock()
	})
	directory := filepath.Join(AppearancePath, "emojis")
	if err := os.MkdirAll(directory, 0755); err != nil {
		t.Fatal(err)
	}
	write := func(value string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(directory, "conf.json"), []byte(value), 0644); err != nil {
			t.Fatal(err)
		}
		InitEmojiChars()
	}
	write(`[{"items":[{"unicode":"old"}]}]`)
	if !IsNativeEmoji("old") {
		t.Fatal("emoji list was not loaded")
	}
	write(`[{"items":[{"unicode":"new"}]}]`)
	if IsNativeEmoji("old") || !IsNativeEmoji("new") {
		t.Fatal("emoji refresh retained removed entries")
	}
	write(`invalid`)
	if !IsNativeEmoji("new") {
		t.Fatal("failed refresh discarded the last valid emoji list")
	}
	write(`[{"items":[{"unicode":"new"}]}]`)
	var group sync.WaitGroup
	for i := 0; i < 8; i++ {
		group.Go(func() {
			for j := 0; j < 50; j++ {
				InitEmojiChars()
				if !IsNativeEmoji("new") || IsNativeEmoji("old") {
					t.Error("concurrent refresh changed emoji membership")
					return
				}
			}
		})
	}
	group.Wait()
}

func TestRhyCacheSnapshotsAndConcurrentRefresh(t *testing.T) {
	rhyResultLock.Lock()
	oldResult, oldTime := cachedRhyResult, rhyResultCacheTime
	rhyResultLock.Unlock()
	rhyBazaarHashLock.RLock()
	oldHash := rhyBazaarHash
	rhyBazaarHashLock.RUnlock()
	oldContainer := Container
	oldDuration := RhyCacheDuration
	Container = ContainerDocker
	t.Cleanup(func() {
		Container = oldContainer
		rhyResultLock.Lock()
		cachedRhyResult, rhyResultCacheTime = oldResult, oldTime
		rhyResultLock.Unlock()
		rhyBazaarHashLock.Lock()
		rhyBazaarHash = oldHash
		rhyBazaarHashLock.Unlock()
	})
	var count atomic.Int32
	var fail atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if fail.Load() {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if n := count.Add(1); n == 1 {
			fmt.Fprint(w, `{"bazaar":"hash-1","removed":true,"checksums":{"file":"first"}}`)
		} else {
			fmt.Fprintf(w, `{"bazaar":"hash-%d","checksums":{"file":"updated"}}`, n)
		}
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	first, err := getRhyResult0(ctx, server.URL)
	if err != nil {
		t.Fatal(err)
	}
	second, err := getRhyResult0(ctx, server.URL)
	if err != nil {
		t.Fatal(err)
	}
	if first["bazaar"] != "hash-1" || first["checksums"].(map[string]any)["file"] != "first" || second["removed"] != nil {
		t.Fatal("cache refresh modified an existing snapshot or retained removed fields")
	}
	fail.Store(true)
	if _, err = getRhyResult0(ctx, server.URL); err == nil {
		t.Fatal("failed refresh was accepted")
	}
	cached, err := GetRhyResult(ctx, false)
	if err != nil || cached["bazaar"] != second["bazaar"] {
		t.Fatal("failed refresh replaced the valid cache")
	}
	fail.Store(false)
	var group sync.WaitGroup
	group.Go(func() {
		for i := 0; i < 25; i++ {
			if _, err := getRhyResult0(ctx, server.URL); err != nil {
				t.Error(err)
				return
			}
		}
	})
	for i := 0; i < 8; i++ {
		group.Go(func() {
			for j := 0; j < 100; j++ {
				result, err := GetRhyResult(ctx, false)
				if err != nil || !strings.HasPrefix(result["bazaar"].(string), "hash-") {
					t.Errorf("invalid cached result: %#v err=%v", result, err)
					return
				}
				syncRhyBazaarHashFromResult(result)
			}
		})
	}
	group.Wait()
	if first["bazaar"] != "hash-1" || RhyCacheDuration != oldDuration {
		t.Fatal("concurrent refresh modified a snapshot or global duration")
	}
}
