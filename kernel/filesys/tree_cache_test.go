package filesys

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestCompressedTreeCachePreservesDiskAndCrypto(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "encrypted"}[encrypted], func(t *testing.T) {
			box, _, _, _ := setupStalePathTest(t)
			originalProvider := DEKProvider
			originalAcquire, originalRelease := DEKLockAcquire, DEKLockRelease
			DEKLockAcquire, DEKLockRelease = nil, nil
			key := bytes.Repeat([]byte{19}, 32)
			provider := func(string) ([]byte, error) {
				if encrypted {
					return bytes.Clone(key), nil
				}
				return nil, nil
			}
			DEKProvider = provider
			t.Cleanup(func() {
				DEKProvider = originalProvider
				DEKLockAcquire, DEKLockRelease = originalAcquire, originalRelease
			})
			p := "/20261009000000-cache01.sy"
			tree := treenode.NewTree(box, p, "/Cache", "Cache")
			payload := strings.Repeat("repeated attribute content ", 1024)
			tree.Root.SetIALAttr("custom-test-payload", payload)
			if _, err := WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			filePath := filepath.Join(util.DataDir, box, p)
			disk, err := os.ReadFile(filePath)
			if err != nil {
				t.Fatal(err)
			}
			deadline := time.Now().Add(time.Second)
			for {
				if raw, ok := cache.GetTreeDataInBox(tree.ID, box); ok && len(raw) > 1024 {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("large document was not cached")
				}
				time.Sleep(time.Millisecond)
			}
			loaded, err := LoadTree(box, p, util.NewLute())
			if err != nil || loaded.Root.IALAttr("custom-test-payload") != payload {
				t.Fatalf("cached document round trip failed: %v", err)
			}
			if size, err := WriteTree(tree); err != nil || size != 0 {
				t.Fatalf("identical cached document should skip writing: %d, %v", size, err)
			}
			if got, err := os.ReadFile(filePath); err != nil || !bytes.Equal(got, disk) {
				t.Fatal("cache hit changed the source file")
			}
			if encrypted {
				DEKProvider = func(string) ([]byte, error) { return nil, errors.New("notebook locked") }
				if _, err := LoadTree(box, p, util.NewLute()); err == nil {
					t.Fatal("cache hit bypassed notebook authorization")
				}
				cache.ClearTreeCache()
				DEKProvider = func(string) ([]byte, error) { return bytes.Repeat([]byte{97}, 32), nil }
				if _, err := LoadTree(box, p, util.NewLute()); err == nil {
					t.Fatal("wrong key authenticated the source document")
				}
				if got, err := os.ReadFile(filePath); err != nil || !bytes.Equal(got, disk) {
					t.Fatal("failed authentication changed the ciphertext")
				}
				DEKProvider = provider
			}
			cache.ClearTreeCache()
			loaded, err = LoadTree(box, p, util.NewLute())
			if err != nil || loaded.Root.IALAttr("custom-test-payload") != payload {
				t.Fatalf("source document round trip failed after clearing the cache: %v", err)
			}
		})
	}
}
