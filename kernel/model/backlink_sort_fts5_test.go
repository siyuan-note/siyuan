//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBacklinkAnchorSortContext(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		name := "plain"
		if encrypted {
			name = "encrypted"
		}
		t.Run(name, func(t *testing.T) {
			fixture := setupStructureTransactionTest(t)
			setupFoldTransactionDatabase(t, fixture)
			Conf.Search = conf.NewSearch()
			var trees []*parse.Tree
			for _, id := range []string{fixture.sourceID, fixture.targetID} {
				tree, err := LoadTreeByBlockID(id)
				if err != nil {
					t.Fatal(err)
				}
				trees = append(trees, tree)
			}
			boxID := ""
			if encrypted {
				boxID = fixture.box.ID
				dek := bytes.Repeat([]byte{0x65}, 32)
				markRuntimeEncryptedBox(boxID)
				setDEKForTest(boxID, dek)
				boxConf := conf.NewBoxConf()
				boxConf.Encrypted = true
				boxConf.BoxCrypt = &conf.BoxEncryption{Spec: boxEncryptionSpec}
				if err := encryptBoxMetadata(boxID, boxConf, dek); err != nil {
					t.Fatal(err)
				}
				data, err := json.Marshal(boxConf)
				if err != nil {
					t.Fatal(err)
				}
				if err = os.WriteFile(filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json"), data, 0600); err != nil {
					t.Fatal(err)
				}
				mountedEncryptedBoxes.Store(boxID, true)
				t.Cleanup(func() {
					sql.CloseEncryptedDB(boxID)
					treenode.CloseEncryptedBlockTreeDB(boxID)
					mountedEncryptedBoxes.Delete(boxID)
					forgetRuntimeEncryptedBox(boxID)
					encryptedBoxLifecycles.Delete(boxID)
					cachedDEKsLock.Lock()
					delete(cachedDEKs, boxID)
					cachedDEKsLock.Unlock()
				})
				if err = treenode.OpenEncryptedBlockTreeDB(boxID, dek); err != nil {
					t.Fatal(err)
				}
				if err = sql.OpenEncryptedDB(boxID, dek); err != nil {
					t.Fatal(err)
				}
			}
			const childID = "20260917000000-child01"
			ids := []string{"20260917000001-ref0010", "20260917000002-ref0002", "20260917000003-ref0001", "20260917000004-ref002b"}
			for i, tree := range trees {
				for tree.Root.FirstChild != nil {
					tree.Root.FirstChild.Unlink()
				}
				intro := treenode.NewParagraph(childID)
				if i == 1 {
					intro.ID = "20260917000005-intro00"
					intro.SetIALAttr("id", intro.ID)
				}
				intro.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Intro")})
				tree.Root.AppendChild(intro)
				if i == 1 {
					for j, anchor := range []string{"A10", "A2", "A1", "A2"} {
						p := treenode.NewParagraph(ids[j])
						p.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Question ")})
						target := fixture.sourceID
						if j == 2 {
							target = childID
						}
						p.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: target,
							TextMarkBlockRefSubtype: "s", TextMarkTextContent: anchor})
						tree.Root.AppendChild(p)
					}
				}
				if _, err := filesys.WriteTree(tree); err != nil {
					t.Fatal(err)
				}
				treenode.UpsertBlockTree(tree)
				sql.IndexTreeQueue(tree)
				sql.UpdateRefsTreeQueue(tree)
			}
			sql.FlushQueue()
			for _, entry := range []struct {
				mode     int
				children bool
				keyword  string
				want     []string
			}{
				{0, true, "", ids},
				{1, true, "", []string{ids[2], ids[1], ids[3], ids[0]}},
				{2, true, "", []string{ids[0], ids[1], ids[3], ids[2]}},
				{1, false, "", []string{ids[1], ids[3], ids[0]}},
				{1, true, "A2", []string{ids[1], ids[3]}},
			} {
				for _, explicitBox := range []bool{false, true} {
					var links []*Backlink
					if explicitBox {
						links, _ = GetBacklinkDocInBoxWithSort(fixture.sourceID, fixture.targetID, entry.keyword, entry.children, true, boxID, entry.mode)
					} else {
						links, _ = GetBacklinkDocWithSort(fixture.sourceID, fixture.targetID, entry.keyword, entry.children, true, entry.mode)
					}
					var got []string
					for _, link := range links {
						got = append(got, link.ID)
					}
					if !reflect.DeepEqual(got, entry.want) {
						t.Fatalf("mode %d, children %v, keyword %q, explicit box %v: got %v, want %v", entry.mode, entry.children, entry.keyword, explicitBox, got, entry.want)
					}
				}
			}
			// 首段纯引用会传递到整篇文档，锚文本排序应继续排列其中的独立引用。
			tree, err := LoadTreeByBlockID(fixture.targetID)
			if err != nil {
				t.Fatal(err)
			}
			tree.Root.FirstChild.Unlink()
			for child := tree.Root.FirstChild; child != nil; child = child.Next {
				child.FirstChild.Unlink()
			}
			if _, err = filesys.WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			treenode.UpsertBlockTree(tree)
			sql.IndexTreeQueue(tree)
			sql.UpdateRefsTreeQueue(tree)
			sql.FlushQueue()
			for _, mode := range []int{0, 1, 2, 0} {
				want := []string{fixture.targetID}
				if mode == 1 {
					want = []string{ids[2], ids[1], ids[3], ids[0]}
				} else if mode == 2 {
					want = []string{ids[0], ids[1], ids[3], ids[2]}
				}
				for _, explicitBox := range []bool{false, true} {
					var links []*Backlink
					if explicitBox {
						links, _ = GetBacklinkDocInBoxWithSort(fixture.sourceID, fixture.targetID, "", true, false, boxID, mode)
					} else {
						links, _ = GetBacklinkDocWithSort(fixture.sourceID, fixture.targetID, "", true, false, mode)
					}
					var got []string
					for _, link := range links {
						got = append(got, link.ID)
					}
					if !reflect.DeepEqual(got, want) {
						t.Fatalf("document grouping, mode %d, explicit box %v: got %v, want %v", mode, explicitBox, got, want)
					}
				}
			}
			globalQuery := GlobalBacklinkQuery{ID: fixture.sourceID, Notebook: boxID, Sort: 1, ContainChildren: true}
			allow := func(string) bool { return true }
			token, globalItems, total, _, expired, err := GetGlobalBacklinks(globalQuery, "", 0, "", allow)
			if err != nil || expired || total != 4 || globalItems[0].ID != ids[2] {
				t.Fatalf("global sorting in %s notebook: %+v %v %v", name, globalItems, expired, err)
			}
			contexts, expired, err := GetGlobalBacklinkContexts(globalQuery, token, []string{ids[2], ids[0]}, allow)
			if err != nil || expired || len(contexts) != 2 || contexts[0].ID != ids[2] {
				t.Fatalf("global contexts in %s notebook: %+v %v %v", name, contexts, expired, err)
			}
			ClearGlobalBacklinkSnapshots(boxID)
			if _, expired, _ = GetGlobalBacklinkContexts(globalQuery, token, []string{ids[0]}, allow); !expired {
				t.Fatal("cleared notebook snapshot remained readable")
			}
		})
	}
}
