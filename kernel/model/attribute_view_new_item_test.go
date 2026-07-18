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
