package filesys

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTreeIOPreservesNonDocumentFiles(t *testing.T) {
	for _, p := range []string{
		"/.siyuan/sort.json", "/.siyuan/conf.json", "/sort.json",
		"/invalid.sy",
		"/.siyuan/20260918000000-root001.sy", "/assets/20260918000000-root001.sy",
		"/20260918000000-root001/../.siyuan/sort.json",
	} {
		t.Run(p, func(t *testing.T) {
			box, _, _, _ := setupStalePathTest(t)
			original := []byte(`{"20260918000000-root001":1}`)
			abs := writeStalePathFixture(t, box, p, original)
			luteEngine := util.NewLute()
			for name, operation := range map[string]func() error{
				"load": func() error {
					_, err := LoadTree(box, p, luteEngine)
					return err
				},
				"data": func() error {
					_, err := LoadTreeByData(original, box, p, luteEngine)
					return err
				},
				"cached load": func() error {
					id := util.GetTreeID(p)
					cache.SetTreeDataInBox(id, box, original)
					defer cache.RemoveTreeDataInBox(id, box)
					deadline := time.Now().Add(time.Second)
					for {
						if _, ok := cache.GetTreeDataInBox(id, box); ok {
							break
						}
						if time.Now().After(deadline) {
							t.Fatal("cache entry was not published")
						}
						time.Sleep(time.Millisecond)
					}
					_, err := LoadTree(box, p, luteEngine)
					return err
				},
				"repair": func() error {
					_, _, err := fixTreeJSONData(box, p, original, luteEngine, nil, false)
					return err
				},
				"write": func() error {
					tree := treenode.NewTree(box, "/20260918000000-root001.sy", "/Test", "Test")
					tree.Path = p
					_, err := WriteTree(tree)
					return err
				},
				"conditional write": func() error {
					tree := treenode.NewTree(box, "/20260918000000-root001.sy", "/Test", "Test")
					tree.Path = p
					_, err := WriteTreeIfUnchanged(tree, original)
					return err
				},
			} {
				t.Run(name, func(t *testing.T) {
					if err := operation(); err == nil {
						t.Fatal("non-document path must be rejected")
					}
					got, err := os.ReadFile(abs)
					if err != nil || !bytes.Equal(got, original) {
						t.Fatalf("source file changed: %v, %s", err, got)
					}
					if _, err := os.Stat(filepath.Join(util.DataDir, box, ".siyuan.sy")); !os.IsNotExist(err) {
						t.Fatalf("unexpected parent document: %v", err)
					}
				})
			}
		})
	}
}

func TestTreePathPreservesDocumentRoundTrips(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "encrypted"}[encrypted], func(t *testing.T) {
			box, parent, child, _ := setupStalePathTest(t)
			originalProvider := DEKProvider
			originalAcquire, originalRelease := DEKLockAcquire, DEKLockRelease
			DEKLockAcquire, DEKLockRelease = nil, nil
			DEKProvider = func(string) ([]byte, error) {
				if encrypted {
					return bytes.Repeat([]byte{19}, 32), nil
				}
				return nil, nil
			}
			t.Cleanup(func() {
				DEKProvider = originalProvider
				DEKLockAcquire, DEKLockRelease = originalAcquire, originalRelease
			})
			for _, p := range []string{"/" + box + ".sy", "/" + parent + ".sy", child} {
				tree := treenode.NewTree(box, p, "/Test", "Test")
				if _, err := WriteTree(tree); err != nil {
					t.Fatal(err)
				}
				cache.ClearTreeCache()
				loaded, err := LoadTree(box, p, util.NewLute())
				if err != nil || loaded.Root.ID != tree.Root.ID {
					t.Fatalf("document round trip failed for %s: %v", p, err)
				}
				luteEngine := util.NewLute()
				data := render.NewJSONRenderer(loaded, luteEngine.RenderOptions, luteEngine.ParseOptions).Render()
				if _, err = LoadTreeByData(data, box, p, luteEngine); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}
