package cache

import (
	"bytes"
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
	SetTreeDataInBox("blocker", "box", []byte{})
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
