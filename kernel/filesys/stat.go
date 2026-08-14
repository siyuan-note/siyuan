// SiYuan - From thought to insight, with agents
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

package filesys

import (
	"bytes"

	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func ContentStat(content string) (ret *util.BlockStatResult) {
	luteEngine := util.NewLute()
	return contentStat(content, luteEngine)
}

func contentStat(content string, luteEngine *lute.Lute) (ret *util.BlockStatResult) {
	tree := luteEngine.BlockDOM2Tree(content)
	runeCnt, wordCnt, linkCnt, imgCnt, refCnt := tree.Root.Stat()
	return &util.BlockStatResult{
		RuneCount:  runeCnt,
		WordCount:  wordCnt,
		LinkCount:  linkCnt,
		ImageCount: imgCnt,
		RefCount:   refCnt,
	}
}

func StatBlock(id string) (ret *util.BlockStatResult) {
	trees := LoadTrees([]string{id})
	if 1 > len(trees) {
		return
	}

	tree := trees[id]
	if nil == tree {
		return
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		return
	}

	if ast.NodeDocument == node.Type {
		return statTree(tree)
	}

	runeCnt, wordCnt, linkCnt, imgCnt, refCnt := node.Stat()
	ret = &util.BlockStatResult{
		RuneCount:  runeCnt,
		WordCount:  wordCnt,
		LinkCount:  linkCnt,
		ImageCount: imgCnt,
		RefCount:   refCnt,
		BlockCount: 1,
	}
	return
}

func StatTree(id string) (ret *util.BlockStatResult) {
	trees := LoadTrees([]string{id})
	if 1 > len(trees) {
		return
	}

	tree := trees[id]
	if nil == tree {
		return
	}

	return statTree(tree)
}

// StatTreeInBox 只统计指定笔记本边界内的文档。
func StatTreeInBox(id, boxID string) (ret *util.BlockStatResult) {
	bt := treenode.GetBlockTreeInExactBox(id, boxID)
	if bt == nil {
		return nil
	}
	tree, err := LoadTree(bt.BoxID, bt.Path, util.NewLute())
	if err != nil {
		return nil
	}
	return statTree(tree)
}

// StatTreeFromTree 统计整棵文档树。
func StatTreeFromTree(tree *parse.Tree) (ret *util.BlockStatResult) {
	if nil == tree || nil == tree.Root {
		return
	}
	return StatNodes(tree, []*ast.Node{tree.Root})
}

func statTree(tree *parse.Tree) (ret *util.BlockStatResult) {
	return StatTreeFromTree(tree)
}

// StatNodes 统计指定节点及其子节点。
func StatNodes(tree *parse.Tree, nodes []*ast.Node) (ret *util.BlockStatResult) {
	if nil == tree {
		return
	}

	blockCount := 0
	var databaseBlockNodes []*ast.Node
	for _, node := range nodes {
		if nil == node {
			continue
		}
		ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}

			if n.IsBlock() && ast.NodeDocument != n.Type {
				blockCount++
			}

			if ast.NodeAttributeView == n.Type {
				databaseBlockNodes = append(databaseBlockNodes, n)
			}
			return ast.WalkContinue
		})
	}

	luteEngine := util.NewLute()
	var dbRuneCnt, dbWordCnt, dbLinkCnt, dbImgCnt, dbRefCnt int
	for _, n := range databaseBlockNodes {
		if "" == n.AttributeViewID {
			continue
		}

		var attrView *av.AttributeView
		if av.AVIsEncryptedBox != nil && av.AVIsEncryptedBox(tree.Box) {
			attrView, _ = av.ParseAttributeViewInBox(n.AttributeViewID, tree.Box)
		} else {
			attrView, _ = av.ParseAttributeView(n.AttributeViewID)
		}
		if nil == attrView {
			continue
		}

		content := bytes.Buffer{}
		for _, kValues := range attrView.KeyValues {
			for _, v := range kValues.Values {
				switch kValues.Key.Type {
				case av.KeyTypeURL:
					if v.IsBlank() {
						continue
					}

					dbLinkCnt++
					content.WriteString(v.URL.Content)
				case av.KeyTypeMAsset:
					if v.IsBlank() {
						continue
					}

					for _, asset := range v.MAsset {
						if av.AssetTypeImage == asset.Type {
							dbImgCnt++
						}
					}
				case av.KeyTypeBlock:
					if v.IsBlank() {
						continue
					}

					if !v.IsDetached {
						dbRefCnt++
					}
					content.WriteString(v.Block.Content)
				case av.KeyTypeText:
					if v.IsBlank() {
						continue
					}
					content.WriteString(v.Text.Content)
				case av.KeyTypeNumber:
					if v.IsBlank() {
						continue
					}
					v.Number.FormatNumber()
					content.WriteString(v.Number.FormattedContent)
				case av.KeyTypeEmail:
					if v.IsBlank() {
						continue
					}
					content.WriteString(v.Email.Content)
				case av.KeyTypePhone:
					if v.IsBlank() {
						continue
					}
					content.WriteString(v.Phone.Content)
				}
			}
		}

		dbStat := contentStat(content.String(), luteEngine)
		dbRuneCnt += dbStat.RuneCount
		dbWordCnt += dbStat.WordCount
	}

	var runeCnt, wordCnt, linkCnt, imgCnt, refCnt int
	for _, node := range nodes {
		if nil == node {
			continue
		}
		nodeRuneCnt, nodeWordCnt, nodeLinkCnt, nodeImgCnt, nodeRefCnt := node.Stat()
		runeCnt += nodeRuneCnt
		wordCnt += nodeWordCnt
		linkCnt += nodeLinkCnt
		imgCnt += nodeImgCnt
		refCnt += nodeRefCnt
	}
	runeCnt += dbRuneCnt
	wordCnt += dbWordCnt
	linkCnt += dbLinkCnt
	imgCnt += dbImgCnt
	refCnt += dbRefCnt
	return &util.BlockStatResult{
		RuneCount:  runeCnt,
		WordCount:  wordCnt,
		LinkCount:  linkCnt,
		ImageCount: imgCnt,
		RefCount:   refCnt,
		BlockCount: blockCount,
	}
}

func BlocksWordCount(ids []string) (ret *util.BlockStatResult) {
	ret = &util.BlockStatResult{}
	trees := LoadTrees(ids)
	for _, id := range ids {
		tree := trees[id]
		if nil == tree {
			continue
		}

		node := treenode.GetNodeInTree(tree, id)
		if nil == node {
			continue
		}

		runeCnt, wordCnt, linkCnt, imgCnt, refCnt := node.Stat()
		ret.RuneCount += runeCnt
		ret.WordCount += wordCnt
		ret.LinkCount += linkCnt
		ret.ImageCount += imgCnt
		ret.RefCount += refCnt
	}
	ret.BlockCount = len(ids)
	return
}
