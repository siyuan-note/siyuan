package filesys

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTreeSnapshotAndConditionalWrite(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "encrypted"}[encrypted], func(t *testing.T) {
			box, root, _, _ := setupStalePathTest(t)
			provider, acquire, release := DEKProvider, DEKLockAcquire, DEKLockRelease
			DEKLockAcquire, DEKLockRelease = nil, nil
			locked := false
			DEKProvider = func(string) ([]byte, error) {
				if locked {
					return nil, errors.New("locked notebook")
				}
				if encrypted {
					return bytes.Repeat([]byte{23}, 32), nil
				}
				return nil, nil
			}
			t.Cleanup(func() { DEKProvider, DEKLockAcquire, DEKLockRelease = provider, acquire, release })
			tree := treenode.NewTree(box, "/"+root+".sy", "/Source", "Source")
			if _, err := WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			stale, original, err := LoadTreeSnapshot(box, tree.Path, util.NewLute())
			if err != nil {
				t.Fatal(err)
			}
			if util.IsCiphertext(original) != encrypted {
				t.Fatal("snapshot did not retain the native file representation")
			}
			tree.Root.SetIALAttr("title", "User edit")
			if _, err = WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			filename := filepath.Join(util.DataDir, box, tree.Path)
			current, _ := os.ReadFile(filename)
			stale.Root.SetIALAttr("title", "Stale replacement")
			if _, err = WriteTreeIfUnchanged(stale, original); !errors.Is(err, util.ErrFileChanged) {
				t.Fatal("stale snapshot overwrote a user edit", err)
			}
			after, _ := os.ReadFile(filename)
			if !bytes.Equal(current, after) {
				t.Fatal("failed conditional write changed the current file")
			}
			cached, _ := cache.GetTreeDataInBox(root, box)
			if bytes.Contains(cached, []byte("Stale replacement")) {
				t.Fatal("failed conditional write published a stale cache entry")
			}
			fresh, baseline, err := LoadTreeSnapshot(box, tree.Path, util.NewLute())
			if err != nil || !bytes.Equal(current, baseline) || fresh.Root.IALAttr("title") != "User edit" {
				t.Fatal("snapshot did not read the current native file", err)
			}
			fresh.Root.SetIALAttr("title", "Replacement")
			if _, err = WriteTreeIfUnchanged(fresh, baseline); err != nil {
				t.Fatal(err)
			}
			cache.RemoveTreeDataInBox(root, box)
			loaded, err := LoadTree(box, tree.Path, util.NewLute())
			if err != nil || loaded.Root.IALAttr("title") != "Replacement" {
				t.Fatal("successful conditional write cannot be read", err)
			}
			if encrypted {
				after, _ = os.ReadFile(filename)
				if !util.IsCiphertext(after) || bytes.Contains(after, []byte("Replacement")) {
					t.Fatal("conditional write exposed encrypted content")
				}
				bad := bytes.Clone(after)
				bad[len(bad)-1] ^= 1
				if err = os.WriteFile(filename, bad, 0644); err != nil {
					t.Fatal(err)
				}
				if _, _, err = LoadTreeSnapshot(box, tree.Path, util.NewLute()); err == nil {
					t.Fatal("snapshot substituted cached plaintext for corrupt ciphertext")
				}
				if err = os.WriteFile(filename, after, 0644); err != nil {
					t.Fatal(err)
				}
				if _, err = WriteTreeIfUnchanged(fresh, bad); err == nil {
					t.Fatal("conditional writer accepted unauthenticated source ciphertext")
				}
				locked = true
				if _, _, err = LoadTreeSnapshot(box, tree.Path, util.NewLute()); err == nil {
					t.Fatal("snapshot bypassed notebook locking")
				}
				if _, err = WriteTreeIfUnchanged(fresh, after); err == nil {
					t.Fatal("conditional writer bypassed notebook locking")
				}
				got, _ := os.ReadFile(filename)
				if !bytes.Equal(after, got) {
					t.Fatal("failed authenticated write changed ciphertext")
				}
				locked = false
			}
			_, baseline, err = LoadTreeSnapshot(box, tree.Path, util.NewLute())
			if err != nil {
				t.Fatal(err)
			}
			if err = os.Remove(filename); err != nil {
				t.Fatal(err)
			}
			if _, err = WriteTreeIfUnchanged(fresh, baseline); !os.IsNotExist(err) {
				t.Fatal("conditional write recreated a deleted document", err)
			}
			if _, err = os.Stat(filename); !os.IsNotExist(err) {
				t.Fatal("deleted document was restored")
			}
		})
	}
}
