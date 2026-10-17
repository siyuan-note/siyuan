package model

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestAutoSpacePreservesMindmapBlocks(t *testing.T) {
	previousConf := Conf
	Conf = NewAppConf()
	Conf.Editor.Store(conf.NewEditor())
	Conf.Export.Store(conf.NewExport())
	t.Cleanup(func() { Conf = previousConf })
	for _, markdown := range []string{
		"- 中文SiYuan\n  - [x] 子节点SiYuan\n\n  > 引述SiYuan\n  >\n  > - 普通列表SiYuan\n\nOutside\n\n- Ordinary list\n",
		"- \n",
	} {
		t.Run(markdown, func(t *testing.T) {
			tree := treenode.NewTree("20261014000000-box0001", "/20261014000000-doc0001.sy", "/Mindmap", "Mindmap")
			engine := NewLute()
			content := engine.BlockDOM2Tree(engine.Md2BlockDOM(markdown, false))
			for content.Root.FirstChild != nil {
				tree.Root.AppendChild(content.Root.FirstChild)
			}
			list := tree.Root.ChildByType(ast.NodeList)
			retagLegacyMindmapList(list)
			metadata := `{"version":2,"rootTitle":"Root & title","viewLocked":true,"nodes":{},"relations":[],"summaries":[],"extension":9007199254740993}`
			list.SetIALAttr(listMindmapMetadataAttr, metadata)
			list.SetIALAttr("style", "height: 480px;")
			list.FirstChild.SetIALAttr("fold", "1")
			listID, itemID := list.ID, list.FirstChild.ID
			types := map[string]ast.NodeType{}
			ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if entering && n.IsBlock() && n.Type != ast.NodeKramdownBlockIAL {
					types[n.ID] = n.Type
				}
				return ast.WalkContinue
			})
			for pass := range 2 {
				// 已保存的 .sy 树只在属性中保存 IAL，移除 Markdown 解析使用的辅助节点。
				var ialNodes []*ast.Node
				ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
					if entering && n.Type == ast.NodeKramdownBlockIAL {
						ialNodes = append(ialNodes, n)
					}
					return ast.WalkContinue
				})
				for _, n := range ialNodes {
					n.Unlink()
				}
				tree = autoSpaceTree(tree)
				found := map[string]ast.NodeType{}
				ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
					if !entering || !n.IsBlock() || n.Type == ast.NodeKramdownBlockIAL {
						return ast.WalkContinue
					}
					found[n.ID] = n.Type
					if expected, ok := types[n.ID]; !ok || n.Type != expected {
						t.Errorf("pass %d: block %s changed from %s to %s", pass, n.ID, expected, n.Type)
					}
					if n.ID == listID && (n.IALAttr(listMindmapMetadataAttr) != metadata || n.IALAttr("style") != "height: 480px;") {
						t.Error("mindmap metadata or height changed")
					}
					if n.ID == itemID && n.IALAttr("fold") != "1" {
						t.Error("fold state changed")
					}
					return ast.WalkContinue
				})
				if len(found) != len(types) {
					t.Fatalf("pass %d: block count changed from %d to %d", pass, len(types), len(found))
				}
				if strings.Contains(markdown, "中文") {
					engine := NewLute()
					formatted := string(render.NewFormatRenderer(tree, engine.RenderOptions, engine.ParseOptions).Render())
					if !strings.Contains(formatted, "中文 SiYuan") || !strings.Contains(formatted, "子节点 SiYuan") ||
						!strings.Contains(formatted, "普通列表 SiYuan") || !strings.Contains(formatted, "[X]") {
						t.Fatalf("text or task marker was not formatted: %s", formatted)
					}
				}
			}
		})
	}
}
