// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package treenode

import (
	"fmt"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	TabsActiveIDAttr = "tabs-active-id"
	TabsPositionAttr = "tabs-position"
)

// TabsActiveItem 返回选中的直属页签项，属性缺失或失效时回退到第一页。
func TabsActiveItem(tabs *ast.Node) (ret *ast.Node) {
	if nil == tabs || ast.NodeTabs != tabs.Type {
		return
	}
	activeID := tabs.IALAttr(TabsActiveIDAttr)
	for item := tabs.FirstChild; nil != item; item = item.Next {
		if ast.NodeTabItem != item.Type {
			continue
		}
		if nil == ret {
			ret = item
		}
		if item.ID == activeID {
			return item
		}
	}
	return
}

// ValidateTabsAttrs 在修改属性前校验页签属性，避免部分属性已写入后才发现错误。
func ValidateTabsAttrs(node *ast.Node, attrs map[string]string) error {
	for name, value := range attrs {
		name = strings.ToLower(name)
		if TabsActiveIDAttr != name && TabsPositionAttr != name {
			continue
		}
		if nil == node || ast.NodeTabs != node.Type {
			return fmt.Errorf("attribute [%s] is only supported on tab containers", name)
		}
		value = strings.TrimSpace(util.RemoveInvalidRetainCtrl(value))
		if "" == value {
			continue
		}
		if TabsPositionAttr == name {
			if "top" != value && "left" != value {
				return fmt.Errorf("invalid tabs position [%s]", value)
			}
			continue
		}
		found := false
		for item := node.FirstChild; nil != item; item = item.Next {
			if ast.NodeTabItem == item.Type && item.ID == value {
				found = true
				break
			}
		}
		if !found {
			return fmt.Errorf("active tab [%s] is not a direct child of [%s]", value, node.ID)
		}
	}
	return nil
}

// NormalizeTabs 修复空页和无效选中项，保留所有已有内容及块标识。
func NormalizeTabs(root *ast.Node) (changed bool) {
	if nil == root {
		return
	}
	ast.Walk(root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering {
			return ast.WalkContinue
		}
		if ast.NodeTabItem == node.Type {
			if !hasContentChild(node) {
				node.AppendChild(NewParagraph(""))
				changed = true
			}
			return ast.WalkContinue
		}
		if ast.NodeTabs != node.Type {
			return ast.WalkContinue
		}
		if nil == TabsActiveItem(node) {
			item := &ast.Node{Type: ast.NodeTabItem, ID: ast.NewNodeID()}
			item.SetIALAttr("id", item.ID)
			item.SetIALAttr("updated", util.TimeFromID(item.ID))
			item.AppendChild(NewParagraph(""))
			node.AppendChild(item)
			changed = true
		}
		if active := TabsActiveItem(node); nil != active && node.IALAttr(TabsActiveIDAttr) != active.ID {
			node.SetIALAttr(TabsActiveIDAttr, active.ID)
			changed = true
		}
		if position := node.IALAttr(TabsPositionAttr); "" != position && "top" != position && "left" != position {
			node.SetIALAttr(TabsPositionAttr, "top")
			changed = true
		}
		return ast.WalkContinue
	})
	return
}

func hasContentChild(node *ast.Node) bool {
	for child := node.FirstChild; nil != child; child = child.Next {
		if isContentBlock(child) {
			return true
		}
	}
	return false
}

// RemapTabsActiveIDs 将复制、模板和导入生成的新块标识应用到选中状态。
func RemapTabsActiveIDs(root *ast.Node, ids map[string]string) {
	ast.Walk(root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && ast.NodeTabs == node.Type {
			if activeID := ids[node.IALAttr(TabsActiveIDAttr)]; "" != activeID {
				node.SetIALAttr(TabsActiveIDAttr, activeID)
			}
		}
		return ast.WalkContinue
	})
}

// TabTitleParagraph 将标题解析为临时行级内容，引用和资源仍归属于原页签项。
func TabTitleParagraph(item *ast.Node) *ast.Node {
	if nil == item || ast.NodeTabItem != item.Type || "" == item.TabItemTitle {
		return nil
	}
	luteEngine := util.NewLute()
	tree := parse.Inline("", []byte(item.TabItemTitle), luteEngine.ParseOptions)
	if nil == tree || nil == tree.Root || nil == tree.Root.FirstChild {
		return nil
	}
	parse.NestedInlines2FlattedSpans(tree, false)
	paragraph := tree.Root.FirstChild
	paragraph.ID = ""
	paragraph.KramdownIAL = nil
	paragraph.Parent = item
	return paragraph
}

// WalkWithTabTitles 遍历正文及页签标题中的行级内容，标题修改后写回字符串字段。
func WalkWithTabTitles(root *ast.Node, walker ast.Walker) {
	if nil == root {
		return
	}
	ast.Walk(root, func(node *ast.Node, entering bool) ast.WalkStatus {
		status := walker(node, entering)
		if !entering || ast.WalkContinue != status || ast.NodeTabItem != node.Type {
			return status
		}
		paragraph := TabTitleParagraph(node)
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
			node.TabItemTitle = strings.TrimSpace(after)
		}
		if stop {
			return ast.WalkStop
		}
		return status
	})
}

// MaterializeTabTitles 在批量改写期间提供临时标题子树，返回的收尾函数必须在渲染或写盘前执行。
func MaterializeTabTitles(root *ast.Node) func() {
	type titleFragment struct {
		item      *ast.Node
		paragraph *ast.Node
		before    string
	}
	luteEngine := util.NewLute()
	var fragments []titleFragment
	ast.Walk(root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && ast.NodeTabItem == node.Type {
			if paragraph := TabTitleParagraph(node); nil != paragraph {
				paragraph.Parent = nil
				fragments = append(fragments, titleFragment{node, paragraph, FormatNode(paragraph, luteEngine)})
				node.PrependChild(paragraph)
			}
		}
		return ast.WalkContinue
	})
	finished := false
	return func() {
		if finished {
			return
		}
		finished = true
		for _, fragment := range fragments {
			fragment.paragraph.Unlink()
			if after := FormatNode(fragment.paragraph, luteEngine); after != fragment.before {
				fragment.item.TabItemTitle = strings.TrimSpace(after)
			}
		}
	}
}
