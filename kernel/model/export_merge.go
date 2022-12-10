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
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
)

func mergeSubDocs(rootTree *parse.Tree) (ret *parse.Tree, err error) {
	ret = rootTree
	rootBlock := &Block{Box: rootTree.Box, ID: rootTree.ID, Path: rootTree.Path}
	if err = buildBlockChildren(rootBlock); nil != err {
		return
	}

	for i := 0; i < 1024; i++ {
		if err = walkBlock(ret, rootBlock); nil != err {
			return
		}

		if nil == rootBlock.Children {
			break
		}
	}
	return
}

func walkBlock(tree *parse.Tree, block *Block) (err error) {
	for _, c := range block.Children {
		if err = walkBlock(tree, c); nil != err {
			return
		}
	}

	for i := len(block.Children) - 1; -1 < i; i-- {
		c := block.Children[i]
		nodes, loadErr := loadTreeNodes(c.Box, c.Path)
		if nil != loadErr {
			return
		}

		for j := len(nodes) - 1; -1 < j; j-- {
			tree.Root.LastChild.InsertAfter(nodes[j])
		}
	}
	block.Children = nil
	return
}

func loadTreeNodes(box string, p string) (ret []*ast.Node, err error) {
	tree, err := LoadTree(box, p)
	if nil != err {
		return
	}

	for c := tree.Root.FirstChild; nil != c; c = c.Next {
		ret = append(ret, c)
	}
	return
}

func buildBlockChildren(block *Block) (err error) {
	files, _, err := ListDocTree(block.Box, block.Path, Conf.FileTree.Sort)
	if nil != err {
		return
	}

	for _, f := range files {
		childBlock := &Block{Box: block.Box, ID: f.ID, Path: f.Path}
		block.Children = append(block.Children, childBlock)
	}

	for _, c := range block.Children {
		if err = buildBlockChildren(c); nil != err {
			return
		}
	}
	return
}
