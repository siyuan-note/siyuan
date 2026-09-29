package model

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

func TestMindmapSummaryMembership(t *testing.T) {
	raw := json.RawMessage(`[{"id":"s","parentId":"root","nodeIds":["a","b","c"],"label":"Summary","extension":9007199254740993}]`)
	for _, tc := range []struct {
		name    string
		current []string
		moved   string
		want    []string
	}{
		{"insert within", []string{"a", "new", "b", "c", "d"}, "", []string{"a", "new", "b", "c"}},
		{"insert outside", []string{"new", "a", "b", "c", "d"}, "", []string{"a", "b", "c"}},
		{"delete middle", []string{"a", "c", "d"}, "", []string{"a", "c"}},
		{"keep one", []string{"c", "d"}, "", []string{"c"}},
		{"delete all", []string{"d"}, "", nil},
		{"move out", []string{"a", "b", "d", "c"}, "c", []string{"a", "b"}},
		{"reorder within", []string{"b", "a", "c", "d"}, "a", []string{"b", "a", "c"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			next, _ := normalizeListMindmapSummaries(raw, map[string][]string{"root": tc.current},
				&listMindmapSummaryContext{previous: map[string][]string{"root": {"a", "b", "c", "d"}},
					moved: map[string]bool{tc.moved: true}})
			var summaries []struct {
				NodeIDs []string `json:"nodeIds"`
			}
			if err := json.Unmarshal(next, &summaries); err != nil {
				t.Fatal(err)
			}
			if tc.want == nil {
				if len(summaries) != 0 {
					t.Fatalf("empty range retained: %s", next)
				}
			} else if len(summaries) != 1 || !slices.Equal(summaries[0].NodeIDs, tc.want) ||
				!strings.Contains(string(next), "9007199254740993") {
				t.Fatalf("unexpected range or lost extension: %s", next)
			}
		})
	}
}

func TestMindmapSummaryInvalidMetadataPreserved(t *testing.T) {
	_, list, _ := mindmapTestTree()
	for _, summaries := range []string{
		`null`, `{}`, `[{"id":"s","parentId":"p","nodeIds":[],"label":"x"}]`,
		`[{"id":"s","parentId":"p","nodeIds":["a","a"],"label":"x"}]`,
		`[{"id":"s","parentId":"p","nodeIds":["p"],"label":"x"}]`,
		`[{"id":"s","parentId":"p","nodeIds":["a"],"label":1}]`,
		`[{"id":"s","parentId":"p","nodeIds":["a"],"label":"x","color":1}]`,
	} {
		original := `{"version":1,"nodes":{"deleted":{}},"relations":[],"summaries":` + summaries + `}`
		list.SetIALAttr(listMindmapMetadataAttr, original)
		if next, changed := pruneListMindmapMetadata(list); changed || next != original {
			t.Fatalf("invalid source was changed: %s", next)
		}
	}
}

func TestMindmapSummaryTransactionsAndListRoundTrip(t *testing.T) {
	tree, list, child := mindmapTestTree()
	parent := child.Parent.Parent.ID
	second := &ast.Node{Type: ast.NodeListItem, ID: "second"}
	child.Parent.AppendChild(second)
	original := `{"version":1,"nodes":{},"relations":[],"summaries":[{"id":"s","parentId":"` + parent +
		`","nodeIds":["child","second"],"label":"Summary","extension":9007199254740993}]}`
	list.SetIALAttr(listMindmapMetadataAttr, original)
	tx := &Transaction{trees: map[string]*parse.Tree{tree.ID: tree},
		DoOperations: []*Operation{{Action: "insert", ID: "new"}}, UndoOperations: []*Operation{{Action: "delete", ID: "new"}}}
	tx.captureListMindmapSummarySiblings(tree)
	child.InsertAfter(&ast.Node{Type: ast.NodeListItem, ID: "new"})
	if ret := tx.normalizeListMindmapMetadata(); ret != nil {
		t.Fatal(ret)
	}
	next := list.IALAttr(listMindmapMetadataAttr)
	if !strings.Contains(next, `"nodeIds":["child","new","second"]`) || len(tx.DoOperations) != 2 || len(tx.UndoOperations) != 2 {
		t.Fatalf("insert did not update and broadcast summary: %s", next)
	}
	var attrs map[string]string
	_ = json.Unmarshal([]byte(tx.UndoOperations[0].Data.(string)), &attrs)
	if attrs[listMindmapMetadataAttr] != original {
		t.Fatal("undo did not retain the original summary")
	}
	// 转换块类型和折叠不改变成员或概要文字。
	ast.Walk(list, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering {
			if node.Type == ast.NodeList {
				node.Type = ast.NodeMindmap
			} else if node.Type == ast.NodeListItem {
				node.Type = ast.NodeMindmapItem
				node.SetIALAttr("fold", "1")
			}
		}
		return ast.WalkContinue
	})
	if ret, changed := pruneListMindmapMetadata(list); changed || ret != next {
		t.Fatalf("type conversion or folding changed metadata: %s", ret)
	}
	tx.isReplay = true
	child.Unlink()
	if ret := tx.normalizeListMindmapMetadata(); ret != nil || list.IALAttr(listMindmapMetadataAttr) != next {
		t.Fatal("replay rewrote the recorded summary snapshot")
	}
}
