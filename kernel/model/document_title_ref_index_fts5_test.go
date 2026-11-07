// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	gosql "database/sql"
	"os"
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func drainDocumentTitleIndexTasks(t *testing.T) {
	t.Helper()
	for count := 0; count < 128; count++ {
		if !task.ContainIndexTask() {
			return
		}
		task.ExecTaskJob()
	}
	t.Fatal("document lifecycle index tasks did not finish")
}

func TestDocumentTitleDeferredIndexPropagation(t *testing.T) {
	if !documentTitleTestProcess(t) {
		return
	}
	boxID := prepareDocumentTitleFeatureBox(t)
	testDocumentTitleDeferredIndexPropagation(t, boxID)
}

func testDocumentTitleDeferredIndexPropagation(t *testing.T, boxID string) {
	load := func(t *testing.T, tree *parse.Tree) *parse.Tree {
		t.Helper()
		current, err := filesys.LoadTree(tree.Box, tree.Path, util.NewLute())
		if err != nil {
			t.Fatal(err)
		}
		return current
	}
	setTitle := func(t *testing.T, tree *parse.Tree, text, target string) string {
		t.Helper()
		root := testDynamicTitle(t, tree.ID, text, target)
		paragraph, err := treenode.DocumentTitleParagraph(root)
		if err != nil {
			t.Fatal(err)
		}
		source, err := render.NewDocumentTitle(paragraph)
		if err != nil {
			t.Fatal(err)
		}
		tx := &Transaction{DoOperations: []*Operation{{Action: "setDocTitle", ID: tree.ID,
			Data: map[string]any{"source": source, "expectedRevision": treenode.DocumentTitleRevision(load(t, tree).Root)}}}}
		if err = PerformTxSync(tx); err != nil {
			t.Fatal(err)
		}
		return treenode.DocumentTitleRevision(load(t, tree).Root)
	}
	updateBody := func(t *testing.T, tree *parse.Tree, text string) {
		t.Helper()
		id := tree.Root.FirstChild.ID
		tx := &Transaction{DoOperations: []*Operation{{Action: "update", ID: id,
			Data: `<div data-node-id="` + id + `" data-type="NodeParagraph"><div contenteditable="true">` + text + `</div></div>`}}}
		if err := PerformTxSync(tx); err != nil {
			t.Fatal(err)
		}
	}
	drain := func(t *testing.T) {
		// 隔离进程没有索引定时器，直到全部编辑提交后才执行正常后台队列。
		for round := 0; round < 3; round++ {
			drainDocumentTitleIndexTasks(t)
			sql.FlushQueue()
			FlushUpdateRefTextRenameDocJob()
		}
		sql.FlushQueue()
	}
	checkTitle := func(t *testing.T, tree *parse.Tree, text, revision string) {
		t.Helper()
		current := load(t, tree)
		if got := treenode.ReadDocumentTitle(current.Root).Text; got != text {
			t.Errorf("title did not converge after indexing: got %q, want %q", got, text)
		}
		if got := treenode.DocumentTitleRevision(current.Root); got != revision {
			t.Errorf("derived refresh changed source revision: got %q, want %q", got, revision)
		}
		if IsEncryptedBox(tree.Box) {
			raw, err := os.ReadFile(filepath.Join(util.DataDir, tree.Box, tree.Path))
			if err != nil || !util.IsCiphertext(raw) || sql.GetBlock(tree.ID) != nil {
				t.Fatalf("deferred refresh escaped the encrypted boundary: %v", err)
			}
		}
	}
	t.Run("chain and static anchors", func(t *testing.T) {
		base := newHPathTestDoc(t, boxID, "/", "Before", 1)
		middle := newHPathTestDoc(t, boxID, "/", "Middle", 1)
		watcher := newHPathTestDoc(t, boxID, "/", "Watcher", 1)
		for _, subtype := range []string{"d", "s"} {
			watcher.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref",
				TextMarkBlockRefID: middle.ID, TextMarkBlockRefSubtype: subtype, TextMarkTextContent: "Original anchor"})
		}
		if err := indexWriteTreeUpsertQueue(watcher); err != nil {
			t.Fatal(err)
		}
		sql.FlushQueue()
		middleRevision := setTitle(t, middle, "Middle ", base.ID)
		updateBody(t, middle, "Committed body")
		setTitle(t, base, "After", "")
		drain(t)
		if refs := sql.QueryRefsByDefIDInBox(base.ID, false, boxID); len(refs) != 1 || refs[0].BlockID != middle.ID {
			t.Fatalf("committed title dependency was not indexed: %+v", refs)
		}
		checkTitle(t, middle, "Middle After", middleRevision)
		current := load(t, middle)
		if current.Root.FirstChild.FirstChild.TokensStr() != "Committed body" {
			t.Error("derived refresh replaced the committed body")
		}
		current = load(t, watcher)
		anchors := 0
		for node := current.Root.FirstChild.FirstChild; node != nil; node = node.Next {
			anchors++
			_, text, subtype := treenode.GetBlockRef(node)
			want := "Original anchor"
			if subtype == "d" {
				want = "Middle After"
			}
			if text != want {
				t.Errorf("%s anchor: got %q, want %q", subtype, text, want)
			}
		}
		if anchors != 2 {
			t.Fatalf("body reference sources changed: %d", anchors)
		}
	})
	t.Run("two node cycle", func(t *testing.T) {
		left := newHPathTestDoc(t, boxID, "/", "Left before", 1)
		right := newHPathTestDoc(t, boxID, "/", "Right before", 1)
		sql.FlushQueue()
		leftRevision := setTitle(t, left, "A ", right.ID)
		updateBody(t, left, "Left body")
		rightRevision := setTitle(t, right, "B ", left.ID)
		updateBody(t, right, "Right body")
		for round := 0; round < 3; round++ {
			drain(t)
			checkTitle(t, left, "A B", leftRevision)
			checkTitle(t, right, "B A", rightRevision)
			for tree, body := range map[*parse.Tree]string{left: "Left body", right: "Right body"} {
				current := load(t, tree)
				paragraph := treenode.GetNodeInTree(current, tree.Root.FirstChild.ID)
				if paragraph == nil || paragraph.FirstChild == nil || paragraph.FirstChild.TokensStr() != body ||
					paragraph.ID != paragraph.IALAttr("id") || current.Root.ID != tree.ID {
					t.Fatal("cycle refresh changed body content or persisted identities")
				}
			}
		}
	})
	t.Run("failed index flush retains deferred definitions", func(t *testing.T) {
		base := newHPathTestDoc(t, boxID, "/", "Before", 1)
		ref := newHPathTestDoc(t, boxID, "/", "Reference", 1)
		sql.FlushQueue()
		database := sql.GetEncryptedDB(boxID)
		if database == nil {
			var err error
			database, err = gosql.Open("sqlite3_extended", util.DBPath)
			if err != nil {
				t.Fatal(err)
			}
			defer database.Close()
		}
		if _, err := database.Exec("CREATE TRIGGER fail_deferred_title_refs BEFORE INSERT ON refs BEGIN SELECT RAISE(ABORT, 'injected title index failure'); END"); err != nil {
			t.Fatal(err)
		}
		defer database.Exec("DROP TRIGGER IF EXISTS fail_deferred_title_refs")
		revision := setTitle(t, ref, "Ref ", base.ID)
		setTitle(t, base, "After", "")
		file := filepath.Join(util.DataDir, boxID, ref.Path)
		before, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		// 覆盖外层索引等待结束后、新编辑先于后台取得编辑锁入队的窗口。
		flushUpdateRefTextRenameDoc()
		for _, tree := range []*parse.Tree{base, ref} {
			if _, pending := updateRefTextRenameDocs[dynamicRefTextRetryKey{boxID, tree.ID}]; !pending {
				t.Fatal("failed indexing discarded a deferred definition")
			}
		}
		if sql.IndexQueueIdle() {
			t.Fatal("failed index operation was not retained")
		}
		if after, err := os.ReadFile(file); err != nil || !bytes.Equal(before, after) {
			t.Fatalf("failed indexing published a partial title refresh: %v", err)
		}
		if _, err = database.Exec("DROP TRIGGER fail_deferred_title_refs"); err != nil {
			t.Fatal(err)
		}
		drain(t)
		checkTitle(t, ref, "Ref After", revision)
		if len(updateRefTextRenameDocs) != 0 || !sql.IndexQueueIdle() {
			t.Fatal("successful index recovery did not finish deferred refresh")
		}
	})
	t.Run("latest source and retained unreadable definition", func(t *testing.T) {
		base := newHPathTestDoc(t, boxID, "/", "Before", 1)
		ref := newHPathTestDoc(t, boxID, "/", "Reference", 1)
		sql.FlushQueue()
		revision := setTitle(t, ref, "Ref ", base.ID)
		setTitle(t, base, "After", "")
		updateBody(t, base, "Current body")
		file := filepath.Join(util.DataDir, base.Box, base.Path)
		before, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		// 调用方可能保留旧树，队列不能让其正文或标题覆盖随后保存的源。
		updateRefTextRenameDoc(base)
		drain(t)
		checkTitle(t, ref, "Ref After", revision)
		if after, err := os.ReadFile(file); err != nil || !bytes.Equal(before, after) {
			t.Fatalf("deferred refresh changed the current definition source: %v", err)
		}
		updateRefTextRenameDoc(base)
		if err = os.Rename(file, file+".paused"); err != nil {
			t.Fatal(err)
		}
		defer os.Rename(file+".paused", file)
		flushUpdateRefTextRenameDoc()
		key := dynamicRefTextRetryKey{base.Box, base.ID}
		if _, pending := updateRefTextRenameDocs[key]; !pending {
			t.Fatal("unreadable definition was dropped from the deferred queue")
		}
		if err = os.Rename(file+".paused", file); err != nil {
			t.Fatal(err)
		}
		drain(t)
		updateRefTextRenameDoc(&parse.Tree{Box: boxID, ID: ast.NewNodeID()})
		drain(t)
		if len(updateRefTextRenameDocs) != 0 {
			t.Fatalf("completed or deleted definitions remained queued: %+v", updateRefTextRenameDocs)
		}
	})
	t.Run("rename move and deletion use current identity", func(t *testing.T) {
		base := newHPathTestDoc(t, boxID, "/", "Before", 1)
		ref := newHPathTestDoc(t, boxID, "/", "Reference", 1)
		parent := newHPathTestDoc(t, boxID, "/", "Parent", 1)
		sql.FlushQueue()
		revision := setTitle(t, ref, "Ref ", base.ID)
		if err := RenameDoc(boxID, base.Path, "Renamed"); err != nil {
			t.Fatal(err)
		}
		if err := MoveDocs([]string{boxID + base.Path}, boxID, parent.Path, nil); err != nil {
			t.Fatal(err)
		}
		updateRefTextRenameDoc(base)
		drain(t)
		checkTitle(t, ref, "Ref Renamed", revision)
		moved := treenode.GetBlockTreeInExactBox(base.ID, boxID)
		if moved == nil || moved.Path == base.Path {
			t.Fatal("definition did not retain its identity after moving")
		}
		if _, err := os.Stat(filepath.Join(util.DataDir, boxID, base.Path)); !os.IsNotExist(err) {
			t.Fatalf("deferred refresh recreated the definition's old path: %v", err)
		}
		updateRefTextRenameDoc(base)
		if err := RemoveDoc(boxID, moved.Path); err != nil {
			t.Fatal(err)
		}
		drain(t)
		if len(updateRefTextRenameDocs) != 0 || treenode.GetBlockTreeInExactBox(base.ID, boxID) != nil {
			t.Fatal("deleted definition remained pending or was recreated")
		}
	})
}
