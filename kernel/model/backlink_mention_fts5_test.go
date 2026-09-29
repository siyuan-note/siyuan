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
	"github.com/emirpasic/gods/sets/hashset"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBacklinkMentionFilteredPagination(t *testing.T) {
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
				for tree.Root.FirstChild != nil {
					tree.Root.FirstChild.Unlink()
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
			trees[0].Root.SetIALAttr("title", "needle")
			trees[0].HPath = "/needle"
			self := treenode.NewParagraph("20260926160009-self001")
			self.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("needle")})
			trees[0].Root.AppendChild(self)
			ids := []string{
				"20260926160001-mention", "20260926160002-mention",
				"20260926160003-mention", "20260926160004-mention",
				"20260926160005-ref0001", "20260926160006-ref0002",
				"20260926160007-ref0004", "20260926160008-ref0003",
			}
			for i, id := range ids {
				p := treenode.NewParagraph(id)
				switch i {
				case 1:
					p.SetIALAttr("name", "needle")
					p.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("metadata match")})
				case 4, 5, 7:
					if i != 5 {
						p.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("needle ")})
					}
					p.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref",
						TextMarkBlockRefID: fixture.sourceID, TextMarkBlockRefSubtype: "s", TextMarkTextContent: "broad"})
				case 6:
					p.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref",
						TextMarkBlockRefID: fixture.targetID, TextMarkBlockRefSubtype: "s", TextMarkTextContent: "broad"})
				default:
					p.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("needle")})
				}
				trees[1].Root.AppendChild(p)
			}
			for _, tree := range trees {
				if _, err := filesys.WriteTree(tree); err != nil {
					t.Fatal(err)
				}
				treenode.UpsertBlockTree(tree)
				sql.IndexTreeQueue(tree)
				sql.UpdateRefsTreeQueue(tree)
			}
			sql.FlushQueue()
			query, args := buildBackmentionQuery(columnFilter()+`:("needle" OR "broad")`, fixture.sourceID, "", 64)
			if candidates := sql.SelectBlocksRawStmtArgsInBox(query, args, 64, boxID); len(candidates) != len(ids) {
				var candidateIDs []string
				for _, candidate := range candidates {
					candidateIDs = append(candidateIDs, candidate.ID)
				}
				t.Fatalf("fixture should contain %d candidates, got %v", len(ids), candidateIDs)
			}
			excluded := hashset.New(ids[4], ids[5], ids[7])
			for _, limit := range []int{1, 2, 3, 4, 5, 64} {
				Conf.Search.Limit = limit
				want := []string{ids[3], ids[2], ids[1], ids[0]}
				if limit < len(want) {
					want = want[:limit]
				}
				for _, keyword := range []string{"", "needle", "absent"} {
					keywords, blocks := searchBackmentionInBox([]string{"needle", "broad"}, keyword, excluded, fixture.sourceID, 12, boxID)
					if keyword == "absent" {
						if len(blocks) != 0 || len(keywords) != 0 {
							t.Fatal("unmatched keyword returned mentions")
						}
						continue
					}
					var got []string
					for _, block := range blocks {
						got = append(got, block.ID)
					}
					if !reflect.DeepEqual(got, want) || !reflect.DeepEqual(keywords, []string{"needle"}) {
						t.Fatalf("limit %d, keyword %q: got %v/%v, want %v/[needle]", limit, keyword, got, keywords, want)
					}
					_, _, mentions, _, count := GetBacklink2InBox(fixture.sourceID, "", keyword, 0, 0, false, boxID)
					if len(mentions) != 1 || count != len(want) {
						t.Fatalf("list limit %d, keyword %q: got %d groups/%d mentions, want 1/%d", limit, keyword, len(mentions), count, len(want))
					}
				}
			}
			Conf.Search.Limit = 2
			_, blocks := searchBackmentionInBox([]string{"needle", "broad"}, "", hashset.New(ids[0], ids[1], ids[2], ids[3], ids[4], ids[5], ids[7]), fixture.sourceID, 12, boxID)
			if len(blocks) != 0 {
				t.Fatal("fully filtered candidates returned mentions")
			}
			if encrypted {
				_, blocks = searchBackmention([]string{"needle", "broad"}, "", excluded, fixture.sourceID, 12)
				if len(blocks) != 0 {
					t.Fatal("encrypted mentions leaked into global search")
				}
			}
		})
	}
}
