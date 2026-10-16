package model

import (
	"fmt"
	"math"
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
	Conf.AI.Store(conf.NewAI())
	Conf.AI.Load().Embedding = &conf.Embedding{Enabled: true, APIKey: "test"}
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
	if queries.Load() != 1 || calls.Load() < 1 || calls.Load() > conf.DefaultEmbeddingConcurrency {
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
	Conf.AI.Load().Embedding.BaseURL = server.URL
	Conf.AI.Load().Embedding.Timeout = 5
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

func TestEmbeddingQueueConfiguredBatches(t *testing.T) {
	for _, entry := range []struct {
		concurrency, batchSize, total int
	}{
		{8, 10, 205},
		{1, 64, 200},
		{2, 3, 205},
		{1, 128, 200},
		{64, 10, 640},
		{64, 128, 8192},
	} {
		t.Run(fmt.Sprintf("%d/%d", entry.concurrency, entry.batchSize), func(t *testing.T) {
			prepareEmbeddingQueueTest(t)
			Conf.AI.Load().Embedding.Concurrency = entry.concurrency
			Conf.AI.Load().Embedding.BatchSize = entry.batchSize
			var written atomic.Int64
			var batchesMu sync.Mutex
			var sizes []int
			started := make(chan struct{}, entry.concurrency)
			release, done := make(chan struct{}), make(chan struct{})
			query := func(_ string, args ...any) ([]map[string]any, error) {
				limit := args[2].(int)
				offset := int(written.Load())
				rows := make([]map[string]any, min(limit, entry.total-offset))
				for i := range rows {
					rows[i] = map[string]any{"id": fmt.Sprint(offset + i), "content": "pending content"}
				}
				return rows, nil
			}
			go func() {
				defer close(done)
				processPendingEmbeddingRows(query, func(texts []string, _ []map[string]any, _ uint64) {
					batchesMu.Lock()
					sizes = append(sizes, len(texts))
					batchesMu.Unlock()
					select {
					case started <- struct{}{}:
					default:
					}
					<-release
					written.Add(int64(len(texts)))
				})
			}()
			for range entry.concurrency {
				select {
				case <-started:
				case <-time.After(5 * time.Second):
					close(release)
					<-done
					t.Fatal("configured workers could not start a full batch concurrently")
				}
			}
			close(release)
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Fatal("queue did not finish")
			}
			wantBatches := (entry.total + entry.batchSize - 1) / entry.batchSize
			if written.Load() != int64(entry.total) || len(sizes) != wantBatches {
				t.Fatalf("written=%d, batch sizes=%v", written.Load(), sizes)
			}
			for i, size := range sizes {
				want := min(entry.batchSize, entry.total-i*entry.batchSize)
				if size != want {
					t.Fatalf("batch %d: got %d blocks, want %d", i, size, want)
				}
			}
		})
	}
}

func TestEmbeddingQueueBoundsUnnormalizedConfiguration(t *testing.T) {
	prepareEmbeddingQueueTest(t)
	Conf.AI.Load().Embedding.Concurrency = math.MaxInt
	Conf.AI.Load().Embedding.BatchSize = math.MaxInt
	queried := false
	processPendingEmbeddingRows(func(_ string, args ...any) ([]map[string]any, error) {
		queried = true
		if limit := args[2].(int); limit != 64*128 {
			t.Errorf("unbounded page size: %d", limit)
		}
		return nil, nil
	}, func([]string, []map[string]any, uint64) {
		t.Error("empty queue must not submit a request")
	})
	if !queried {
		t.Fatal("queue did not query pending blocks")
	}
}
