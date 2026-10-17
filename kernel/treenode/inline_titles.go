// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package treenode

import (
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func inlineTitleParagraph(owner *ast.Node, title string) *ast.Node {
	if "" == title {
		return nil
	}
	tree := parse.Inline("", []byte(title), util.NewLute().ParseOptions)
	if nil == tree || nil == tree.Root || nil == tree.Root.FirstChild {
		return nil
	}
	parse.NestedInlines2FlattedSpans(tree, false)
	paragraph := tree.Root.FirstChild
	paragraph.ID = ""
	paragraph.KramdownIAL = nil
	paragraph.Parent = owner
	return paragraph
}

// WalkWithInlineTitles 遍历正文及页签、提示块标题中的行级内容，标题修改后写回字符串字段。
// 标题仅提供临时行级节点，引用和资源归属于原容器块，不向正文添加持久化子块。
func WalkWithInlineTitles(root *ast.Node, walker ast.Walker) {
	if nil == root {
		return
	}
	ast.Walk(root, func(node *ast.Node, entering bool) ast.WalkStatus {
		status := walker(node, entering)
		if !entering || ast.WalkContinue != status {
			return status
		}
		var paragraph *ast.Node
		switch node.Type {
		case ast.NodeTabItem:
			paragraph = TabTitleParagraph(node)
		case ast.NodeCallout:
			paragraph = inlineTitleParagraph(node, node.CalloutTitle)
		}
		if nil == paragraph {
			return status
		}
		luteEngine := util.NewLute()
		before := FormatNode(paragraph, luteEngine)
		stop := false
		ast.Walk(paragraph, func(inline *ast.Node, titleEntering bool) ast.WalkStatus {
			if inline == paragraph {
				return ast.WalkContinue
			}
			result := walker(inline, titleEntering)
			stop = ast.WalkStop == result
			return result
		})
		if after := FormatNode(paragraph, luteEngine); after != before {
			after = strings.TrimSpace(after)
			if ast.NodeCallout == node.Type {
				node.CalloutTitle = after
			} else {
				node.TabItemTitle = after
			}
		}
		if stop {
			return ast.WalkStop
		}
		return status
	})
}

// MaterializeInlineTitles 在批量改写期间提供临时标题子树，收尾函数必须在渲染或写盘前执行。
// 临时清空字符串字段，避免嵌套遍历重复解析同一标题；未修改的标题按原字符串恢复。
func MaterializeInlineTitles(root *ast.Node) func() {
	return materializeInlineTitles(root, nil)
}

// MaterializeInlineTitlesForExport 将转换后的标题写回标准 Markdown，保留链接和脚注的导出语义。
func MaterializeInlineTitlesForExport(root *ast.Node) func() {
	luteEngine := util.NewLute()
	return materializeInlineTitles(root, func(node *ast.Node) string {
		return ExportNodeStdMd(node, luteEngine)
	})
}

func materializeInlineTitles(root *ast.Node, formatTitle func(*ast.Node) string) func() {
	type titleFragment struct {
		title     *string
		original  string
		paragraph *ast.Node
		before    string
	}
	luteEngine := util.NewLute()
	var fragments []titleFragment
	if nil != root {
		ast.Walk(root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}
			var title *string
			switch node.Type {
			case ast.NodeTabItem:
				if nil == node.TabTitleBlock() {
					title = &node.TabItemTitle
				}
			case ast.NodeCallout:
				title = &node.CalloutTitle
			}
			if nil != title {
				if paragraph := inlineTitleParagraph(node, *title); nil != paragraph {
					paragraph.Parent = nil
					fragments = append(fragments, titleFragment{title, *title, paragraph, FormatNode(paragraph, luteEngine)})
					*title = ""
					node.PrependChild(paragraph)
				}
			}
			return ast.WalkContinue
		})
	}
	finished := false
	return func() {
		if finished {
			return
		}
		finished = true
		for _, fragment := range fragments {
			fragment.paragraph.Unlink()
			*fragment.title = fragment.original
			if after := FormatNode(fragment.paragraph, luteEngine); after != fragment.before || nil != formatTitle {
				if nil != formatTitle {
					after = formatTitle(fragment.paragraph)
				}
				*fragment.title = strings.TrimSpace(after)
			}
		}
	}
}
