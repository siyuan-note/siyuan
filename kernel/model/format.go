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
	"bytes"
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

	var blocks []*ast.Node
	var rootIAL [][]string
	// 添加 block ial，后面格式化渲染需要
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !n.IsBlock() {
			return ast.WalkContinue
		}

		if ast.NodeDocument == n.Type {
			rootIAL = n.KramdownIAL
			return ast.WalkContinue
		}

		if ast.NodeBlockQueryEmbed == n.Type {
			if script := n.ChildByType(ast.NodeBlockQueryEmbedScript); nil != script {
				script.Tokens = bytes.ReplaceAll(script.Tokens, []byte("\n"), []byte(" "))
			}
		}

		if 0 < len(n.KramdownIAL) {
			blocks = append(blocks, n)
		}
		return ast.WalkContinue
	})
	for _, block := range blocks {
		block.InsertAfter(&ast.Node{Type: ast.NodeKramdownBlockIAL, Tokens: parse.IAL2Tokens(block.KramdownIAL)})
	}

	luteEngine := NewLute()
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
