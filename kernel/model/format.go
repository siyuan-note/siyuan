// SiYuan - Build Your Eternal Digital Garden
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
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func AutoSpace(rootID string) (err error) {
	tree, err := loadTreeByBlockID(rootID)
	if nil != err {
		return
	}

	util.PushEndlessProgress(Conf.Language(116))
	defer util.ClearPushProgress(100)

	generateFormatHistory(tree)

	luteEngine := NewLute()
	// 合并相邻的同类行级节点
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering {
			switch n.Type {
			case ast.NodeStrong, ast.NodeEmphasis, ast.NodeStrikethrough, ast.NodeUnderline:
				luteEngine.MergeSameSpan(n, n.Type)
			}
		}
		return ast.WalkContinue
	})

	// 合并相邻的文本节点
	for {
		var unlinks []*ast.Node
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if entering && ast.NodeText == n.Type && nil != n.Next && ast.NodeText == n.Next.Type {
				n.Tokens = append(n.Tokens, n.Next.Tokens...)
				unlinks = append(unlinks, n.Next)
			}
			return ast.WalkContinue
		})
		for _, n := range unlinks {
			n.Unlink()
		}
		if 1 > len(unlinks) {
			break
		}
	}

	rootIAL := tree.Root.KramdownIAL
	addBlockIALNodes(tree, false)

	luteEngine.SetAutoSpace(true)
	formatRenderer := render.NewFormatRenderer(tree, luteEngine.RenderOptions)
	md := formatRenderer.Render()
	newTree := parseKTree(md)
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
	sql.WaitForWritingDatabase()
	return
}

func generateFormatHistory(tree *parse.Tree) {
	historyDir, err := util.GetHistoryDir("format")
	if nil != err {
		util.LogErrorf("get history dir failed: %s", err)
		return
	}

	historyPath := filepath.Join(historyDir, tree.Box, tree.Path)
	if err = os.MkdirAll(filepath.Dir(historyPath), 0755); nil != err {
		util.LogErrorf("generate history failed: %s", err)
		return
	}

	var data []byte
	if data, err = filelock.NoLockFileRead(filepath.Join(util.DataDir, tree.Box, tree.Path)); err != nil {
		util.LogErrorf("generate history failed: %s", err)
		return
	}

	if err = gulu.File.WriteFileSafer(historyPath, data, 0644); err != nil {
		util.LogErrorf("generate history failed: %s", err)
		return
	}

}
