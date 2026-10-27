//go:build fts5

package model

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func documentTitleTestProcess(t *testing.T) bool {
	t.Helper()
	const helper = "SIYUAN_TEST_DOCUMENT_TITLE"
	if os.Getenv(helper) == t.Name() {
		return true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, os.Args[0], "-test.run=^"+t.Name()+"$", "-test.v")
	command.Env = append(os.Environ(), helper+"="+t.Name())
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("document title subprocess: %v\n%s", err, output)
	}
	return false
}

func TestDocumentTitleTransactionPersistenceUndoAndConflict(t *testing.T) {
	if !documentTitleTestProcess(t) {
		return
	}
	prepareHPathRefreshTest(t)
	box := &Box{ID: ast.NewNodeID()}
	boxConf := conf.NewBoxConf()
	boxConf.Closed = false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	testDocumentTitleTransactionPersistence(t, box.ID)
}

func TestDocumentTitleQueuedIndexUsesCurrentSource(t *testing.T) {
	if !documentTitleTestProcess(t) {
		return
	}
	prepareHPathRefreshTest(t)
	box := &Box{ID: ast.NewNodeID()}
	boxConf := conf.NewBoxConf()
	boxConf.Closed = false
	if err := box.SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	first := newHPathTestDoc(t, box.ID, "/", "Same", 1)
	second := newHPathTestDoc(t, box.ID, "/", "Same", 1)
	tree := newHPathTestDoc(t, box.ID, "/", "Same", 1)
	setTitle := func(target string) {
		t.Helper()
		paragraph := &ast.Node{Type: ast.NodeParagraph}
		paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "strong block-ref",
			TextMarkTextContent: "Same", TextMarkBlockRefID: target, TextMarkBlockRefSubtype: "s"})
		if err := treenode.SetDocumentTitleParagraph(tree.Root, paragraph); err != nil {
			t.Fatal(err)
		}
		if err := writeTreeUpsertQueue(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
		sql.FlushQueue()
	}
	for _, source := range []*parse.Tree{first, second} {
		if err := writeTreeUpsertQueue(source); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(source)
	}
	sql.FlushQueue()
	setTitle(first.ID)
	stale, _, err := filesys.LoadTreeSnapshot(box.ID, tree.Path, util.NewLute())
	if err != nil {
		t.Fatal(err)
	}
	staleSource := stale.Root.DocumentTitle.Content
	setTitle(second.ID)
	sql.UpsertTreeQueue(stale)
	sql.FlushQueue()
	if len(sql.QueryRefsByDefIDInBox(first.ID, false, box.ID)) != 0 || len(sql.QueryRefsByDefIDInBox(second.ID, false, box.ID)) != 1 {
		t.Fatal("queued body snapshot overwrote current same-text title source references")
	}
	if stale.Root.DocumentTitle.Content != staleSource {
		t.Fatal("index refresh mutated a source snapshot")
	}
	current, err := filesys.LoadTree(box.ID, tree.Path, util.NewLute())
	if err != nil || current.Root.DocumentTitle.Content != tree.Root.DocumentTitle.Content {
		t.Fatal("queued index changed the persisted source")
	}
}

func testDocumentTitleTransactionPersistence(t *testing.T, boxID string) {
	tree := newHPathTestDoc(t, boxID, "/", "**literal**", 1)
	definition := newHPathTestDoc(t, boxID, "/", "Definition", 1)
	save := func(tree *parse.Tree) {
		t.Helper()
		if err := writeTreeUpsertQueue(tree); err != nil {
			t.Fatal(err)
		}
		treenode.UpsertBlockTree(tree)
		sql.FlushQueue()
	}
	save(tree)
	save(definition)
	read := func() *parse.Tree {
		t.Helper()
		current, err := filesys.LoadTree(boxID, tree.Path, util.NewLute())
		if err != nil {
			t.Fatal(err)
		}
		return current
	}
	initial, err := GetDocTitle(tree.ID, boxID)
	if err != nil || initial.Source != nil || !strings.Contains(initial.BlockDOM, "**literal**") {
		t.Fatalf("legacy read reinterpreted source: %v", err)
	}
	paragraph := &ast.Node{Type: ast.NodeParagraph}
	paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "strong", TextMarkTextContent: "Title/"})
	for _, subtype := range []string{"s", "d"} {
		paragraph.AppendChild(&ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: definition.ID,
			TextMarkBlockRefSubtype: subtype, TextMarkTextContent: "Definition"})
	}
	source, err := render.NewDocumentTitle(paragraph)
	if err != nil {
		t.Fatal(err)
	}
	op := &Operation{Action: "setDocTitle", ID: tree.ID, Data: map[string]any{"source": source, "expectedRevision": initial.Revision}}
	tx := &Transaction{DoOperations: []*Operation{op}}
	tx.MarkFromAPI()
	if err = PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	sql.FlushQueue()
	current := read()
	if current.Root.DocumentTitle == nil || current.Root.Spec != "7" || current.Root.FirstChild.ID != tree.Root.FirstChild.ID ||
		op.RetData != treenode.DocumentTitleRevision(current.Root) {
		t.Fatal("title transaction lost source, body or version")
	}
	refs := sql.QueryRefsByDefIDInBox(definition.ID, false, boxID)
	if len(refs) != 1 || refs[0].BlockID != tree.ID || refs[0].RootID != tree.ID {
		t.Fatalf("title references have incorrect ownership or duplicate count: %+v", refs)
	}
	if err = RenameDoc(boxID, tree.Path, "flattened"); err == nil {
		t.Fatal("legacy rename overwrote rich source")
	}
	if _, err = setNodeAttrs0(current.Root, map[string]string{"title": "flattened"}, boxID); err == nil {
		t.Fatal("attribute write overwrote rich source")
	}
	if err = RenameDoc(boxID, tree.Path, treenode.ReadDocumentTitle(current.Root).Text); err != nil {
		t.Fatal(err)
	}
	if err = PerformTxSync(&Transaction{DoOperations: []*Operation{{Action: "setDocTitle", ID: tree.ID, Data: op.Data}}}); err == nil {
		t.Fatal("stale expected revision accepted")
	}
	current = read()
	body := treenode.NewParagraph("")
	body.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Body edited after title")})
	current.Root.AppendChild(body)
	save(current)
	replay := func(operations []*Operation) {
		t.Helper()
		replay := &Transaction{DoOperations: cloneOperations(operations)}
		replay.MarkReplay()
		if err := PerformTxSync(replay); err != nil {
			t.Fatal(err)
		}
		sql.FlushQueue()
	}
	replay(tx.UndoOperations)
	current = read()
	if current.Root.DocumentTitle != nil || current.Root.IALAttr("title") != "**literal**" || treenode.GetNodeInTree(current, body.ID) == nil {
		t.Fatal("title undo changed later body content or failed to restore plain source")
	}
	if refs = sql.QueryRefsByDefIDInBox(definition.ID, false, boxID); len(refs) != 0 {
		t.Fatal("undo left stale title refs")
	}
	replay(tx.DoOperations)
	current = read()
	if current.Root.DocumentTitle == nil || treenode.GetNodeInTree(current, body.ID) == nil {
		t.Fatal("redo lost source or body")
	}
	if refs = sql.QueryRefsByDefIDInBox(definition.ID, false, boxID); len(refs) != 1 {
		t.Fatal("redo did not restore title refs")
	}
	data, err := GetDocTitle(tree.ID, boxID)
	if err != nil {
		t.Fatal(err)
	}
	invalid := &Operation{Action: "setDocTitle", ID: tree.ID, Data: map[string]any{"expectedRevision": data.Revision,
		"blockDOM": `<div data-type="NodeParagraph"><div contenteditable="true">One</div></div><div data-type="NodeParagraph"><div contenteditable="true">Two</div></div>`}}
	if err = PerformTxSync(&Transaction{DoOperations: []*Operation{invalid}}); err == nil {
		t.Fatal("multi-block title accepted")
	}
	if treenode.DocumentTitleRevision(read().Root) != data.Revision {
		t.Fatal("rejected title changed source")
	}
}
