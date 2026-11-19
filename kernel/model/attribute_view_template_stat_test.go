// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"fmt"
	"strconv"
	"sync/atomic"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAttributeViewTemplateStatsShareRenderContext(t *testing.T) {
	tree, database, view := setupAttributeViewTemplateStatTest(t)
	rootStat, paragraphStat := filesys.StatBlock(tree.ID), filesys.StatBlock(tree.Root.FirstChild.ID)
	if rootStat == nil || paragraphStat == nil || rootStat.WordCount == paragraphStat.WordCount {
		t.Fatal("expected different document and paragraph statistics")
	}
	var reads atomic.Int32
	acquire := filesys.DEKLockAcquire
	filesys.DEKLockAcquire = func(boxID string) {
		if boxID == tree.Box {
			reads.Add(1)
		}
		acquire(boxID)
	}
	t.Cleanup(func() { filesys.DEKLockAcquire = acquire })
	render := func(context *sql.AttributeViewRenderContext, expected *util.BlockStatResult) {
		t.Helper()
		collection := sql.RenderViewWithDeferredTemplatesContext(database, view, "", false, context).(av.Collection)
		sql.FillAttributeViewTemplateValuesWithContext(database, view, collection, context)
		if collection.CountItems() != 2 {
			t.Fatalf("unexpected row count %d", collection.CountItems())
		}
		for _, item := range collection.GetItems() {
			if got := item.GetValue("source").Template.Content; got != strconv.Itoa(expected.WordCount) {
				t.Fatalf("document word count=%q, want %d", got, expected.WordCount)
			}
			combined := fmt.Sprintf("%d/%d", expected.WordCount, expected.RuneCount)
			if got := item.GetValue("required").Template.Content; got != combined {
				t.Fatalf("repeated statistics=%q, want %q", got, combined)
			}
			if got := item.GetValue("text").RenderedContent; got != strconv.Itoa(paragraphStat.RuneCount) {
				t.Fatalf("paragraph rune count=%q", got)
			}
		}
	}
	context := sql.NewAttributeViewRenderContext()
	render(context, rootStat)
	database.ID = "related-database"
	render(context, rootStat)
	if got := reads.Load(); got != 2 {
		t.Fatalf("shared fields, rows and databases loaded two blocks %d times", got)
	}

	tree.Root.LastChild.FirstChild.Tokens = []byte("another two words")
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	updatedStat := filesys.StatBlock(tree.ID)
	if updatedStat == nil || updatedStat.WordCount == rootStat.WordCount {
		t.Fatal("document edit did not change statistics")
	}
	reads.Store(0)
	updatedContext := sql.NewAttributeViewRenderContext()
	render(updatedContext, updatedStat)
	if got := reads.Load(); got != 2 {
		t.Fatalf("new render loaded two blocks %d times", got)
	}
	reads.Store(0)
	cache.ClearAVCache()
	render(updatedContext, updatedStat)
	if got := reads.Load(); got != 2 {
		t.Fatalf("cleared cache loaded two blocks %d times", got)
	}
	reads.Store(0)
	render(nil, updatedStat)
	if got := reads.Load(); got != 8 {
		t.Fatalf("nil context loaded blocks %d times, want 8", got)
	}
}

func TestAttributeViewTemplateStatsRetryMissingBlocks(t *testing.T) {
	tree, database, view := setupAttributeViewTemplateStatTest(t)
	id := ast.NewNodeID()
	database.KeyValues[2].Key.Template = fmt.Sprintf(
		`.action{if statBlock %q}available.action{else}missing.action{end}`, id)
	context := sql.NewAttributeViewRenderContext()
	render := func(want string) {
		t.Helper()
		collection := sql.RenderViewWithDeferredTemplatesContext(database, view, "", false, context).(av.Collection)
		sql.FillAttributeViewTemplateValuesWithContext(database, view, collection, context)
		for _, item := range collection.GetItems() {
			if got := item.GetValue("source").Template.Content; got != want {
				t.Fatalf("statistic availability=%q, want %q", got, want)
			}
		}
	}
	render("missing")
	node := treenode.NewParagraph(id)
	node.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("new content")})
	tree.Root.AppendChild(node)
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	render("available")
}

func TestAttributeViewTemplateStatsCheckEncryptedReads(t *testing.T) {
	tree, database, view := setupAttributeViewTemplateStatTest(t)
	database.KeyValues[2].Key.Template = fmt.Sprintf(
		`.action{if statBlock %q}available.action{else}unavailable.action{end}`, tree.ID)
	context := sql.NewAttributeViewRenderContext()
	render := func(want string) {
		t.Helper()
		collection := sql.RenderViewWithDeferredTemplatesContext(database, view, "", false, context).(av.Collection)
		sql.FillAttributeViewTemplateValuesWithContext(database, view, collection, context)
		for _, item := range collection.GetItems() {
			if got := item.GetValue("source").Template.Content; got != want {
				t.Fatalf("encrypted statistic availability=%q, want %q", got, want)
			}
		}
	}
	render("available")
	isEncrypted, provider := sql.IsEncryptedBoxFn, filesys.DEKProvider
	sql.IsEncryptedBoxFn = func(boxID string) bool { return boxID == tree.Box || isEncrypted(boxID) }
	filesys.DEKProvider = func(boxID string) ([]byte, error) {
		if boxID == tree.Box {
			return nil, errors.New("test notebook is locked")
		}
		return provider(boxID)
	}
	t.Cleanup(func() { sql.IsEncryptedBoxFn, filesys.DEKProvider = isEncrypted, provider })
	render("unavailable")
}

func setupAttributeViewTemplateStatTest(t *testing.T) (*parse.Tree, *av.AttributeView, *av.View) {
	t.Helper()
	fixture := setupDatabaseBlockTransactionTest(t, false)
	tree := fixture.tree
	tree.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("hello world")})
	node := treenode.NewParagraph(ast.NewNodeID())
	node.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("extra")})
	tree.Root.AppendChild(node)
	if _, err := filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	database, view := newTemplatePlanTestView(2, 0, av.LayoutTypeTable)
	view.Filters = nil
	database.KeyValues[1].Key.RenderTemplate = fmt.Sprintf(`.action{(statBlock %q).RuneCount}`, tree.Root.FirstChild.ID)
	database.KeyValues[2].Key.Template = fmt.Sprintf(`.action{(statBlock %q).WordCount}`, tree.ID)
	database.KeyValues[3].Key.Template = fmt.Sprintf(
		`.action{(statBlock %q).WordCount}/.action{(statBlock %q).RuneCount}`, tree.ID, tree.ID)
	return tree, database, view
}
