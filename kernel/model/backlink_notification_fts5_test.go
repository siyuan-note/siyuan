//go:build fts5 && (sqlcipher || libsqlcipher)

package model

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestBackmentionNotificationPlainAndEncrypted(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		name := "plain"
		if encrypted {
			name = "encrypted"
		}
		t.Run(name, func(t *testing.T) {
			fixture := setupStructureTransactionTest(t)
			setupFoldTransactionDatabase(t, fixture)
			Conf.Search = conf.NewSearch()
			Conf.Search.BacklinkMentionDoc = true
			Conf.Search.BacklinkMentionName = true
			Conf.Search.BacklinkMentionKeywordsLimit = 0
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
			for _, tree := range trees {
				var err error
				id := tree.Root.ID
				for tree.Root.FirstChild != nil {
					tree.Root.FirstChild.Unlink()
				}
				p := treenode.NewParagraph(ast.NewNodeID())
				if id == fixture.sourceID {
					tree.Root.SetIALAttr("title", "needle")
					tree.HPath = "/needle"
					p.SetIALAttr("name", "second")
					p.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("source")})
				} else {
					p.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("needle second")})
				}
				tree.Root.AppendChild(p)
				if _, err = filesys.WriteTree(tree); err != nil {
					t.Fatal(err)
				}
				treenode.UpsertBlockTree(tree)
				sql.IndexTreeQueue(tree)
			}
			sql.FlushQueue()
			calls := 0
			notify := func(msg string, timeout int) string {
				calls++
				if timeout != 5000 {
					t.Fatalf("warning timeout = %d", timeout)
				}
				return "warning"
			}
			var docs []*Backlink
			if encrypted {
				docs, _ = GetBackmentionDocInBox(fixture.sourceID, fixture.targetID, "", false, true, boxID, notify)
			} else {
				docs, _ = GetBackmentionDoc(fixture.sourceID, fixture.targetID, "", false, true, notify)
			}
			if calls != 1 || len(docs) == 0 {
				t.Fatalf("document warning calls=%d results=%d", calls, len(docs))
			}
			_, _, mentions, _, count := GetBacklink2InBoxWithOptions(fixture.sourceID, "", "", 0, 0, false, boxID, nil, true, true, notify)
			if calls != 2 || len(mentions) == 0 || count == 0 {
				t.Fatalf("list warning calls=%d results=%d count=%d", calls, len(mentions), count)
			}
			_, _, _, _, silentCount := GetBacklink2InBoxWithOptions(fixture.sourceID, "", "", 0, 0, false, boxID, nil, true, true, nil)
			if silentCount != count || calls != 2 {
				t.Fatal("suppression changed search results")
			}
		})
	}
}
