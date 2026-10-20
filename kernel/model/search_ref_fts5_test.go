//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSearchRefRecentStaleDocumentIndex(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		name := "plain"
		if encrypted {
			name = "encrypted"
		}
		t.Run(name, func(t *testing.T) {
			fixture := setupStructureTransactionTest(t)
			setupFoldTransactionDatabase(t, fixture)
			Conf.Search.Store(conf.NewSearch())
			var trees []*parse.Tree
			for _, id := range []string{fixture.sourceID, fixture.targetID} {
				tree, err := LoadTreeByBlockID(id)
				if err != nil {
					t.Fatal(err)
				}
				trees = append(trees, tree)
			}
			boxID := ""
			exec := sql.Exec
			if encrypted {
				boxID = fixture.box.ID
				dek := bytes.Repeat([]byte{0x66}, 32)
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
				exec = func(stmt string, args ...any) error {
					_, err := sql.GetEncryptedDB(boxID).Exec(stmt, args...)
					return err
				}
			}
			firstID := trees[0].Root.FirstChild.ID
			otherID := trees[1].Root.FirstChild.ID
			const secondID = "20261018150000-second1"
			second := treenode.NewParagraph(secondID)
			second.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Second candidate")})
			trees[0].Root.AppendChild(second)
			for _, item := range []struct {
				tree *parse.Tree
				id   string
			}{{trees[1], firstID}, {trees[1], secondID}, {trees[0], otherID}} {
				p := treenode.NewParagraph("")
				p.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: item.id,
					TextMarkBlockRefSubtype: "s", TextMarkTextContent: "Candidate"})
				item.tree.Root.AppendChild(p)
			}
			for _, tree := range trees {
				if _, err := filesys.WriteTree(tree); err != nil {
					t.Fatal(err)
				}
				treenode.UpsertBlockTree(tree)
				sql.IndexTreeQueue(tree)
			}
			sql.FlushQueue()
			for _, tree := range trees {
				sql.UpdateRefsTreeQueue(tree)
			}
			sql.FlushQueue()
			if err := os.MkdirAll(filepath.Join(util.DataDir, "storage"), 0755); err != nil {
				t.Fatal(err)
			}
			setRefUsed(map[string]int64{firstID: 3, otherID: 2, secondID: 1})
			check := func(want []string) {
				t.Helper()
				blocks, newDoc := SearchRefBlockInBox("", "", "", 48, false, false, boxID)
				var got []string
				for _, block := range blocks {
					got = append(got, block.ID)
				}
				if blocks == nil || newDoc || !slices.Equal(got, want) {
					t.Fatalf("recent candidates: got %v newDoc=%v, want %v", got, newDoc, want)
				}
			}
			for _, staleRoot := range []string{"", "20261018150001-missing", fixture.targetID} {
				if err := exec("UPDATE refs SET def_block_root_id = ? WHERE def_block_id IN (?, ?)", staleRoot, firstID, secondID); err != nil {
					t.Fatal(err)
				}
				check([]string{firstID, otherID, secondID})
			}
			treenode.RemoveBlockTree(fixture.box.ID, firstID)
			check([]string{otherID, secondID})
			treenode.RemoveBlockTreesByRootID(fixture.box.ID, fixture.sourceID)
			check([]string{otherID})
			treenode.RemoveBlockTree(fixture.box.ID, otherID)
			check(nil)
		})
	}
}
