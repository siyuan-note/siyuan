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
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewRelationItemEncrypted(t *testing.T) {
	fixture := setupRelationItemTest(t, &av.NewItemTemplate{TargetType: av.NewItemTargetDetached, PrimaryKeyTemplate: "Encrypted task"})
	boxID := fixture.files.box.ID
	var trees []*parse.Tree
	for _, id := range []string{fixture.files.sourceID, fixture.files.targetID} {
		tree, err := LoadTreeByBlockID(id)
		if err != nil {
			t.Fatal(err)
		}
		trees = append(trees, tree)
	}
	markRuntimeEncryptedBox(boxID)
	key := bytes.Repeat([]byte{0x64}, 32)
	setDEKForTest(boxID, key)
	boxConf := conf.NewBoxConf()
	boxConf.Encrypted = true
	boxConf.BoxCrypt = &conf.BoxEncryption{Spec: boxEncryptionSpec}
	if err := encryptBoxMetadata(boxID, boxConf, key); err != nil {
		t.Fatal(err)
	}
	config, err := json.Marshal(boxConf)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json"), config, 0600); err != nil {
		t.Fatal(err)
	}
	mountedEncryptedBoxes.Store(boxID, true)
	if err = treenode.OpenEncryptedBlockTreeDB(boxID, key); err != nil {
		t.Fatal(err)
	}
	if err = sql.OpenEncryptedDB(boxID, key); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		sql.CloseEncryptedDB(boxID)
		treenode.CloseEncryptedBlockTreeDB(boxID)
		mountedEncryptedBoxes.Delete(boxID)
		forgetRuntimeEncryptedBox(boxID)
		encryptedBoxLifecycles.Delete(boxID)
		cachedDEKsLock.Lock()
		delete(cachedDEKs, boxID)
		cachedDEKsLock.Unlock()
		for _, view := range []*av.AttributeView{fixture.source, fixture.target} {
			av.SetAVBoxID(view.ID, "")
		}
	})
	for _, view := range []*av.AttributeView{fixture.source, fixture.target} {
		av.SetAVBoxID(view.ID, boxID)
	}
	for _, tree := range trees {
		if _, err = filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
		var nodes []*ast.Node
		for child := tree.Root.FirstChild; child != nil; child = child.Next {
			if child.Type == ast.NodeAttributeView {
				nodes = append(nodes, child)
			}
		}
		av.BatchUpsertBlockRel(nodes)
	}
	for _, view := range []*av.AttributeView{fixture.source, fixture.target} {
		av.SetAVBoxID(view.ID, boxID)
		if err = av.SaveAttributeView(view); err != nil {
			t.Fatal(err)
		}
		if err = os.Remove(filepath.Join(util.DataDir, "storage", "av", view.ID+".json")); err != nil {
			t.Fatal(err)
		}
	}
	preview := PreviewAttributeViewRelationItem(fixture.source.ID, fixture.sourceBlockID, fixture.keyID, "Input")
	if preview.Error != "" || preview.PrimaryKey != "Encrypted task" {
		t.Fatalf("encrypted preview: %+v", preview)
	}
	cells := []*AttributeViewRelationItemCell{{ItemID: fixture.itemIDs[0]}}
	created, err := CreateAttributeViewRelationItem(fixture.source.ID, fixture.sourceBlockID, fixture.keyID, "Input", cells, preview, true)
	if err != nil {
		t.Fatal(err)
	}
	if created.Content != "Input" {
		t.Fatalf("encrypted input name not applied: %+v", created)
	}
	for _, operations := range [][]*Operation{created.Transaction.UndoOperations, created.Transaction.DoOperations} {
		if err = PerformTxSync(&Transaction{DoOperations: cloneOperations(operations), isReplay: true}); err != nil {
			t.Fatal(err)
		}
	}
	_, _, _, _, _, candidates, total, err := GetAttributeViewRelationCandidates(fixture.source.ID, fixture.keyID, "", nil, 1, 16, nil, fixture.sourceBlockID)
	if err != nil || total != 1 || len(candidates) != 1 || candidates[0].ID != created.ItemID {
		t.Fatalf("encrypted candidates lost source context: total=%d, err=%v", total, err)
	}
	paths := map[string][]byte{}
	for _, view := range []*av.AttributeView{fixture.source, fixture.target} {
		path := filepath.Join(util.DataDir, boxID, "storage", "av", view.ID+".json")
		ciphertext, err := os.ReadFile(path)
		if err != nil || !util.IsCiphertext(ciphertext) {
			t.Fatalf("plaintext relation item: %v", err)
		}
		paths[path] = ciphertext
		if _, err = os.Stat(filepath.Join(util.DataDir, "storage", "av", view.ID+".json")); !os.IsNotExist(err) {
			t.Fatal("encrypted relation created a plaintext database")
		}
	}
	// 普通载体不得借助已解锁笔记本的全局映射读取加密数据库。
	plainBoxID, plainDocID := ast.NewNodeID(), ast.NewNodeID()
	if err = os.MkdirAll(filepath.Join(util.DataDir, plainBoxID, ".siyuan"), 0755); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(util.DataDir, plainBoxID, ".siyuan", "conf.json"), []byte(`{}`), 0600); err != nil {
		t.Fatal(err)
	}
	plain := treenode.NewTree(plainBoxID, "/"+plainDocID+".sy", "/Plain", "Plain")
	if _, err = filesys.WriteTree(plain); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(plain)
	if _, _, _, _, _, _, _, err = GetAttributeViewRelationCandidates(fixture.source.ID, fixture.keyID, "", nil, 1, 16, nil, plainDocID); err == nil {
		t.Fatal("ordinary carrier exposed encrypted candidates")
	}
	av.SetAVBoxID(fixture.source.ID, boxID)
	for path, before := range paths {
		after, readErr := os.ReadFile(path)
		if readErr != nil || !bytes.Equal(before, after) {
			t.Fatal("rejected carrier changed ciphertext")
		}
	}
	for _, failure := range []string{"locked", "corrupted"} {
		t.Run(failure, func(t *testing.T) {
			if failure == "locked" {
				cachedDEKsLock.Lock()
				delete(cachedDEKs, boxID)
				cachedDEKsLock.Unlock()
				defer setDEKForTest(boxID, key)
			} else {
				path := filepath.Join(util.DataDir, boxID, "storage", "av", fixture.target.ID+".json")
				paths[path][len(paths[path])-1] ^= 1
				if err = os.WriteFile(path, paths[path], 0600); err != nil {
					t.Fatal(err)
				}
			}
			cache.ClearAVCache()
			if p := PreviewAttributeViewRelationItem(fixture.source.ID, fixture.sourceBlockID, fixture.keyID, "Input"); p.Error == "" {
				t.Fatal("inaccessible encrypted preview succeeded")
			}
			if _, err = CreateAttributeViewRelationItem(fixture.source.ID, fixture.sourceBlockID, fixture.keyID, "Input", cells, preview, false); err == nil {
				t.Fatal("inaccessible encrypted creation succeeded")
			}
			for path, before := range paths {
				after, readErr := os.ReadFile(path)
				if readErr != nil || !bytes.Equal(before, after) {
					t.Fatal("failed encrypted creation changed ciphertext")
				}
			}
		})
	}
}
