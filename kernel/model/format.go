// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/editor"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func AutoSpace(rootID string) (err error) {
	tree, err := LoadTreeByBlockID(rootID)
	if err != nil {
		return
	}

	logging.LogInfof("formatting tree [%s]...", rootID)
	util.PushProtyleLoading(rootID, Conf.Language(116))
	defer ReloadProtyle(rootID)

	FlushTxQueue()

	generateOpTypeHistory(tree, HistoryOpFormat)
	newTree := autoSpaceTree(tree)
	err = writeTreeUpsertQueue(newTree)
	if err != nil {
		return
	}
	invalidateDocumentHistory(newTree.ID)
	logging.LogInfof("formatted tree [%s]", rootID)
	util.RandomSleep(500, 700)
	return
}

func autoSpaceTree(tree *parse.Tree) *parse.Tree {
	luteEngine := NewLute()
	mindmapTypes := map[string]ast.NodeType{}
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		switch n.Type {
		case ast.NodeMindmap, ast.NodeMindmapItem:
			mindmapTypes[n.ID] = n.Type
		case ast.NodeTextMark:
			luteEngine.MergeSameTextMark(n) // 合并相邻的同类行级节点
		case ast.NodeCodeBlockCode:
			// 代码块中包含 ``` 时 `优化排版` 异常 `Optimize typography` exception when code block contains ``` https://github.com/siyuan-note/siyuan/issues/15843
			n.Tokens = bytes.ReplaceAll(n.Tokens, []byte(editor.Zwj+"```"), []byte("```"))
			n.Tokens = bytes.ReplaceAll(n.Tokens, []byte("```"), []byte(editor.Zwj+"```"))
		}
		return ast.WalkContinue
	})
	// Markdown 使用列表语法表示脑图，每次解析后按块 ID 恢复原生类型，正文中的普通列表保持不变。
	restoreMindmapTypes := func(tree *parse.Tree) {
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if entering && (n.Type == ast.NodeList || n.Type == ast.NodeListItem) {
				if typ, ok := mindmapTypes[n.ID]; ok {
					n.Type = typ
				}
			}
			return ast.WalkContinue
		})
	}

	rootIAL := tree.Root.KramdownIAL
	addBlockIALNodes(tree, false)

	// 第一次格式化为了合并相邻的文本节点
	formatRenderer := render.NewFormatRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	md := formatRenderer.Render()
	newTree := parseKTree(md)
	restoreMindmapTypes(newTree)
	newTree.Root.Spec = tree.Root.Spec
	// 第二次格式化启用自动空格
	luteEngine.SetAutoSpace(true)
	formatRenderer = render.NewFormatRenderer(newTree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	md = formatRenderer.Render()
	newTree = parseKTree(md)
	restoreMindmapTypes(newTree)
	newTree.Root.Spec = tree.Root.Spec
	newTree.Root.ID = tree.ID
	newTree.Root.KramdownIAL = rootIAL
	newTree.ID = tree.ID
	newTree.Path = tree.Path
	newTree.HPath = tree.HPath
	newTree.Box = tree.Box
	return newTree
}
