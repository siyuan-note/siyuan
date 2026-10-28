// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/parse"
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
			leaseDepth := 0
			DEKLockAcquire = func(string) { leaseDepth++ }
			DEKLockRelease = func(string) { leaseDepth-- }
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
				visited := false
				if err := WalkTreeSnapshots(box, []string{p}, func(snapshot *parse.Tree) error {
					visited = true
					if leaseDepth < 1 {
						t.Fatal("batch released the crypto lease before consuming its snapshot")
					}
					if snapshot.Root.IALAttr("title") != title || snapshot.HPath != "/"+title {
						t.Fatal("batch snapshot changed literal title")
					}
					return nil
				}); err != nil || !visited || leaseDepth != 0 {
					t.Fatal("batch snapshot did not authenticate source", err)
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
				if err = WalkTreeSnapshots(box, []string{p}, func(*parse.Tree) error {
					t.Fatal("unauthenticated source reached the batch visitor")
					return nil
				}); err == nil || leaseDepth != 0 {
					t.Fatal("unauthenticated batch snapshot accepted")
				}
				after, _ := os.ReadFile(name)
				if !bytes.Equal(data, after) {
					t.Fatal("damaged ciphertext was overwritten")
				}
			}
		})
	}
}
