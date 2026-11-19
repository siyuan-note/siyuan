// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestPrimaryRichReadRefreshesSharedDocumentWithinExactBoundary(t *testing.T) {
	fixture, database, _, _ := setupAttributeViewItemsTest(t, false)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	for i, html := range []string{`<span data-type="strong">First</span>`, `<span data-type="em">Second</span>`} {
		node := util.NewLute().BlockDOM2Tree(primaryRichTestDOM(html)).Root.FirstChild
		node.ID = ast.NewNodeID()
		node.SetIALAttr("id", node.ID)
		tree.Root.AppendChild(node)
		value := database.GetBlockKeyValues().Values[i]
		value.IsDetached, value.Block.ID, value.Block.RefSubtype = false, node.ID, av.BlockRefSubtypeDynamic
		value.Block.Content = node.Text()
	}
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	wrongValue := database.GetBlockKeyValues().Values[0].Clone()
	wrongValue.Block.Content = "unresolved"
	wrong := &av.AttributeView{ID: database.ID, KeyValues: []*av.KeyValues{{Key: database.GetBlockKey(), Values: []*av.Value{wrongValue}}}}
	if err = wrong.SetStorageContext(ast.NewNodeID()); err != nil {
		t.Fatal(err)
	}
	if refreshAttributeViewPrimarySources(wrong) || wrongValue.Block.Rich != nil || wrongValue.Block.Content != "unresolved" {
		t.Fatal("an exact database boundary read a source from another notebook")
	}
	if !normalizeAttributeViewBlockRefSubtypes(database) || database.Spec != av.PrimaryRichSpec {
		t.Fatal("source refresh did not retain the rich format version")
	}
	for _, value := range database.GetBlockKeyValues().Values[:2] {
		if value.Block.Rich == nil || value.Block.RichBlockDOM == "" {
			t.Fatal("a source in the shared document was omitted")
		}
	}
}
