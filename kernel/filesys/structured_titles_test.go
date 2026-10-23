package filesys

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestStructuredTitlesSourceReaders(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(map[bool]string{false: "plain", true: "encrypted"}[encrypted], func(t *testing.T) {
			box, id, _, _ := setupStalePathTest(t)
			oldConf, oldProvider, oldAcquire, oldRelease := util.ConfDir, DEKProvider, DEKLockAcquire, DEKLockRelease
			util.ConfDir = t.TempDir()
			DEKLockAcquire, DEKLockRelease = nil, nil
			t.Cleanup(func() {
				util.ConfDir, DEKProvider, DEKLockAcquire, DEKLockRelease = oldConf, oldProvider, oldAcquire, oldRelease
			})
			var key []byte
			if encrypted {
				key = bytes.Repeat([]byte{27}, 32)
			}
			DEKProvider = func(string) ([]byte, error) { return bytes.Clone(key), nil }
			configPath := filepath.Join(util.DataDir, box, documentaddressing.ConfigPath)
			if err := os.MkdirAll(filepath.Dir(configPath), 0755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(configPath, []byte(`{"name":"Old notebook"}`), 0600); err != nil {
				t.Fatal(err)
			}
			p := "/" + id + ".sy"
			for _, title := range []string{"A/B", "../literal/", "A&#47;B/C", "**bold**/`code`", "A／B/C"} {
				tree := treenode.NewTree(box, p, "/"+title, title)
				if _, err := WriteTree(tree); err != nil {
					t.Fatal(err)
				}
				if tree.Root.Spec != treenode.DocumentTitleSpec {
					t.Fatal("new title missing source spec")
				}
				cache.RemoveTreeDataInBox(tree.ID, box)
				loaded, err := LoadTree(box, p, util.NewLute())
				if err != nil || loaded.Root.IALAttr("title") != title {
					t.Fatal("load changed title", err)
				}
				properties, err := DocIAL(filepath.Join(util.DataDir, box, p))
				if err != nil || properties["title"] != title {
					t.Fatal("streaming IAL changed title", err)
				}
				if header, err := readParentDocIAL(filepath.Join(util.DataDir, box, p)); err != nil || header["title"] != title {
					t.Fatal("strict properties changed title", err)
				}
				if snapshot, _, err := LoadTreeSnapshot(box, p, util.NewLute()); err != nil || snapshot.Root.IALAttr("title") != title {
					t.Fatal("snapshot changed title", err)
				}
			}
			if encrypted {
				name := filepath.Join(util.DataDir, box, p)
				data, err := os.ReadFile(name)
				if err != nil || !util.IsCiphertext(data) {
					t.Fatal("source lost encryption", err)
				}
				data[len(data)-1] ^= 1
				if err = os.WriteFile(name, data, 0600); err != nil {
					t.Fatal(err)
				}
				cache.RemoveTreeDataInBox(id, box)
				if _, err = DocIAL(name); err == nil {
					t.Fatal("unauthenticated title accepted")
				}
				if _, _, err = LoadTreeSnapshot(box, p, util.NewLute()); err == nil {
					t.Fatal("unauthenticated snapshot accepted")
				}
				after, _ := os.ReadFile(name)
				if !bytes.Equal(data, after) {
					t.Fatal("damaged ciphertext was overwritten")
				}
			}
		})
	}
}
