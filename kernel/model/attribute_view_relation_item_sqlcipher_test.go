// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
	prepareUnlockedEncryptedBoxTest(t, boxID, key)
	encryptDocumentTestSources(t, key, trees...)
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
	detailSource, err := av.ParseAttributeViewInBox(fixture.source.ID, boxID)
	if err != nil {
		t.Fatal(err)
	}
	detailKey, _ := detailSource.GetKey(fixture.keyID)
	detailKey.Relation.DetailView = &av.RelationDetailView{Spec: 1, Enabled: true, ViewID: fixture.target.Views[0].ID}
	if err = av.SaveAttributeView(detailSource); err != nil {
		t.Fatal(err)
	}
	detailContext := &AttributeViewRelationContext{SourceAvID: fixture.source.ID, SourceItemID: fixture.itemIDs[1], RelationKeyID: fixture.keyID}
	if err = PerformTxSync(&Transaction{DoOperations: []*Operation{{Action: "updateAttrViewRelationItems", AvID: fixture.source.ID,
		BlockID: fixture.sourceBlockID, RowID: detailContext.SourceItemID, KeyID: fixture.keyID,
		Data: AttributeViewRelationItemsChange{AddItemIDs: []string{created.ItemID}}}}}); err != nil {
		t.Fatal(err)
	}
	if err = PerformTxSync(&Transaction{DoOperations: []*Operation{{Action: "updateAttrViewCell", AvID: fixture.target.ID,
		BlockID: fixture.sourceBlockID, RowID: created.ItemID, KeyID: fixture.textKeyID, RelationContext: detailContext,
		Data: &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "Encrypted scoped edit"}}}}}); err != nil {
		t.Fatal(err)
	}
	detailView, _, _, err := RenderAttributeViewWithTargetOptions(fixture.sourceBlockID, fixture.target.ID, "", "", 1, 50, nil,
		"", false, false, "", "", AttributeViewRenderOptions{RelationContext: detailContext})
	if err != nil || detailView.(*av.Table).RowCount != 1 || detailView.(*av.Table).Rows[0].ID != created.ItemID {
		t.Fatalf("encrypted relation detail lost its scope: %v", err)
	}
	detailTarget, err := av.ParseAttributeViewInBox(fixture.target.ID, boxID)
	if err != nil || detailTarget.GetValue(fixture.textKeyID, created.ItemID).Text.Content != "Encrypted scoped edit" {
		t.Fatalf("source carrier saved scoped target edit to a different boundary: %v", err)
	}
	t.Run("native-carrier-domain-with-ordinary-twin", func(t *testing.T) {
		checkEncryptedRelationNativeTwin(t, fixture, detailTarget, created.ItemID, boxID)
	})
	t.Run("sub-items-reparent-undo-automation-domain", func(t *testing.T) {
		checkEncryptedRelationSubItems(t, fixture, created.ItemID, boxID)
		checkRelationDetailSubItemsCellUndo(t, fixture, created.ItemID, boxID)
	})
	checkEncryptedRelationSelfMembership(t, fixture, created.ItemID, boxID)
	// 空载体仍以已验证的来源边界操作；中途全局 ID 映射变化不能改写保存目标。
	if err = detailContext.ResolveStorage(""); err != nil {
		t.Fatal(err)
	}
	previousSaved := av.AttributeViewSaved
	av.AttributeViewSaved = func(id, savedBox string) {
		av.SetAVBoxID(fixture.source.ID, "")
		av.SetAVBoxID(fixture.target.ID, "")
		if previousSaved != nil {
			previousSaved(id, savedBox)
		}
	}
	defer func() { av.AttributeViewSaved = previousSaved }()
	plainContextEdit := &Operation{Action: "updateAttrViewCell", AvID: fixture.target.ID, RowID: created.ItemID,
		KeyID: fixture.textKeyID, RelationContext: detailContext, Data: &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "Detached encrypted scope"}}}
	if err = PerformTxSync(&Transaction{DoOperations: []*Operation{plainContextEdit}}); err != nil {
		t.Fatal(err)
	}
	av.AttributeViewSaved = previousSaved
	detailTarget, err = av.ParseAttributeViewWithStorageContext(fixture.target.ID, boxID)
	if err != nil || detailTarget.GetValue(fixture.textKeyID, created.ItemID).Text.Content != "Detached encrypted scope" {
		t.Fatalf("interleaved map changed encrypted target: %v", err)
	}
	dependency, loadErr := attributeViewContextFilterLoader(detailTarget, "")(fixture.source.ID)
	if loadErr != nil || dependency == nil {
		t.Fatalf("context metadata loader lost encrypted pin: %v", loadErr)
	}
	if domain, known := dependency.StorageContext(); !known || domain != boxID {
		t.Fatal("metadata dependency crossed domain")
	}
	av.SetAVBoxID(fixture.source.ID, boxID)
	av.SetAVBoxID(fixture.target.ID, boxID)
	t.Run("carrierless-document-template", func(t *testing.T) {
		av.RemoveBlockRel(fixture.target.ID, fixture.targetBlockID, func(string) bool { return true })
		template := &av.NewItemTemplate{ID: ast.NewNodeID(), Name: "Document", TargetType: av.NewItemTargetDocument,
			PrimaryKeyTemplate: "Encrypted planned document", SaveLocation: &av.NewItemSaveLocation{PathTemplate: "/Encrypted parent/"}}
		if err := detailTarget.SetNewItemTemplates(&av.NewItemTemplatesConfig{Templates: []*av.NewItemTemplate{template}, DefaultTemplateID: template.ID}); err != nil {
			t.Fatal(err)
		}
		if err := av.SaveAttributeView(detailTarget); err != nil {
			t.Fatal(err)
		}
		p := PreviewAttributeViewRelationItem(fixture.source.ID, "", fixture.keyID, "Input", detailContext)
		if p.Error != "" {
			t.Fatalf("carrierless encrypted preview: %+v", p)
		}
		result, err := CreateAttributeViewRelationDetailItem(fixture.source.ID, "", fixture.keyID, "Input", []*AttributeViewRelationItemCell{{ItemID: detailContext.SourceItemID}}, p, true, detailContext)
		if err != nil || result.IsDetached {
			t.Fatalf("encrypted document creation: %+v, %v", result, err)
		}
		tree, err := LoadTreeByBlockIDInExactBox(result.BlockID, boxID)
		if err != nil || tree.Box != boxID || tree.Root.IALAttr("title") != "Input" {
			t.Fatalf("encrypted document target: %v", err)
		}
		if err = PerformTxSync(&Transaction{DoOperations: []*Operation{{Action: "updateAttrViewCell", AvID: fixture.target.ID,
			RowID: result.ItemID, KeyID: detailTarget.GetBlockKey().ID, RelationContext: detailContext,
			Data: &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "Static encrypted anchor"}}}}}); err != nil {
			t.Fatal(err)
		}
		tree, err = LoadTreeByBlockIDInExactBox(result.BlockID, boxID)
		if err != nil || tree.Root.IALAttr("title") != "Input" {
			t.Fatal("primary edit changed bound document title")
		}
		current, err := av.ParseAttributeViewWithStorageContext(fixture.target.ID, boxID)
		if err != nil || current.GetBlockValue(result.ItemID).Block.Content != "Static encrypted anchor" {
			t.Fatalf("encrypted static anchor not updated: %v", err)
		}
		countDocs := func() int {
			count := 0
			_ = filepath.WalkDir(filepath.Join(util.DataDir, boxID), func(path string, entry os.DirEntry, err error) error {
				if err == nil && !entry.IsDir() && filepath.Ext(path) == ".sy" {
					count++
				}
				return err
			})
			return count
		}
		source, err := av.ParseAttributeViewWithStorageContext(fixture.source.ID, boxID)
		if err != nil {
			t.Fatal(err)
		}
		key, _ := source.GetKey(fixture.keyID)
		key.Relation.CandidateFilters = []*av.ViewFilter{{Column: current.GetBlockKey().ID, Operator: av.FilterOperatorContains, Value: &av.Value{Type: av.KeyTypeBlock, Block: &av.ValueBlock{Content: "never eligible"}}}}
		if err = av.SaveAttributeView(source); err != nil {
			t.Fatal(err)
		}
		before := countDocs()
		p = PreviewAttributeViewRelationItem(fixture.source.ID, "", fixture.keyID, "Rejected", detailContext)
		if p.Error != "" {
			t.Fatal(p.Error)
		}
		if _, err = CreateAttributeViewRelationDetailItem(fixture.source.ID, "", fixture.keyID, "Rejected", []*AttributeViewRelationItemCell{{ItemID: detailContext.SourceItemID}}, p, true, detailContext); err == nil {
			t.Fatal("ineligible encrypted document linked")
		}
		if countDocs() != before {
			t.Fatal("encrypted failed link retained new document")
		}
		key.Relation.CandidateFilters = nil
		if err = av.SaveAttributeView(source); err != nil {
			t.Fatal(err)
		}
		current, err = av.ParseAttributeViewWithStorageContext(fixture.target.ID, boxID)
		if err != nil {
			t.Fatal(err)
		}
		template.SaveLocation.BoxID = ast.NewNodeID()
		if err = current.SetNewItemTemplates(&av.NewItemTemplatesConfig{Templates: []*av.NewItemTemplate{template}, DefaultTemplateID: template.ID}); err != nil {
			t.Fatal(err)
		}
		if err = av.SaveAttributeView(current); err != nil {
			t.Fatal(err)
		}
		if rejected := PreviewAttributeViewRelationItem(fixture.source.ID, "", fixture.keyID, "Rejected", detailContext); rejected.Error == "" {
			t.Fatal("encrypted plan crossed domain")
		}
		template.SaveLocation.BoxID = ""
		if err = current.SetNewItemTemplates(&av.NewItemTemplatesConfig{Templates: []*av.NewItemTemplate{template}, DefaultTemplateID: template.ID}); err != nil {
			t.Fatal(err)
		}
		if err = av.SaveAttributeView(current); err != nil {
			t.Fatal(err)
		}
	})
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
