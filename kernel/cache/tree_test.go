package cache

import (
	"bytes"
	"crypto/rand"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/dgraph-io/ristretto"
)

func TestTreeCacheRejectsStaleAsyncAdmission(t *testing.T) {
	original := treeCache
	entered, release := make(chan struct{}), make(chan struct{})
	controlled, err := ristretto.NewCache(&ristretto.Config{
		NumCounters: 100, MaxCost: 1 << 20, BufferItems: 64,
		Cost: func(value interface{}) int64 {
			close(entered)
			<-release
			return 1
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	treeCache = controlled
	t.Cleanup(func() {
		ClearTreeCache()
		controlled.Close()
		treeCache = original
	})
	// 暂停准入线程，让同一文档的两次写入都在首次缓存建立前入队。
	controlled.Set("blocker", &treeCacheEntry{}, 0)
	<-entered
	SetTreeDataInBox("document", "box", []byte("old"))
	SetTreeDataInBox("document", "box", []byte("latest"))
	close(release)
	controlled.Wait()
	if raw, ok := GetTreeDataInBox("document", "box"); ok && !bytes.Equal(raw, []byte("latest")) {
		t.Fatalf("returned stale document after a newer write: %q", raw)
	}
	// 未命中后重新读取源文件，可以恢复当前版本的缓存。
	SetTreeDataInBox("document", "box", []byte("latest"))
	controlled.Wait()
	if raw, ok := GetTreeDataInBox("document", "box"); !ok || !bytes.Equal(raw, []byte("latest")) {
		t.Fatalf("latest document was not cached: %q, %v", raw, ok)
	}
}

func TestTreeCacheCompressedRoundTrip(t *testing.T) {
	t.Cleanup(ClearTreeCache)
	random := make([]byte, 4096)
	if _, err := rand.Read(random); err != nil {
		t.Fatal(err)
	}
	for _, fixture := range []struct {
		name       string
		raw        []byte
		compressed bool
	}{
		{"empty", []byte{}, false},
		{"small", []byte(`{"ID":"document"}`), false},
		{"json", bytes.Repeat([]byte(`{"Type":"NodeParagraph","Data":"content"}`), 1024), true},
		{"incompressible", random, false},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			expected := bytes.Clone(fixture.raw)
			SetTreeDataInBox(fixture.name, "box", fixture.raw)
			treeCache.Wait()
			value, ok := treeCache.Get(treeCacheKey(fixture.name, "box"))
			if !ok {
				t.Fatal("cache admission failed")
			}
			entry := value.(*treeCacheEntry)
			if entry.compressed != fixture.compressed {
				t.Fatalf("unexpected compression decision: %v", entry.compressed)
			}
			if entry.compressed && cap(entry.raw) >= len(expected) {
				t.Fatal("compressed entry retained an oversized allocation")
			}
			clear(fixture.raw)
			raw, ok := GetTreeDataInBox(fixture.name, "box")
			if !ok || !bytes.Equal(raw, expected) {
				t.Fatal("cached bytes differ from the original write")
			}
			clear(raw)
			raw, ok = GetTreeDataInBox(fixture.name, "box")
			if !ok || !bytes.Equal(raw, expected) {
				t.Fatal("a caller mutated the cached payload")
			}
		})
	}
}

func TestTreeCacheCompressedInvalidation(t *testing.T) {
	t.Cleanup(ClearTreeCache)
	old := bytes.Repeat([]byte("old content"), 1024)
	latest := bytes.Repeat([]byte("latest content"), 1024)
	for _, box := range []string{"plain", "encrypted"} {
		SetTreeDataInBox("document", box, old)
	}
	treeCache.Wait()
	SetTreeDataInBox("document", "encrypted", latest)
	treeCache.Wait()
	if raw, ok := GetTreeDataInBox("document", "encrypted"); !ok || !bytes.Equal(raw, latest) {
		t.Fatal("compressed update returned stale bytes")
	}
	RemoveTreeDataInBox("document", "encrypted")
	if _, ok := GetTreeDataInBox("document", "encrypted"); ok {
		t.Fatal("locked notebook payload remained cached")
	}
	if raw, ok := GetTreeDataInBox("document", "plain"); !ok || !bytes.Equal(raw, old) {
		t.Fatal("invalidating a notebook affected another notebook")
	}
	ClearTreeCache()
	if _, ok := GetTreeDataInBox("document", "plain"); ok {
		t.Fatal("cleared compressed payload remained cached")
	}
}

func TestTreeCacheCorruptCompressedPayload(t *testing.T) {
	t.Cleanup(ClearTreeCache)
	SetTreeDataInBox("document", "box", bytes.Repeat([]byte("content"), 1024))
	treeCache.Wait()
	value, _ := treeCache.Get(treeCacheKey("document", "box"))
	entry := value.(*treeCacheEntry)
	entry.raw = []byte("invalid zstd frame")
	if _, ok := GetTreeDataInBox("document", "box"); ok {
		t.Fatal("invalid compressed data must be a cache miss")
	}
	entry.raw = treeCacheEncoder.EncodeAll(bytes.Repeat([]byte("x"), entry.rawSize+1024), nil)
	if _, ok := GetTreeDataInBox("document", "box"); ok {
		t.Fatal("decoded payload exceeded its recorded size")
	}
}

func TestTreeCacheConcurrentCompression(t *testing.T) {
	t.Cleanup(ClearTreeCache)
	var wg sync.WaitGroup
	for i := range 16 {
		wg.Go(func() {
			id := fmt.Sprint(i)
			raw := bytes.Repeat([]byte(id+" content"), 1024)
			SetTreeDataInBox(id, "box", raw)
			treeCache.Wait()
			if got, ok := GetTreeDataInBox(id, "box"); !ok || !bytes.Equal(got, raw) {
				t.Errorf("concurrent round trip failed for %s", id)
			}
		})
	}
	wg.Wait()
}

func BenchmarkTreeCacheGuidePayload(b *testing.B) {
	paths, err := filepath.Glob("../../app/guide/20210808180117-6v0mkxr/*.sy")
	if err != nil || len(paths) == 0 {
		b.Fatal("bundled guide documents not found")
	}
	var documents [][]byte
	var rawBytes, storedBytes int64
	for _, path := range paths {
		raw, err := os.ReadFile(path)
		if err != nil {
			b.Fatal(err)
		}
		documents = append(documents, raw)
		SetTreeDataInBox(path, "guide", raw)
		treeCache.Wait()
		value, ok := treeCache.Get(treeCacheKey(path, "guide"))
		if !ok {
			b.Fatal("guide cache admission failed")
		}
		rawBytes += int64(len(raw))
		storedBytes += int64(cap(value.(*treeCacheEntry).raw)) + 64
	}
	b.Cleanup(ClearTreeCache)
	b.Logf("guide payload: %d documents, %d raw bytes, %d stored bytes", len(documents), rawBytes, storedBytes)
	b.Run("write", func(b *testing.B) {
		b.ReportMetric(float64(rawBytes)/float64(storedBytes), "capacity-ratio")
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			SetTreeDataInBox(paths[i%len(paths)], "guide", documents[i%len(documents)])
		}
	})
	treeCache.Wait()
	b.Run("read", func(b *testing.B) {
		b.ReportMetric(float64(rawBytes)/float64(storedBytes), "capacity-ratio")
		b.ReportAllocs()
		for i := 0; i < b.N; i++ {
			if _, ok := GetTreeDataInBox(paths[i%len(paths)], "guide"); !ok {
				b.Fatal("guide cache miss")
			}
		}
	})
}

func TestTreeCacheRemovalKeepsNotebookIsolation(t *testing.T) {
	t.Cleanup(ClearTreeCache)
	for _, box := range []string{"", "plain", "encrypted"} {
		SetTreeDataInBox("document", box, []byte(box+" content"))
	}
	treeCache.Wait()
	RemoveTreeDataInBox("document", "encrypted")
	if _, ok := GetTreeDataInBox("document", "encrypted"); ok {
		t.Fatal("removed notebook cache remained readable")
	}
	if raw, ok := GetTreeDataInBox("document", "plain"); !ok || string(raw) != "plain content" {
		t.Fatal("removing another notebook changed the plain cache")
	}
	RemoveTreeData("document")
	for _, box := range []string{"", "plain", "encrypted"} {
		if _, ok := GetTreeDataInBox("document", box); ok {
			t.Fatalf("document cache remained readable in notebook %q", box)
		}
	}
}
