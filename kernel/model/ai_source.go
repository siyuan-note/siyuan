// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const nodeAttrAISource = "custom-sy-ai-source"

func AgentBlockDOM(dom string) string {
	engine := util.NewLute()
	tree := engine.BlockDOM2Tree(dom)
	markAgentBlocks(tree.Root, nil, engine)
	return engine.Tree2BlockDOM(tree, engine.RenderOptions, engine.ParseOptions)
}

func markAgentBlocks(root, previous *ast.Node, engine *lute.Lute) {
	oldBlocks := map[string]*ast.Node{}
	if previous != nil {
		ast.Walk(previous, func(node *ast.Node, entering bool) ast.WalkStatus {
			if entering && node.IsBlock() && node.ID != "" && node.Type != ast.NodeKramdownBlockIAL {
				oldBlocks[node.ID] = node
			}
			return ast.WalkContinue
		})
	}
	ast.Walk(root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !node.IsBlock() || node.Type == ast.NodeDocument || node.Type == ast.NodeKramdownBlockIAL {
			return ast.WalkContinue
		}
		id := node.IALAttr("id")
		if id == "" {
			id = node.ID
		}
		old := oldBlocks[id]
		if old == nil || old.Type != node.Type || (!node.IsContainerBlock() &&
			treenode.ExportNodeStdMd(old, engine) != treenode.ExportNodeStdMd(node, engine)) {
			node.SetIALAttr(nodeAttrAISource, "agent")
		} else if source := old.IALAttr(nodeAttrAISource); source != "" {
			node.SetIALAttr(nodeAttrAISource, source)
		} else {
			node.RemoveIALAttr(nodeAttrAISource)
		}
		return ast.WalkContinue
	})
}
