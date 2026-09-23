package model

import (
	"reflect"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestListItemDocRootPreservesStructure(t *testing.T) {
	for _, tc := range []struct {
		name     string
		markdown string
		typ      int
		checked  bool
	}{
		{"unordered", "- item\n  - child\n", 0, false},
		{"ordered", "4. item\n   - child\n", 1, false},
		{"unchecked", "- [ ] item\n  - [x] child\n", 3, false},
		{"checked", "- [x] item\n  - [ ] child\n", 3, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fixture := setupFileOperationTest(t)
			lute := util.NewLute()
			dom, _ := lute.Md2BlockDOMTree(tc.markdown, true)
			source := lute.BlockDOM2Tree(dom)
			// 与已保存的文档一致，移除独立的块属性语法节点。
			render.NewJSONRenderer(source, lute.RenderOptions, lute.ParseOptions).Render()
			parent := source.Root.FirstChild
			item := parent.FirstChild
			oldID := item.ID
			item.SetIALAttr("custom-example", "value & text")
			item.SetIALAttr("fold", "1")
			item.SetIALAttr(DocHiddenAttr, "1")
			parent.SetIALAttr("custom-list", "kept")
			originalData := *item.ListData
			children := map[string]ast.NodeType{}
			ast.Walk(item, func(n *ast.Node, entering bool) ast.WalkStatus {
				if entering && n != item && n.ID != "" {
					children[n.ID] = n.Type
				}
				return ast.WalkContinue
			})

			root := listItemDocRoot(item, "item")
			if source.Root.FirstChild != nil {
				t.Fatal("empty source list was not removed")
			}
			if root.ID != oldID || root.IALAttr("id") != oldID || root.IALAttr("title") != "item" || root.IALAttr("type") != "doc" {
				t.Fatalf("unexpected document attributes: %v", root.KramdownIAL)
			}
			if root.IALAttr("fold") != "" || root.IALAttr(DocHiddenAttr) != "" {
				t.Fatal("new document should be visible and unfolded")
			}
			if item.IALAttr("fold") != "1" || item.IALAttr(DocHiddenAttr) != "1" || item.IALAttr("custom-example") != "value & text" {
				t.Fatal("item attributes were changed through document attributes")
			}
			if !reflect.DeepEqual(item.ListData, &originalData) {
				t.Fatal("item list data changed")
			}
			list := root.FirstChild
			if list.Type != ast.NodeList || list.FirstChild != item || list.LastChild != item || list.ListData.Typ != tc.typ || list.IALAttr("custom-list") != "kept" {
				t.Fatal("list wrapper did not preserve the original list structure")
			}
			if list.ID == parent.ID || item.ID == oldID || list.ID == item.ID {
				t.Fatal("new blocks must have distinct fresh IDs")
			}
			if tc.typ == 1 && list.ListData.Start != 4 {
				t.Fatalf("ordered list start changed: %d", list.ListData.Start)
			}
			if err := treenode.ValidateBlockSubtree(root); err != nil {
				t.Fatal(err)
			}

			tree := &parse.Tree{Root: root, ID: root.ID, Box: fixture.box.ID, Path: "/" + root.ID + ".sy", HPath: "/item"}
			root.Spec = treenode.CurrentSpec
			if _, err := filesys.WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			loaded, _, err := filesys.ReadTreeSnapshot(tree.Box, tree.Path)
			if err != nil {
				t.Fatal(err)
			}
			seen := map[string]bool{}
			ast.Walk(loaded.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if entering && n.ID != "" {
					if seen[n.ID] || n.IALAttr("id") != n.ID {
						t.Fatalf("duplicate or inconsistent ID: %s", n.ID)
					}
					seen[n.ID] = true
					if typ, ok := children[n.ID]; ok {
						if n.Type != typ {
							t.Fatal("descendant type changed")
						}
						delete(children, n.ID)
					}
				}
				return ast.WalkContinue
			})
			if len(children) != 0 {
				t.Fatalf("descendant IDs lost: %v", children)
			}
			loadedItem := loaded.Root.FirstChild.FirstChild
			if loadedItem.IALAttr("fold") != "1" || loadedItem.IALAttr("custom-example") != "value & text" {
				t.Fatal("item attributes lost after reload")
			}
			if tc.typ == 3 {
				marker := loadedItem.ChildByType(ast.NodeTaskListItemMarker)
				if marker == nil || marker.TaskListItemChecked != tc.checked {
					t.Fatal("task state lost after reload")
				}
			}
			md := string(render.NewProtyleExportMdRenderer(loaded, lute.RenderOptions, lute.ParseOptions).Render())
			if !strings.Contains(md, "child") || (tc.typ == 1 && !strings.Contains(md, "4. item")) {
				t.Fatalf("export lost list contents or numbering: %s", md)
			}
		})
	}
}

func TestListItemDocRootPreservesSiblings(t *testing.T) {
	lute := util.NewLute()
	dom, _ := lute.Md2BlockDOMTree("3. before\n4. item\n5. after\n", true)
	source := lute.BlockDOM2Tree(dom)
	render.NewJSONRenderer(source, lute.RenderOptions, lute.ParseOptions).Render()
	parent := source.Root.FirstChild
	before, after := parent.FirstChild, parent.LastChild
	originalStart := parent.ListData.Start
	root := listItemDocRoot(before.Next, "item")
	if parent.Parent != source.Root || parent.FirstChild != before || before.Next != after || after.Previous != before {
		t.Fatal("source siblings changed")
	}
	if parent.ListData.Start != originalStart || root.FirstChild.ListData.Start != 4 {
		t.Fatal("source or target list start changed")
	}
}

func TestListItemDocRootEmptyTask(t *testing.T) {
	item := &ast.Node{Type: ast.NodeListItem, ID: ast.NewNodeID(), ListData: &ast.ListData{Typ: 3}}
	marker := &ast.Node{Type: ast.NodeTaskListItemMarker, TaskListItemChecked: true}
	item.AppendChild(marker)
	root := listItemDocRoot(item, "")
	if root.FirstChild.ListData.Typ != 3 || item.FirstChild != marker || !marker.TaskListItemChecked || item.LastChild.Type != ast.NodeParagraph {
		t.Fatal("empty task must retain its marker and have an editable paragraph")
	}
}
