//go:build fts5

package model

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

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
