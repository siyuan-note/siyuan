//go:build fts5

package model

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTableCellRichUpgradeUndoRedo(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	originalLog := GlobalUndoLog
	GlobalUndoLog = newUndoLog(128)
	t.Cleanup(func() { GlobalUndoLog = originalLog })
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	luteEngine := util.NewLute()
	tableID := ast.NewNodeID()
	makeTable := func(text string, rich bool) *parse.Tree {
		result := parse.Parse("", []byte("| Header |\n| --- |\n| "+text+" |"), luteEngine.ParseOptions)
		table := result.Root.FirstChild
		table.ID = tableID
		table.SetIALAttr("id", tableID)
		if rich {
			table.LastChild.FirstChild.TableCellRich = &ast.TableCellRich{Spec: 1, Format: "kramdown", Content: "first\n\nsecond"}
			if err := treenode.RefreshTableCellRichProjection(result.Root); err != nil {
				t.Fatal(err)
			}
		}
		return result
	}
	dom := func(table *parse.Tree) string {
		return luteEngine.Tree2BlockDOM(table, luteEngine.RenderOptions, luteEngine.ParseOptions)
	}
	initial := makeTable("initial", false)
	plain := makeTable("edited", false)
	rich := makeTable("rich", true)
	tree.Root.AppendChild(initial.Root.FirstChild)
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	previous := dom(makeTable("initial", false))
	for _, updated := range []*parse.Tree{plain, rich} {
		next := dom(updated)
		tx := &Transaction{fromAPI: true,
			DoOperations:   []*Operation{{Action: "update", ID: tableID, Data: next}},
			UndoOperations: []*Operation{{Action: "update", ID: tableID, Data: previous}}}
		if err = PerformTxSync(tx); err != nil {
			t.Fatal(err)
		}
		previous = next
	}
	assertTable := func(text string, hasRich bool) {
		t.Helper()
		restored, err := LoadTreeByBlockID(tableID)
		if err != nil {
			t.Fatal(err)
		}
		table := treenode.GetNodeInTree(restored, tableID)
		cell := table.LastChild.FirstChild
		if (cell.TableCellRich != nil) != hasRich || !strings.Contains(cell.Text(), text) ||
			table.IALAttr(treenode.TableCellRichTableAttribute) != "1" {
			t.Fatalf("unexpected restored table: %s, %#v", cell.Text(), cell.TableCellRich)
		}
	}
	for range 2 {
		for _, text := range []string{"edited", "initial"} {
			entry := GlobalUndoLog.Undo(fixture.sourceID)
			if entry == nil {
				t.Fatal("missing undo entry")
			}
			tx := &Transaction{isReplay: true, DoOperations: entry.UndoOperationsForReplay()}
			if err = PerformTxSync(tx); err != nil {
				t.Fatalf("undo %s: %s", text, err)
			}
			GlobalUndoLog.UndoCommit(entry, fixture.sourceID)
			assertTable(text, false)
			if !strings.Contains(tx.DoOperations[0].Data.(string), treenode.TableCellRichTableAttribute+`="1"`) {
				t.Fatal("replayed DOM omitted table format metadata")
			}
		}
		for index, text := range []string{"edited", "first"} {
			entry := GlobalUndoLog.Redo(fixture.sourceID)
			if entry == nil {
				t.Fatal("missing redo entry")
			}
			if err = PerformTxSync(&Transaction{isReplay: true, DoOperations: entry.DoOperationsForReplay()}); err != nil {
				t.Fatalf("redo %s: %s", text, err)
			}
			GlobalUndoLog.RedoCommit(entry, fixture.sourceID)
			assertTable(text, index == 1)
		}
	}
	for _, replay := range []bool{false, true} {
		updated := makeTable("invalid", false)
		if replay {
			updated.Root.FirstChild.SetIALAttr(treenode.TableCellRichTableAttribute, "2")
		}
		if err = PerformTxSync(&Transaction{isReplay: replay,
			DoOperations: []*Operation{{Action: "update", ID: tableID, Data: dom(updated)}}}); err == nil {
			t.Fatalf("accepted missing or unknown format metadata, replay=%v", replay)
		}
		assertTable("first", true)
	}
}

func TestTableCellRichCodeSettingsTransactions(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	luteEngine := util.NewLute()
	tableTree := parse.Parse("", []byte("| Header |\n| --- |\n| code |"), luteEngine.ParseOptions)
	table := tableTree.Root.FirstChild
	table.ID = ast.NewNodeID()
	table.SetIALAttr("id", table.ID)
	const plain = "```go\na | b\n```"
	table.LastChild.FirstChild.TableCellRich = &ast.TableCellRich{Spec: 1, Format: "kramdown", Content: plain}
	if err = treenode.RefreshTableCellRichProjection(tableTree.Root); err != nil {
		t.Fatal(err)
	}
	tree.Root.AppendChild(table)
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	const settings = plain + "\n" + `{: id="20260921000000-code001" linewrap="false" linenumber="true" ligatures="false" custom-sy-code-tab-spaces="2"}`
	for index, source := range []string{settings, plain, settings} {
		updated := parse.Parse("", []byte("| Header |\n| --- |\n| code |"), luteEngine.ParseOptions)
		updatedTable := updated.Root.FirstChild
		updatedTable.ID = table.ID
		updatedTable.SetIALAttr("id", table.ID)
		updatedTable.LastChild.FirstChild.TableCellRich = &ast.TableCellRich{Spec: 1, Format: "kramdown", Content: source}
		if err = treenode.RefreshTableCellRichProjection(updated.Root); err != nil {
			t.Fatal(err)
		}
		tx := &Transaction{isReplay: index > 0, DoOperations: []*Operation{{Action: "update", ID: table.ID,
			Data: luteEngine.Tree2BlockDOM(updated, luteEngine.RenderOptions, luteEngine.ParseOptions)}}}
		if err = PerformTxSync(tx); err != nil {
			t.Fatalf("code setting update, undo or redo failed: %s", err)
		}
		restored, err := LoadTreeByBlockID(table.ID)
		if err != nil {
			t.Fatal(err)
		}
		cell := treenode.GetNodeInTree(restored, table.ID).LastChild.FirstChild
		if cell.TableCellRich == nil || cell.TableCellRich.Content != source {
			t.Fatalf("saved settings changed: %#v", cell.TableCellRich)
		}
	}
}

func TestTableCellRichEmptyMathBlockTransaction(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	luteEngine := util.NewLute()
	makeTable := func(source string) *parse.Tree {
		result := parse.Parse("", []byte("| Header |\n| --- |\n| cell |"), luteEngine.ParseOptions)
		result.Root.FirstChild.LastChild.FirstChild.TableCellRich = &ast.TableCellRich{
			Spec: 1, Format: "kramdown", Content: source,
		}
		if err := treenode.RefreshTableCellRichProjection(result.Root); err != nil {
			t.Fatal(err)
		}
		return result
	}
	initial := makeTable("- list")
	table := initial.Root.FirstChild
	table.ID = ast.NewNodeID()
	table.SetIALAttr("id", table.ID)
	tree.Root.AppendChild(table)
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	for _, source := range []string{
		"- list\n\n$$\n\n$$",
		"- list\n\n$$\n\n$$\n\nnext",
		"- list\n\n```\n\n```",
		"- list\n\n```\n\n```\n\nnext",
		"- list\n\n$$\nx^2\n$$",
	} {
		updated := makeTable(source)
		updated.Root.FirstChild.ID = table.ID
		updated.Root.FirstChild.SetIALAttr("id", table.ID)
		tx := &Transaction{DoOperations: []*Operation{{Action: "update", ID: table.ID,
			Data: luteEngine.Tree2BlockDOM(updated, luteEngine.RenderOptions, luteEngine.ParseOptions)}}}
		if err = PerformTxSync(tx); err != nil {
			t.Fatalf("updating rich table cell with %q failed: %s", source, err)
		}
		restored, err := LoadTreeByBlockID(table.ID)
		if err != nil {
			t.Fatal(err)
		}
		cell := treenode.GetNodeInTree(restored, table.ID).LastChild.FirstChild
		if cell.TableCellRich == nil || cell.TableCellRich.Content != source {
			t.Fatalf("saved rich source changed: %#v", cell.TableCellRich)
		}
	}
}
