// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
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

func TestPrimaryDocumentSourceReuseFollowsWritesAndMoves(t *testing.T) {
	fixture, database, _, _ := setupAttributeViewItemsTest(t, true)
	block := treenode.GetBlockTree(fixture.targetID)
	tree, err := loadTreeByBlockTree(block)
	if err != nil {
		t.Fatal(err)
	}
	value := database.GetBlockKeyValues().Values[1]
	write := func(name, title string) {
		t.Helper()
		paragraph := util.NewLute().BlockDOM2Tree(primaryRichTestDOM(title)).Root.FirstChild
		if err := treenode.SetDocumentTitleParagraph(tree.Root, paragraph); err != nil {
			t.Fatal(err)
		}
		tree.Root.SetIALAttr("icon", "1f600")
		tree.Root.SetIALAttr("name", name)
		previous := cache.TreeDataVersionInBox(tree.ID, tree.Box)
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
		for deadline := time.Now().Add(time.Second); ; time.Sleep(time.Millisecond) {
			if version := cache.TreeDataVersionInBox(tree.ID, tree.Box); version != 0 && version != previous {
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("updated source version was not published")
			}
		}
	}
	write("", `<span data-type="strong">Fresh</span>`)
	if !refreshAttributeViewPrimarySources(database) || value.Block.Content != "Fresh" || value.Block.Rich == nil || value.Block.Icon != "1f600" {
		t.Fatalf("unexpected full source: %+v", value.Block)
	}
	attributeViewDocumentPrimaryCache.Wait()
	root := loadAttributeViewDocumentPrimarySource(block)
	if root == nil || root.FirstChild != nil || root.DocumentTitle == nil {
		t.Fatal("document source was not reused as a summary")
	}
	value.Block.Content, value.Block.Rich = "stale", nil
	if !refreshAttributeViewPrimarySources(database) || value.Block.Content != "Fresh" || value.Block.Rich == nil {
		t.Fatalf("cached source did not refresh a stale entry: %+v", value.Block)
	}
	write("Updated name", `<span data-type="em">New title</span>`)
	if !refreshAttributeViewPrimarySources(database) || value.Block.Content != "Updated name" || value.Block.Rich != nil {
		t.Fatalf("write did not invalidate the summary: %+v", value.Block)
	}
	attributeViewDocumentPrimaryCache.Wait()
	path := filepath.Join(util.DataDir, block.BoxID, block.Path)
	if err := os.Rename(path, path+".moved"); err != nil {
		t.Fatal(err)
	}
	if root := loadAttributeViewDocumentPrimarySource(block); root != nil {
		t.Fatal("summary was reused after the source path moved")
	}
}
