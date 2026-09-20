package model

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

func mindmapTestTree() (*parse.Tree, *ast.Node, *ast.Node) {
	tree, item := newFoldedListItemTree(1, false)
	list := item.Parent
	nested := &ast.Node{Type: ast.NodeList, ID: "nested"}
	child := &ast.Node{Type: ast.NodeListItem, ID: "child"}
	item.AppendChild(nested)
	nested.AppendChild(child)
	return tree, list, child
}

func TestPruneListMindmapMetadata(t *testing.T) {
	_, list, child := mindmapTestTree()
	original := `{"version":1,"rootTitle":"A & B","extension":9007199254740993,"nodes":{"` + list.ID +
		`":{"backgroundColor":"red"},"child":{"bold":true,"extension":9007199254740993},"deleted":{}},` +
		`"relations":[{"id":"keep","from":"` + list.ID + `","to":"child","label":"A & B",` +
		`"route":{"version":1,"points":[{"x":-35,"y":20.5,"t":0.5}],"extension":9007199254740993}},` +
		`{"id":"remove","from":"child","to":"deleted","label":""}]}`
	list.SetIALAttr(listMindmapMetadataAttr, original)
	next, changed := pruneListMindmapMetadata(list)
	if !changed || strings.Contains(next, "deleted") || strings.Count(next, "9007199254740993") != 3 ||
		!strings.Contains(next, `"points":[{"x":-35,"y":20.5,"t":0.5}]`) {
		t.Fatalf("unexpected metadata: %s", next)
	}
	var result map[string]json.RawMessage
	_ = json.Unmarshal([]byte(next), &result)
	var nodes map[string]json.RawMessage
	_ = json.Unmarshal(result["nodes"], &nodes)
	if len(nodes) != 2 || nodes[list.ID] == nil || nodes[child.ID] == nil {
		t.Fatalf("root or folded descendant lost: %s", result["nodes"])
	}
	list.SetIALAttr(listMindmapMetadataAttr, next)
	if again, changed := pruneListMindmapMetadata(list); changed || again != next {
		t.Fatal("normalization should be idempotent")
	}
	child.Unlink()
	if next, changed = pruneListMindmapMetadata(list); !changed || strings.Contains(next, `"child"`) {
		t.Fatalf("deleted child retained: %s", next)
	}
}

func TestPruneListMindmapPreservesInvalidRoutes(t *testing.T) {
	for _, route := range []string{
		`null`, `{}`, `{"version":2,"points":[{"x":0,"y":0,"t":0.5}]}`,
		`{"version":1,"points":[]}`, `{"version":1,"points":[{"x":"0","y":0,"t":0.5}]}`,
		`{"version":1,"points":[{"x":0,"y":0,"t":-0.1}]}`, `{"version":1,"points":[{"x":0,"y":0,"t":1.1}]}`,
		`{"version":1,"points":[{"x":1000001,"y":0,"t":0.5}]}`, `{"version":1,"points":[{"x":0,"y":null,"t":0.5}]}`,
		`{"version":1,"points":[{"x":0,"y":0}]}`,
		`{"version":1,"points":[` + strings.Repeat(`{"x":0,"y":0,"t":0.5},`, 64) + `{"x":0,"y":0,"t":0.5}]}`,
	} {
		_, list, _ := mindmapTestTree()
		original := `{"version":1,"nodes":{"deleted":{}},"relations":[{"id":"r","from":"a","to":"b","label":"","route":` + route + `}]}`
		list.SetIALAttr(listMindmapMetadataAttr, original)
		if next, changed := pruneListMindmapMetadata(list); changed || next != original {
			t.Fatalf("unsupported or corrupt route was changed: %s", next)
		}
	}
}

func TestPruneListMindmapExcludesListsInsideContentBlocks(t *testing.T) {
	_, list, child := mindmapTestTree()
	quote := &ast.Node{Type: ast.NodeBlockquote, ID: "quote"}
	list.FirstChild.AppendChild(quote)
	inner := &ast.Node{Type: ast.NodeList, ID: "quoted-list"}
	quote.AppendChild(inner)
	inner.AppendChild(&ast.Node{Type: ast.NodeListItem, ID: "quoted-item"})
	list.SetIALAttr(listMindmapMetadataAttr, `{"version":1,"nodes":{"child":{},"quoted-item":{}},"relations":[]}`)
	next, changed := pruneListMindmapMetadata(list)
	if !changed || strings.Contains(next, "quoted-item") || !strings.Contains(next, child.ID) {
		t.Fatalf("content block list was treated as a mind map branch: %s", next)
	}
}

func TestPruneListMindmapPreservesInvalidMetadata(t *testing.T) {
	for _, value := range []string{
		`broken`, `null`, `{"version":2,"nodes":{"deleted":{}},"relations":[]}`,
		`{"version":1,"nodes":{"deleted":{"bold":"true"}},"relations":[]}`,
		`{"version":1,"nodes":{},"relations":[{"id":"r","from":"a","to":"b"}]}`,
		`{"version":1,"nodes":{},"relations":[{"id":"r","from":"a","to":"b","label":""},{"id":"r","from":"b","to":"a","label":""}]}`,
	} {
		_, list, _ := mindmapTestTree()
		list.SetIALAttr(listMindmapMetadataAttr, value)
		if next, changed := pruneListMindmapMetadata(list); changed || next != value {
			t.Fatalf("invalid configuration changed: %s", value)
		}
	}
}

func TestNormalizeListMindmapTransactions(t *testing.T) {
	for _, withUndo := range []bool{false, true} {
		tree, list, child := mindmapTestTree()
		original := `{"version":1,"nodes":{"child":{"bold":true}},"relations":[{"id":"r","from":"` + list.ID + `","to":"child","label":"",` +
			`"route":{"version":1,"points":[{"x":-35,"y":20.5,"t":0.5}]}}]}`
		list.SetIALAttr(listMindmapMetadataAttr, original)
		parent := child.Parent
		child.Unlink()
		tx := &Transaction{trees: map[string]*parse.Tree{tree.ID: tree}, DoOperations: []*Operation{{Action: "delete", ID: child.ID}}}
		if withUndo {
			tx.UndoOperations = []*Operation{{Action: "insert", ID: child.ID}}
		}
		if ret := tx.normalizeListMindmapMetadata(); ret != nil {
			t.Fatal(ret)
		}
		cleaned := list.IALAttr(listMindmapMetadataAttr)
		if strings.Contains(cleaned, `"child"`) || len(tx.DoOperations) != 2 {
			t.Fatalf("delete did not clean or broadcast: %s", cleaned)
		}
		if !withUndo {
			if len(tx.UndoOperations) != 0 {
				t.Fatal("API transaction without undo gained an incomplete undo entry")
			}
			continue
		}
		if len(tx.UndoOperations) != 2 || tx.UndoOperations[0].Action != "setAttrs" {
			t.Fatal("cleanup not included in undo")
		}
		var attrs map[string]string
		_ = json.Unmarshal([]byte(tx.UndoOperations[0].Data.(string)), &attrs)
		list.SetIALAttr(listMindmapMetadataAttr, attrs[listMindmapMetadataAttr])
		parent.AppendChild(child)
		if list.IALAttr(listMindmapMetadataAttr) != original {
			t.Fatal("undo lost original styles or relations")
		}
		child.Unlink()
		_ = json.Unmarshal([]byte(tx.DoOperations[1].Data.(string)), &attrs)
		list.SetIALAttr(listMindmapMetadataAttr, attrs[listMindmapMetadataAttr])
		if list.IALAttr(listMindmapMetadataAttr) != cleaned {
			t.Fatal("redo failed to restore cleaned metadata")
		}
	}
}

func TestNormalizeListMindmapKeepsReinsertedNodesAndReplay(t *testing.T) {
	tree, list, child := mindmapTestTree()
	original := `{"version":1,"nodes":{"child":{}},"relations":[]}`
	list.SetIALAttr(listMindmapMetadataAttr, original)
	parent := child.Parent
	child.Unlink()
	parent.AppendChild(child)
	tx := &Transaction{trees: map[string]*parse.Tree{tree.ID: tree},
		DoOperations: []*Operation{{Action: "delete", ID: child.ID}, {Action: "insert", ID: child.ID}}}
	if ret := tx.normalizeListMindmapMetadata(); ret != nil || len(tx.DoOperations) != 2 || list.IALAttr(listMindmapMetadataAttr) != original {
		t.Fatal("same-transaction reinsert lost metadata")
	}
	child.Unlink()
	tx.isReplay = true
	if ret := tx.normalizeListMindmapMetadata(); ret != nil || list.IALAttr(listMindmapMetadataAttr) != original {
		t.Fatal("replay changed the recorded snapshot")
	}
}
