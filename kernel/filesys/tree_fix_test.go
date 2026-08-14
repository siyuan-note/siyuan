// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package filesys

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestLoadTreeWithFixRepairsInvalidListChildren(t *testing.T) {
	originalDataDir := util.DataDir
	util.DataDir = t.TempDir()
	defer func() {
		cache.ClearTreeCache()
		util.DataDir = originalDataDir
	}()

	boxID := "20260814000000-box0001"
	rootID := "20260814000000-root001"
	treePath := "/" + rootID + ".sy"
	luteEngine := util.NewLute()
	tree := treenode.NewTree(boxID, treePath, "/Test", "Test")
	paragraph := tree.Root.FirstChild
	paragraph.Unlink()
	list := &ast.Node{Type: ast.NodeList, ID: "20260814000000-list001", ListData: &ast.ListData{Typ: 1}}
	list.SetIALAttr("id", list.ID)
	list.AppendChild(paragraph)
	tree.Root.AppendChild(list)

	data := render.NewJSONRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions).Render()
	absPath := filepath.Join(util.DataDir, boxID, treePath)
	if err := os.MkdirAll(filepath.Dir(absPath), 0755); nil != err {
		t.Fatal(err)
	}
	if err := os.WriteFile(absPath, data, 0600); nil != err {
		t.Fatal(err)
	}

	loaded, needFix, err := LoadTreeWithFix(boxID, treePath, luteEngine)
	if nil != err {
		t.Fatal(err)
	}
	if !needFix {
		t.Fatal("expected invalid list structure to be fixed")
	}
	requireFixedListChild(t, loaded.Root.FirstChild, paragraph.ID)

	cache.RemoveTreeDataInBox(rootID, boxID)
	reloaded, needFix, err := LoadTreeWithFix(boxID, treePath, luteEngine)
	if nil != err {
		t.Fatal(err)
	}
	if needFix {
		t.Fatal("expected repaired list structure to persist")
	}
	requireFixedListChild(t, reloaded.Root.FirstChild, paragraph.ID)
}

func requireFixedListChild(t *testing.T, list *ast.Node, paragraphID string) {
	t.Helper()
	if nil == list || ast.NodeList != list.Type || nil == list.FirstChild || ast.NodeListItem != list.FirstChild.Type {
		t.Fatal("expected a list item wrapper")
	}
	if nil == list.FirstChild.FirstChild || paragraphID != list.FirstChild.FirstChild.ID {
		t.Fatal("expected the original content block inside the list item")
	}
}
