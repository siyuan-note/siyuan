// SiYuan - Refactor your thinking
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
	if bound.IsDetached || docID != bound.Block.ID || "" != bound.Block.Content || "1f4c4" != bound.Block.Icon {
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
