package model

import (
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

// convertExportPreviewTabs 将页签转换为列表，使外部平台保留全部内容和嵌套层级。
func convertExportPreviewTabs(root *ast.Node) {
	ast.Walk(root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering || node.Type != ast.NodeTabs {
			return ast.WalkContinue
		}
		tasks := node.IALAttr("tabs-task") == "true"
		node.Type = ast.NodeList
		node.ListData = &ast.ListData{Typ: 0, BulletChar: '*', Marker: []byte("*")}
		for item := node.FirstChild; item != nil; item = item.Next {
			if item.Type != ast.NodeTabItem {
				continue
			}
			title := item.TabTitleBlock()
			if title == nil {
				title = treenode.TabTitleParagraph(item)
				if title != nil {
					title.Parent = nil
				}
			}
			if title == nil {
				title = &ast.Node{Type: ast.NodeParagraph}
			}
			title.RemoveIALAttr("tabs-title")
			item.PrependChild(title)
			item.Type = ast.NodeListItem
			item.ListData = &ast.ListData{Typ: 0, BulletChar: '*', Marker: []byte("*")}
			marker := item.IALAttr("tabs-task")
			if marker == "" && tasks {
				marker = " "
			}
			if marker != "" {
				node.ListData.Typ = 3
				item.ListData.Typ = 3
				task := &ast.Node{Type: ast.NodeTaskListItemMarker}
				task.ReviveFromMarker(marker[0])
				title.PrependChild(task)
			}
			item.RemoveIALAttr("tabs-task")
		}
		node.RemoveIALAttr("tabs-task")
		node.RemoveIALAttr("tabs-active-id")
		node.RemoveIALAttr("tabs-position")
		return ast.WalkContinue
	})
}
