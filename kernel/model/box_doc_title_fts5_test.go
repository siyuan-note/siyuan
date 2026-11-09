// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestNotebookDocumentRichTitle(t *testing.T) {
	if !documentTitleTestProcess(t) {
		return
	}
	testNotebookDocumentRichTitle(t, prepareDocumentTitleFeatureBox(t))
}

func testNotebookDocumentRichTitle(t *testing.T, boxID string) {
	t.Helper()
	box := Conf.Box(boxID)
	if !box.Exist(boxDocPath(boxID)) {
		if err := createBoxDoc(box, boxID); err != nil {
			t.Fatal(err)
		}
	}
	definition := newHPathTestDoc(t, boxID, "/", "Definition", 1)
	_, childBefore, err := filesys.LoadTreeSnapshot(boxID, definition.Path, util.NewLute())
	if err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	read := func() *DocumentTitleData {
		t.Helper()
		value, err := GetDocTitle(boxID, boxID)
		if err != nil {
			t.Fatal(err)
		}
		return value
	}
	writeDOM := func(dom string) *Transaction {
		t.Helper()
		current := read()
		tx := &Transaction{DoOperations: []*Operation{{Action: "setDocTitle", ID: boxID,
			Data: map[string]any{"blockDOM": dom,
				"expectedRevision": current.Revision}}}}
		if err := PerformTxSync(tx); err != nil {
			t.Fatal(err)
		}
		sql.FlushQueue()
		return tx
	}
	write := func(html string) *Transaction {
		t.Helper()
		return writeDOM(`<div data-type="NodeParagraph"><div contenteditable="true">` + html + `</div></div>`)
	}
	initial := read()
	if initial.Format != "plain" || initial.Source != nil || initial.Text != box.Name {
		t.Fatalf("legacy notebook title changed: %+v", initial)
	}
	beforeTree, _, err := filesys.LoadTreeSnapshot(boxID, boxDocPath(boxID), util.NewLute())
	if err != nil {
		t.Fatal(err)
	}
	bodyID := beforeTree.Root.FirstChild.ID
	tx := writeDOM(util.NewLute().Md2BlockDOM(fmt.Sprintf("**Work/** `Code` ((%s 'Definition')) ![Picture](assets/p.png)", definition.ID), false))
	rich := read()
	if rich.Format != "inline-ast" || rich.Source == nil || box.GetConf().Name != rich.Text || Conf.Box(boxID).Name != rich.Text {
		t.Fatalf("notebook name and rich title diverged: %+v, %q", rich, box.GetConf().Name)
	}
	if !strings.Contains(rich.BlockDOM, "assets/p.png") || !strings.Contains(rich.Text, "Picture") {
		t.Fatal("notebook title lost its image or alternative text")
	}
	staleConf := box.GetConf()
	staleConf.Name = initial.Text
	staleConf.SortMode = 7
	if err := box.SaveConfAndSync(staleConf); err != nil || box.GetConf().Name != rich.Text || box.GetConf().SortMode != 7 {
		t.Fatalf("saving another setting overwrote the notebook title projection: %v", err)
	}
	if refs := sql.QueryRefsByDefIDInBox(definition.ID, false, boxID); len(refs) != 1 || refs[0].BlockID != boxID {
		t.Fatalf("notebook title backlink is not owned by the notebook document: %+v", refs)
	}
	currentTree, raw, err := filesys.LoadTreeSnapshot(boxID, boxDocPath(boxID), util.NewLute())
	if err != nil || currentTree.Root.IALAttr(boxDocTitleSourceAttr) != "document" || currentTree.Root.Spec != "7" ||
		treenode.GetNodeInTree(currentTree, bodyID) == nil {
		t.Fatalf("title source, version or body lost: %v", err)
	}
	if IsEncryptedBox(boxID) && !util.IsCiphertext(raw) {
		t.Fatal("encrypted notebook title was persisted as plaintext")
	}
	if err := RenameBox(boxID, "Overwrite"); !errors.Is(err, treenode.ErrRichDocumentTitleWrite) {
		t.Fatalf("plain rename did not protect rich notebook title: %v", err)
	}
	if err := RenameBox(boxID, rich.Text); err != nil || read().Revision != rich.Revision {
		t.Fatalf("echoed summary did not remain a no-op: %v", err)
	}
	stale := &Transaction{DoOperations: []*Operation{{Action: "setDocTitle", ID: boxID,
		Data: map[string]any{"source": initial.Source, "expectedRevision": initial.Revision}}}}
	if err := PerformTxSync(stale); !errors.Is(err, ErrDocumentTitleConflict) {
		t.Fatalf("stale notebook title was accepted: %v", err)
	}
	if read().Revision != rich.Revision || box.GetConf().Name != rich.Text {
		t.Fatal("rejected writes changed the title or notebook name")
	}
	rejected := &Transaction{DoOperations: []*Operation{{Action: "setDocTitle", ID: boxID,
		Data: map[string]any{"source": titleWriteTestSource(t, "Rejected title"), "expectedRevision": rich.Revision}}}}
	writeFailure := errors.New("injected failure after notebook name projection")
	rejected.writeTransactionTree = func(tree *parse.Tree) error {
		if err := rejected.writeDocumentTitleTree(tree, nil); err != nil {
			return err
		}
		if box.GetConf().Name != "Rejected title" {
			t.Fatal("test did not reach the notebook configuration write")
		}
		return writeFailure
	}
	if err := PerformTxSync(rejected); !errors.Is(err, writeFailure) || read().Revision != rich.Revision || box.GetConf().Name != rich.Text {
		t.Fatalf("failed save did not restore notebook title and name: %v", err)
	}
	conf := box.GetConf()
	conf.Name = "Stale projection"
	if err := box.SaveConf(conf); err != nil {
		t.Fatal(err)
	}
	if err := reconcileBoxDoc(box, boxID); err != nil || read().Revision != rich.Revision || box.GetConf().Name != rich.Text {
		t.Fatalf("reopening did not preserve the rich source: %v", err)
	}
	replay := &Transaction{DoOperations: cloneOperations(tx.UndoOperations)}
	replay.MarkReplay()
	if err := PerformTxSync(replay); err != nil {
		t.Fatal(err)
	}
	if value := read(); value.Source != nil || box.GetConf().Name != initial.Text {
		t.Fatalf("undo did not restore notebook name: %+v", value)
	}
	replay = &Transaction{DoOperations: cloneOperations(tx.DoOperations)}
	replay.MarkReplay()
	if err := PerformTxSync(replay); err != nil || read().Revision != rich.Revision || box.GetConf().Name != rich.Text {
		t.Fatalf("redo did not restore notebook title: %v", err)
	}
	_, childAfter, err := filesys.LoadTreeSnapshot(boxID, definition.Path, util.NewLute())
	if err != nil || !bytes.Equal(childBefore, childAfter) {
		t.Fatalf("notebook title editing rewrote a root child: %v", err)
	}
	definition.Root.SetIALAttr("title", "Updated definition")
	if err := indexWriteTreeUpsertQueue(definition); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	if _, failed := refreshDynamicRefTextsWithWriter(map[string]*ast.Node{definition.ID: definition.Root},
		map[string]*parse.Tree{definition.ID: definition}, writeDynamicRefTree); failed {
		t.Fatal("notebook title dynamic reference did not refresh")
	}
	if value := read(); !strings.Contains(value.Text, "Updated definition") || value.Revision != rich.Revision || box.GetConf().Name != value.Text {
		t.Fatalf("dynamic reference changed the source revision or lost notebook name: %+v", value)
	}
	write("Plain/Notebook")
	conf = box.GetConf()
	conf.Name = "Stale after plain conversion"
	if err := box.SaveConf(conf); err != nil {
		t.Fatal(err)
	}
	if err := reconcileBoxDoc(box, boxID); err != nil || read().Text != "Plain/Notebook" || box.GetConf().Name != "Plain/Notebook" {
		t.Fatalf("plain conversion lost the title authority: %v", err)
	}
	if err := RenameBox(boxID, "Renamed/Notebook"); err != nil || read().Text != "Renamed/Notebook" {
		t.Fatalf("legacy plain notebook rename failed: %v", err)
	}
	writeDOM(util.NewLute().Md2BlockDOM("![](assets/p.png)", false))
	if value := read(); value.Source == nil || value.Text != "" || box.GetConf().Name != Conf.Language(16) {
		t.Fatalf("image-only title lost its source or notebook placeholder: %+v", value)
	}
	if err := RenameBox(boxID, box.GetConf().Name); err != nil {
		t.Fatalf("echoed image-only title placeholder was rejected: %v", err)
	}
	write("")
	if value := read(); !value.Empty || value.Source != nil || box.GetConf().Name != Conf.Language(16) {
		t.Fatalf("empty notebook title lost its placeholder or body: %+v", value)
	}
	if err := reconcileBoxDoc(box, boxID); err != nil || !read().Empty {
		t.Fatalf("empty notebook title was changed by reconciliation: %v", err)
	}
}
