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
	"os"
	"path/filepath"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func AutoSpace(rootID string) (err error) {
	tree, err := loadTreeByBlockID(rootID)
	if nil != err {
		return
	}

	util.PushProtyleLoading(rootID, Conf.Language(116))
	defer util.PushProtyleReload(rootID)

	WaitForWritingFiles()

	generateFormatHistory(tree)
	luteEngine := NewLute()
	// 合并相邻的同类行级节点
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering {
			switch n.Type {
			case ast.NodeTextMark:
				luteEngine.MergeSameTextMark(n)
			}
		}
		return ast.WalkContinue
	})

	rootIAL := tree.Root.KramdownIAL
	addBlockIALNodes(tree, false)

	// 第一次格式化为了合并相邻的文本节点
	formatRenderer := render.NewFormatRenderer(tree, luteEngine.RenderOptions)
	md := formatRenderer.Render()
	newTree := parseKTree(md)
	newTree.Root.Spec = "1"
	// 第二次格式化启用自动空格
	luteEngine.SetAutoSpace(true)
	formatRenderer = render.NewFormatRenderer(newTree, luteEngine.RenderOptions)
	md = formatRenderer.Render()
	newTree = parseKTree(md)
	newTree.Root.Spec = "1"
	newTree.Root.ID = tree.ID
	newTree.Root.KramdownIAL = rootIAL
	newTree.ID = tree.ID
	newTree.Path = tree.Path
	newTree.HPath = tree.HPath
	newTree.Box = tree.Box
	err = writeJSONQueue(newTree)
	if nil != err {
		return
	}
	util.RandomSleep(500, 700)
	return
}

func generateFormatHistory(tree *parse.Tree) {
	historyDir, err := GetHistoryDir(HistoryOpFormat)
	if nil != err {
		logging.LogErrorf("get history dir failed: %s", err)
		return
	}

	historyPath := filepath.Join(historyDir, tree.Box, tree.Path)
	if err = os.MkdirAll(filepath.Dir(historyPath), 0755); nil != err {
		logging.LogErrorf("generate history failed: %s", err)
		return
	}

	var data []byte
	if data, err = filelock.ReadFile(filepath.Join(util.DataDir, tree.Box, tree.Path)); err != nil {
		logging.LogErrorf("generate history failed: %s", err)
		return
	}

	if err = gulu.File.WriteFileSafer(historyPath, data, 0644); err != nil {
		logging.LogErrorf("generate history failed: %s", err)
		return
	}

	indexHistoryDir(filepath.Base(historyDir), util.NewLute())
}
