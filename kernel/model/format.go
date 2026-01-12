// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"bytes"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/editor"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/treenode"
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
	luteEngine := NewLute()
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		switch n.Type {
		case ast.NodeTextMark:
			luteEngine.MergeSameTextMark(n) // 合并相邻的同类行级节点
		case ast.NodeCodeBlockCode:
			// 代码块中包含 ``` 时 `优化排版` 异常 `Optimize typography` exception when code block contains ``` https://github.com/siyuan-note/siyuan/issues/15843
			n.Tokens = bytes.ReplaceAll(n.Tokens, []byte(editor.Zwj+"```"), []byte("```"))
			n.Tokens = bytes.ReplaceAll(n.Tokens, []byte("```"), []byte(editor.Zwj+"```"))
		}
		return ast.WalkContinue
	})

	rootIAL := tree.Root.KramdownIAL
	addBlockIALNodes(tree, false)

	// 第一次格式化为了合并相邻的文本节点
	formatRenderer := render.NewFormatRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	md := formatRenderer.Render()
	newTree := parseKTree(md)
	newTree.Root.Spec = treenode.CurrentSpec
	// 第二次格式化启用自动空格
	luteEngine.SetAutoSpace(true)
	formatRenderer = render.NewFormatRenderer(newTree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	md = formatRenderer.Render()
	newTree = parseKTree(md)
	newTree.Root.Spec = treenode.CurrentSpec
	newTree.Root.ID = tree.ID
	newTree.Root.KramdownIAL = rootIAL
	newTree.ID = tree.ID
	newTree.Path = tree.Path
	newTree.HPath = tree.HPath
	newTree.Box = tree.Box
	err = writeTreeUpsertQueue(newTree)
	if err != nil {
		return
	}
	logging.LogInfof("formatted tree [%s]", rootID)
	util.RandomSleep(500, 700)
	return
}
