package model

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

func prepareEmbeddingQueueTest(t *testing.T) {
	t.Helper()
	previousConf := Conf
	Conf = NewAppConf()
	Conf.AI = conf.NewAI()
	Conf.AI.Embedding = &conf.Embedding{Enabled: true, APIKey: "test"}
	embeddingIgnoreLock.Lock()
	loaded, matcher := embeddingIgnoreLoaded, embeddingIgnoreMatcher
	embeddingIgnoreLoaded, embeddingIgnoreMatcher = true, nil
	embeddingIgnoreLock.Unlock()
	stop, notified := embeddingStop.Load(), embeddingErrNotified.Load()
	t.Cleanup(func() {
		Conf = previousConf
		embeddingIgnoreLock.Lock()
		embeddingIgnoreLoaded, embeddingIgnoreMatcher = loaded, matcher
		embeddingIgnoreLock.Unlock()
		embeddingStop.Store(stop)
		embeddingErrNotified.Store(notified)
	})
}

func TestEmbeddingQueueWaitsForWrites(t *testing.T) {
	prepareEmbeddingQueueTest(t)
	var queries, calls atomic.Int32
	var written atomic.Bool
	started, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	var once sync.Once
	query := func(string, ...any) ([]map[string]any, error) {
		queries.Add(1)
		if written.Load() {
			return nil, nil
		}
		return []map[string]any{{"id": "block", "content": "pending content"}}, nil
	}
	go func() {
		defer close(done)
		processPendingEmbeddingRows(query, func([]string, []map[string]any, uint64) {
			calls.Add(1)
			once.Do(func() { close(started) })
			<-release
			written.Store(true)
		})
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		close(release)
		t.Fatal("worker did not start")
	}
	// 留出调度时间，结果尚未写入时不得再次查询。
	time.Sleep(50 * time.Millisecond)
	beforeWrite := queries.Load()
	close(release)
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("queue did not finish")
	}
	if beforeWrite != 1 || queries.Load() != 2 || calls.Load() != 1 {
		t.Fatalf("before write=%d, queries=%d, calls=%d", beforeWrite, queries.Load(), calls.Load())
	}
}

func TestEmbeddingQueueStopsUnsentJobs(t *testing.T) {
	prepareEmbeddingQueueTest(t)
	var calls, queries atomic.Int32
	query := func(string, ...any) ([]map[string]any, error) {
		queries.Add(1)
		rows := make([]map[string]any, 100)
		for i := range rows {
			rows[i] = map[string]any{"id": fmt.Sprint(i), "content": "pending content"}
		}
		return rows, nil
	}
	processPendingEmbeddingRows(query, func([]string, []map[string]any, uint64) {
		embeddingStop.Store(true)
		calls.Add(1)
	})
	if queries.Load() != 1 || calls.Load() < 1 || calls.Load() > embeddingMaxConcurrency {
		t.Fatalf("queries=%d, calls=%d", queries.Load(), calls.Load())
	}
	if embeddingErrNotified.Load() {
		t.Fatal("unsent jobs must not report an embedding failure")
	}
}

func TestEmbeddingBackoffYieldsToNewEdits(t *testing.T) {
	prepareEmbeddingQueueTest(t)
	var calls atomic.Int32
	started := time.Now()
	processPendingEmbeddingRows(func(string, ...any) ([]map[string]any, error) {
		return []map[string]any{{"id": "block", "content": "pending content",
			"fail_count": int64(2), "last_tried": time.Now().Unix() - 31}}, nil
	}, func([]string, []map[string]any, uint64) {
		calls.Add(1)
	})
	if calls.Load() != 0 || time.Since(started) > time.Second {
		t.Fatalf("calls=%d, elapsed=%s", calls.Load(), time.Since(started))
	}
}

func TestEmbeddingRebuildDiscardsInflightFailure(t *testing.T) {
	prepareEmbeddingQueueTest(t)
	started, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-release
		http.Error(w, `{"error":{"message":"failed"}}`, http.StatusInternalServerError)
	}))
	defer server.Close()
	Conf.AI.Embedding.BaseURL = server.URL
	Conf.AI.Embedding.Timeout = 5
	embeddingResultMu.Lock()
	generation := embeddingGeneration
	embeddingResultMu.Unlock()
	t.Cleanup(func() {
		embeddingResultMu.Lock()
		embeddingGeneration = generation
		embeddingResultMu.Unlock()
	})
	embeddingStop.Store(false)
	embeddingErrNotified.Store(false)
	go func() {
		defer close(done)
		doEmbedAndStore([]string{"content"}, []map[string]any{{"id": "block", "content": "content"}}, generation)
	}()
	select {
	case <-started:
	case <-time.After(5 * time.Second):
		close(release)
		t.Fatal("request did not start")
	}
	embeddingResultMu.Lock()
	embeddingGeneration++
	embeddingResultMu.Unlock()
	close(release)
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("request did not finish")
	}
	if embeddingStop.Load() || embeddingErrNotified.Load() {
		t.Fatal("a request from before rebuilding must not stop the new index")
	}
}
