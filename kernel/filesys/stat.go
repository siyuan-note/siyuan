// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"bytes"
	"errors"
	"strings"

	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 字数统计的输入上限：BlockDOM 嵌套越深，解析耗时增长越快，需要在进入解析器前拦截。
const (
	maxContentStatBytes = 8 << 20
	maxContentStatDepth = 256
)

var (
	errContentStatTooLarge = errors.New("content is too large")
	errContentStatTooDeep  = errors.New("content is too deeply nested")

	voidBlockDOMElements = map[string]bool{
		"area": true, "base": true, "br": true, "col": true, "embed": true, "hr": true, "img": true,
		"input": true, "link": true, "meta": true, "param": true, "source": true, "track": true, "wbr": true,
	}
)

// ValidateContentStatContent 校验字数统计输入的长度与 BlockDOM 嵌套深度，超限时返回错误。
func ValidateContentStatContent(content string) error {
	if maxContentStatBytes < len(content) {
		return errContentStatTooLarge
	}
	if maxContentStatDepth < blockDOMDepth(content) {
		return errContentStatTooDeep
	}
	return nil
}

// blockDOMDepth 按标签开合统计 BlockDOM 的最大嵌套深度，忽略注释、声明、自闭合标签与 void 元素。
func blockDOMDepth(content string) (maxDepth int) {
	depth := 0
	for i := 0; i < len(content); i++ {
		if '<' != content[i] {
			continue
		}

		rest := content[i:]
		if strings.HasPrefix(rest, "<!--") {
			end := strings.Index(rest, "-->")
			if 0 > end {
				return
			}
			i += end + 2
			continue
		}

		end := strings.IndexByte(rest, '>')
		if 0 > end {
			return
		}
		i += end
		if 2 > end {
			continue
		}

		switch rest[1] {
		case '!', '?':
			continue
		case '/':
			if 0 < depth {
				depth--
			}
			continue
		}

		if '/' == rest[end-1] {
			continue
		}

		name := rest[1:end]
		if k := strings.IndexAny(name, " \t\r\n/>"); 0 <= k {
			name = name[:k]
		}
		if voidBlockDOMElements[strings.ToLower(name)] {
			continue
		}

		depth++
		if maxDepth < depth {
			maxDepth = depth
			if maxContentStatDepth < maxDepth {
				return
			}
		}
	}
	return
}

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
				case av.KeyTypeLocation:
					content.WriteString(v.String(false))
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
		ret.BlockCount++
	}
	return
}
