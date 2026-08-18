// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package model

import (
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestNewItemParentPathTemplate(t *testing.T) {
	tests := map[string]string{
		"":                   "",
		"/":                  "/",
		"relative":           "",
		"/Document":          "/",
		"folder/Document":    "folder",
		"/folder/Document":   "/folder",
		"/folder/subfolder/": "/folder/subfolder/",
	}
	for input, expected := range tests {
		if actual := newItemParentPathTemplate(input); expected != actual {
			t.Fatalf("newItemParentPathTemplate(%q): expected %q, got %q", input, expected, actual)
		}
	}
}

func TestNewItemPathTitleFallback(t *testing.T) {
	if expected := "2026-07-18"; expected != newItemTitleFromPath("/Daily Notes/"+expected) {
		t.Fatal("the last save path segment should be available as the document title")
	}
	if "" != newItemTitleFromPath("/Daily Notes/") {
		t.Fatal("a save path ending with a slash should not provide a document title")
	}
}

func TestNewItemPrimaryKeyUsesClippedTitleFallback(t *testing.T) {
	createdAt := time.Date(2026, time.August, 13, 12, 0, 0, 0, time.Local)
	template := &av.NewItemTemplate{TargetType: av.NewItemTargetDetached}
	preview, err := resolveAttributeViewNewItemTemplateWithFallback(ast.NewNodeID(), template, createdAt, " Clipped title ")
	if nil != err {
		t.Fatalf("resolve clipped title fallback failed: %s", err)
	}
	if "Clipped title" != preview.PrimaryKey {
		t.Fatalf("unexpected clipped title fallback: %q", preview.PrimaryKey)
	}

	template.PrimaryKeyTemplate = `{{now | date "2006-01-02"}}`
	preview, err = resolveAttributeViewNewItemTemplateWithFallback(ast.NewNodeID(), template, createdAt, "Clipped title")
	if nil != err {
		t.Fatalf("resolve configured primary key failed: %s", err)
	}
	if "2026-08-13" != preview.PrimaryKey {
		t.Fatalf("the configured primary key template should take precedence: %q", preview.PrimaryKey)
	}
}

func TestNewItemDocumentPreviewUsesCurrentDatabaseInstance(t *testing.T) {
	boxID := ast.NewNodeID()
	template := &av.NewItemTemplate{TargetType: av.NewItemTargetDocument, SaveLocation: &av.NewItemSaveLocation{}}
	for name, blockTree := range map[string]*treenode.BlockTree{
		"original": {ID: ast.NewNodeID(), RootID: ast.NewNodeID(), BoxID: boxID, HPath: "/Original"},
		"mirror":   {ID: ast.NewNodeID(), RootID: ast.NewNodeID(), BoxID: boxID, HPath: "/Mirror"},
	} {
		preview := newItemDocumentPreview(blockTree, boxID, template.SaveLocation.PathTemplate, "Child", false)
		expectedHPath := "/Original/Child"
		if "mirror" == name {
			expectedHPath = "/Mirror/Child"
		}
		if expectedHPath != preview.HPath || blockTree.RootID != preview.parentID {
			t.Fatalf("%s database instance resolved to unexpected parent: %+v", name, preview)
		}
	}
}

func TestNewItemDocumentPreviewUsesBoxDocAsLogicalRoot(t *testing.T) {
	fixture := setupFileOperationTest(t)
	blockTree := &treenode.BlockTree{
		ID:     fixture.box.ID,
		RootID: fixture.box.ID,
		BoxID:  fixture.box.ID,
		HPath:  "/File operation test",
	}

	preview := newItemDocumentPreview(blockTree, fixture.box.ID, "2026/202608/", "Reference", false)
	if "/2026/202608/Reference" != preview.HPath {
		t.Fatalf("notebook document resolved to unexpected path: %+v", preview)
	}
	if "" != preview.parentID {
		t.Fatalf("notebook document was used as a physical parent: %+v", preview)
	}
}

func TestCreatedDocLifecycleOperationsRequireSnapshot(t *testing.T) {
	docID := ast.NewNodeID()
	tx := &Transaction{}
	if nil == tx.doRestoreCreatedDoc(&Operation{ID: docID}) {
		t.Fatal("restore created doc without an internal snapshot should fail")
	}
	if nil == tx.doRemoveCreatedDoc(&Operation{ID: docID}) {
		t.Fatal("remove created doc without an internal snapshot should fail")
	}
}

func TestBuildNewItemFieldValueOperationsWithoutKeyIDs(t *testing.T) {
	attrView := &av.AttributeView{ID: ast.NewNodeID()}
	blockKey := av.NewKey(ast.NewNodeID(), "Block", "", av.KeyTypeBlock)
	textKey := av.NewKey(ast.NewNodeID(), "Text", "", av.KeyTypeText)
	attrView.KeyValues = []*av.KeyValues{{Key: blockKey}, {Key: textKey}}
	value := &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: "value"}}

	operations := buildNewItemFieldValueOperations(attrView, map[string]*av.Value{textKey.ID: value}, ast.NewNodeID())
	if 1 != len(operations) || "updateAttrViewCell" != operations[0].Action || textKey.ID != operations[0].KeyID {
		t.Fatalf("unexpected field operations: %+v", operations)
	}
}

func TestAttributeViewItemDocumentTemplate(t *testing.T) {
	documentTemplate := &av.NewItemTemplate{ID: ast.NewNodeID(), TargetType: av.NewItemTargetDocument, Icon: "1f4c4"}
	attrView := &av.AttributeView{
		DefaultTemplateID: documentTemplate.ID,
		NewItemTemplates:  []*av.NewItemTemplate{documentTemplate},
	}
	actual, err := attributeViewItemDocumentTemplate(attrView, CreateAttributeViewItemDocsSaveModeTemplate)
	if nil != err || actual != documentTemplate {
		t.Fatalf("the default document template should be reused: template=%+v err=%v", actual, err)
	}

	actual, err = attributeViewItemDocumentTemplate(attrView, CreateAttributeViewItemDocsSaveModeSubDoc)
	if nil != err || nil == actual.SaveLocation || av.NewItemTargetDocument != actual.TargetType {
		t.Fatalf("the child document mode should use the current document as its parent: template=%+v err=%v", actual, err)
	}

	attrView.DefaultTemplateID = ""
	actual, err = attributeViewItemDocumentTemplate(attrView, CreateAttributeViewItemDocsSaveModeTemplate)
	if nil != err || nil != actual.SaveLocation || av.NewItemTargetDocument != actual.TargetType {
		t.Fatalf("a blank document template should inherit the document creation location: template=%+v err=%v", actual, err)
	}

	detachedTemplate := &av.NewItemTemplate{ID: ast.NewNodeID(), TargetType: av.NewItemTargetDetached}
	attrView.DefaultTemplateID = detachedTemplate.ID
	attrView.NewItemTemplates = []*av.NewItemTemplate{detachedTemplate}
	actual, err = attributeViewItemDocumentTemplate(attrView, CreateAttributeViewItemDocsSaveModeTemplate)
	if nil != err || actual == detachedTemplate || av.NewItemTargetDocument != actual.TargetType {
		t.Fatalf("a detached default template should fall back to a blank document template: template=%+v err=%v", actual, err)
	}

	if _, err = attributeViewItemDocumentTemplate(attrView, "invalid"); nil == err {
		t.Fatal("an invalid save mode should be rejected")
	}
}

func TestApplyNewItemDocumentAttrs(t *testing.T) {
	tree := treenode.NewTree(ast.NewNodeID(), "/"+ast.NewNodeID()+".sy", "/Document", "Document")
	tree.Root.SetIALAttr(DocHiddenAttr, "true")
	template := &av.NewItemTemplate{TargetType: av.NewItemTargetDocument, Icon: "1f4c4"}
	if !applyNewItemDocumentAttrs(tree, template) {
		t.Fatal("item template attributes should update the document")
	}
	if "1f4c4" != tree.Root.IALAttr("icon") {
		t.Fatalf("unexpected document icon: %q", tree.Root.IALAttr("icon"))
	}
	if "" != tree.Root.IALAttr(DocHiddenAttr) {
		t.Fatal("the disabled visibility option should override the content template attribute")
	}

	template.HideInFileTree = true
	if !applyNewItemDocumentAttrs(tree, template) {
		t.Fatal("enabling the visibility option should update the document")
	}
	if "true" != tree.Root.IALAttr(DocHiddenAttr) {
		t.Fatal("the enabled visibility option should hide the document")
	}
	if applyNewItemDocumentAttrs(tree, template) {
		t.Fatal("applying unchanged item template attributes should be a no-op")
	}
}

func TestRemoveNodeAvIDKeepsHiddenAttr(t *testing.T) {
	avID := ast.NewNodeID()
	node := &ast.Node{Type: ast.NodeDocument, ID: ast.NewNodeID()}
	node.SetIALAttr(av.NodeAttrNameAvs, avID)
	node.SetIALAttr(DocHiddenAttr, "true")
	attrs := removeNodeAvIDAttrs(node, avID)
	if "true" != attrs[DocHiddenAttr] || "true" != node.IALAttr(DocHiddenAttr) {
		t.Fatal("removing a database binding should preserve the document visibility setting")
	}
	if "" != attrs[av.NodeAttrNameAvs] {
		t.Fatalf("the removed database ID should be cleared: %q", attrs[av.NodeAttrNameAvs])
	}
}

func TestResolveDocCreateSaveLocation(t *testing.T) {
	originalConf, originalDataDir := Conf, util.DataDir
	util.DataDir = t.TempDir()
	Conf = NewAppConf()
	Conf.FileTree = conf.NewFileTree()
	Conf.NotebookCrypto = conf.NewNotebookCrypto()
	Conf.Sync = conf.NewSync()
	t.Cleanup(func() {
		Conf = originalConf
		util.DataDir = originalDataDir
	})

	currentBoxID, globalBoxID, localBoxID := ast.NewNodeID(), ast.NewNodeID(), ast.NewNodeID()
	currentBoxConf, globalBoxConf, localBoxConf := conf.NewBoxConf(), conf.NewBoxConf(), conf.NewBoxConf()
	currentBoxConf.Name, currentBoxConf.Closed = "Current", false
	globalBoxConf.Name, globalBoxConf.Closed = "Global", false
	localBoxConf.Name, localBoxConf.Closed = "Local", false
	for boxID, boxConf := range map[string]*conf.BoxConf{
		currentBoxID: currentBoxConf,
		globalBoxID:  globalBoxConf,
		localBoxID:   localBoxConf,
	} {
		if err := (&Box{ID: boxID}).SaveConf(boxConf); nil != err {
			t.Fatalf("save notebook config failed: %s", err)
		}
	}
	Conf.FileTree.DocCreateSaveBox = globalBoxID
	Conf.FileTree.DocCreateSavePath = "/Global/{{now | date \"200601\"}}"

	assertLocation := func(expectedBoxID, expectedPath string) {
		t.Helper()
		boxID, pathTemplate := ResolveDocCreateSaveLocation(currentBoxID)
		if expectedBoxID != boxID || expectedPath != pathTemplate {
			t.Fatalf("unexpected save location: box=%q path=%q", boxID, pathTemplate)
		}
	}
	assertLocation(globalBoxID, Conf.FileTree.DocCreateSavePath)

	currentBoxConf.DocCreateSavePath = "Local/{{now | date \"200601\"}}"
	if err := (&Box{ID: currentBoxID}).SaveConf(currentBoxConf); nil != err {
		t.Fatal(err)
	}
	assertLocation(currentBoxID, currentBoxConf.DocCreateSavePath)

	currentBoxConf.DocCreateSavePath = ""
	currentBoxConf.DocCreateSaveBox = localBoxID
	if err := (&Box{ID: currentBoxID}).SaveConf(currentBoxConf); nil != err {
		t.Fatal(err)
	}
	assertLocation(localBoxID, Conf.FileTree.DocCreateSavePath)

	currentBoxConf.DocCreateSavePath = "/Local"
	if err := (&Box{ID: currentBoxID}).SaveConf(currentBoxConf); nil != err {
		t.Fatal(err)
	}
	assertLocation(localBoxID, currentBoxConf.DocCreateSavePath)

	localBoxConf.Closed = true
	if err := (&Box{ID: localBoxID}).SaveConf(localBoxConf); nil != err {
		t.Fatal(err)
	}
	assertLocation(currentBoxID, currentBoxConf.DocCreateSavePath)
}

func TestNewBoundAttributeViewItemValueUsesDynamicAnchorText(t *testing.T) {
	original := &av.Value{
		Type:       av.KeyTypeBlock,
		IsDetached: true,
		Block:      &av.ValueBlock{Content: "Detached item"},
	}
	docID := ast.NewNodeID()
	bound, err := newBoundAttributeViewItemValue(original, docID, "1f4c4")
	if nil != err {
		t.Fatalf("create bound attribute view item value failed: %s", err)
	}
	if bound.IsDetached || docID != bound.Block.ID || "" != bound.Block.Content || "1f4c4" != bound.Block.Icon ||
		av.BlockRefSubtypeDynamic != bound.Block.RefSubtype {
		t.Fatalf("the bound item should use dynamic anchor text: %+v", bound)
	}
	if !original.IsDetached || "" != original.Block.ID || "Detached item" != original.Block.Content {
		t.Fatalf("the original detached item should remain unchanged: %+v", original)
	}
}

func TestLockAttributeViewItemDocs(t *testing.T) {
	avID := ast.NewNodeID()
	unlock := lockAttributeViewItemDocs(avID)
	started := make(chan struct{})
	acquired := make(chan struct{})
	go func() {
		close(started)
		release := lockAttributeViewItemDocs(avID)
		close(acquired)
		release()
	}()
	<-started
	acquiredWhileLocked := false
	select {
	case <-acquired:
		acquiredWhileLocked = true
	default:
	}
	unlock()
	if acquiredWhileLocked {
		t.Fatal("the same attribute view should not be processed concurrently")
	}
	select {
	case <-acquired:
	case <-time.After(time.Second):
		t.Fatal("the waiting attribute view operation should continue after unlocking")
	}
}

func TestRenderGoTemplateAt(t *testing.T) {
	now := time.Date(2026, time.July, 18, 9, 8, 7, 0, time.Local)
	actual, err := RenderGoTemplateAt(`{{now | date "2006-01-02 15:04:05"}}`, now)
	if nil != err {
		t.Fatalf("render template failed: %s", err)
	}
	if "2026-07-18 09:08:07" != actual {
		t.Fatalf("unexpected rendered value: %q", actual)
	}
}
