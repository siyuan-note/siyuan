package model

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestListConversionStructureCompatibility(t *testing.T) {
	data, err := os.ReadFile("testdata/list_conversion.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixtures []struct {
		Before, After string
		DoOperations  []*Operation
		RemoveList    bool
	}
	if err = json.Unmarshal(data, &fixtures); err != nil {
		t.Fatal(err)
	}
	for index, fixture := range fixtures {
		t.Run(fmt.Sprint(index), func(t *testing.T) {
			before := util.NewLute().BlockDOM2Tree(fixture.Before)
			expected := util.NewLute().BlockDOM2Tree(fixture.After)
			originalIDs := map[string]bool{}
			ast.Walk(before.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
				if entering && node.ID != "" {
					originalIDs[node.ID] = true
				}
				return ast.WalkContinue
			})
			moved := map[string]bool{}
			for _, op := range fixture.DoOperations {
				if op.Action == "move" {
					moved[op.ID] = true
				}
			}
			var selected []*ast.Node
			options := apicontract.TransactionListConversion{Type: "remove"}
			for _, op := range fixture.DoOperations {
				node := treenode.GetNodeInTree(before, op.ID)
				if node == nil {
					continue
				}
				if op.Action == "delete" && (node.Type == ast.NodeList || node.Type == ast.NodeListItem) {
					selected = append(selected, node)
				}
				if op.Action != "update" || node.Type != ast.NodeParagraph && node.Type != ast.NodeHeading {
					continue
				}
				target := treenode.GetNodeInTree(expected, node.ID)
				if target == nil {
					continue
				}
				if target.Type == ast.NodeHeading {
					options.Type, options.Level = "heading", target.HeadingLevel
				} else if !fixture.RemoveList {
					options.Type = "paragraph"
				}
				if !moved[node.ID] {
					selected = append(selected, node)
				}
			}
			// 递归样本以外层选择覆盖同类型的内层列表。
			options.Recursively = index == 7
			if _, _, err = convertListNodes(selected, options); err != nil {
				t.Fatal(err)
			}
			shape := func(root *ast.Node) []string {
				var ret []string
				ast.Walk(root, func(node *ast.Node, entering bool) ast.WalkStatus {
					if !entering || !node.IsBlock() || node.Type == ast.NodeDocument || node.Type == ast.NodeKramdownBlockIAL {
						return ast.WalkContinue
					}
					id := node.ID
					if !originalIDs[id] {
						id = "new-list"
					}
					parent := node.Parent.ID
					if node.Parent.Type == ast.NodeDocument {
						parent = "document"
					} else if !originalIDs[parent] {
						parent = "new-list"
					}
					ret = append(ret, fmt.Sprintf("%s/%s/%s/%d/%s", id, parent, node.Type, node.HeadingLevel, node.Text()))
					return ast.WalkContinue
				})
				return ret
			}
			got, want := strings.Join(shape(before.Root), "\n"), strings.Join(shape(expected.Root), "\n")
			if got != want {
				t.Fatalf("list structure changed:\nwant %s\ngot %s", want, got)
			}
		})
	}
}

func TestListConversionOrderedRuns(t *testing.T) {
	_, tree := util.NewLute().Md2BlockDOMTree("3. Alpha\n4. Beta\n5. Gamma\n", false)
	list := tree.Root.ChildByType(ast.NodeList)
	items := listConversionItems(list)
	if _, _, err := convertListNodes([]*ast.Node{items[1]}, apicontract.TransactionListConversion{Type: "heading", Level: 5}); err != nil {
		t.Fatal(err)
	}
	var starts []int
	for node := tree.Root.FirstChild; node != nil; node = node.Next {
		if node.Type == ast.NodeList {
			starts = append(starts, node.ListData.Start)
		}
	}
	if fmt.Sprint(starts) != "[3 5]" {
		t.Fatalf("ordered list numbering changed: %v", starts)
	}
}
