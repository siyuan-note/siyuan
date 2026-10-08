// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// markdownExportReferences 按本次导出的文档集合区分文件链接和脚注，并记录正文及脚注需要的锚点。
// 单文件预览和内容导出使用 nil，外部引用全部按脚注处理。
type markdownExportReferences struct {
	docIDs    map[string]bool
	anchorIDs map[string]bool
}

func (refs *markdownExportReferences) contains(defID, sourceBoxID string) bool {
	if refs == nil {
		return false
	}
	var bt *treenode.BlockTree
	if IsEncryptedBox(sourceBoxID) {
		bt = treenode.GetBlockTreeInExactBox(defID, sourceBoxID)
	} else {
		bt = treenode.GetBlockTree(defID)
	}
	return bt != nil && IsSameCryptoBoundary(sourceBoxID, bt.BoxID) && refs.docIDs[bt.RootID]
}

// prepareMarkdownExportReferences 在输出任何文件前收集锚点，避免脚注引用的目标已先行输出而缺失锚点。
func prepareMarkdownExportReferences(docPaths []string, defBlockIDs []string, config conf.Export) (*markdownExportReferences, error) {
	refs := &markdownExportReferences{docIDs: map[string]bool{}, anchorIDs: map[string]bool{}}
	for _, docPath := range docPaths {
		refs.docIDs[util.GetTreeID(docPath)] = true
	}
	for _, id := range defBlockIDs {
		refs.anchorIDs[id] = true
	}
	for _, docPath := range docPaths {
		tree, err := LoadTreeByBlockID(util.GetTreeID(docPath))
		if err != nil {
			return nil, err
		}
		depth := 0
		resolveEmbedR(tree.Root, config.BlockEmbedMode, NewLute(), &[]string{}, &depth)
		collectMarkdownExportReferences(tree, refs)
	}
	return refs, nil
}

func collectMarkdownExportReferences(tree *parse.Tree, refs *markdownExportReferences) {
	finishTabTitles := treenode.MaterializeTabTitles(tree.Root)
	defer finishTabTitles()
	var order []string
	footnotes := map[string]*refAsFootnotes{}
	depth := 0
	collectFootnotesDefs0(tree, tree.Root, &order, footnotes, &depth, refs)
}
