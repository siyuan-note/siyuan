// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 正文引用直接从事务快照提取，避免异步引用索引尚未更新时漏收或使用旧的块结构。
func collectionReferenceMatches(source *av.AutomationBlockSource, tree *parse.Tree,
	attributes []func(*ast.Node) bool) map[string]bool {
	matched := map[string]bool{}
	nodes := collectionNodes(tree)
	boxID := ""
	if IsEncryptedBox(tree.Box) {
		boxID = tree.Box
	}
	target := attributeViewBindingBlockTree(source.ReferenceID, boxID)
	if target == nil {
		return matched
	}
	refs := map[string]bool{}
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if node.Type == ast.NodeCustomBlock || node.Type == ast.NodeAttributeView {
			return ast.WalkSkipChildren
		}
		if !treenode.IsBlockRef(node) {
			return ast.WalkContinue
		}
		id, _, _ := treenode.GetBlockRef(node)
		matches := id == source.ReferenceID
		if !matches && target.Type == "d" {
			definition := attributeViewBindingBlockTree(id, boxID)
			matches = definition != nil && definition.RootID == source.ReferenceID
		}
		if block := treenode.ParentBlock(node); matches && block != nil && collectionTagsMatch(source, block) {
			refs[block.ID] = true
		}
		return ast.WalkContinue
	})
	luteEngine := util.NewLute()
	blocks := map[string]*Block{}
	blockFor := func(node *ast.Node) *Block {
		if block := blocks[node.ID]; block != nil {
			return block
		}
		block := &Block{ID: node.ID, RootID: tree.ID, Type: node.Type.String()}
		parent := treenode.HeadingParent(node)
		if parent == nil {
			parent = treenode.ParentBlock(node)
		}
		if parent != nil {
			block.ParentID = parent.ID
		}
		if node.Type == ast.NodeParagraph {
			block.Content = sql.NodeStaticContent(node, nil, true, false, true)
			block.Markdown = treenode.ExportNodeStdMd(node, luteEngine)
		} else if node.Type == ast.NodeListItem {
			block.FContent = sql.NodeStaticContent(treenode.FirstLeafBlock(node), nil, true, false, true)
		}
		blocks[node.ID] = block
		return block
	}
	var refBlocks, parents []*Block
	parentRefs := map[string][]*Block{}
	for id := range refs {
		node := nodes[id]
		if node == nil {
			continue
		}
		block := blockFor(node)
		refBlocks = append(refBlocks, block)
		if node.Type != ast.NodeParagraph {
			continue
		}
		if parent := nodes[block.ParentID]; parent != nil {
			if len(parentRefs[parent.ID]) == 0 {
				parents = append(parents, blockFor(parent))
			}
			parentRefs[parent.ID] = append(parentRefs[parent.ID], block)
		}
	}
	treeCache := map[string]*parse.Tree{tree.ID: tree}
	mappings := buildBacklinkParentMappingsForSources(refBlocks, parentRefs, parents, true,
		func(parent *Block, refs []*Block) *Block {
			return selectBacklinkParentRef(parent, refs, boxID, luteEngine, treeCache)
		}, func(parent *Block) map[string]bool {
			return backlinkHeadingCoveredIDs(parent, boxID, treeCache)
		})
	covered := map[string]bool{}
	add := func(id string) {
		if node := nodes[id]; node != nil && collectionBlockConditionsMatch(source, node, attributes) {
			matched[id] = true
		}
	}
	for _, mapping := range mappings {
		for id := range mapping.coveredRefIDs {
			covered[id] = true
		}
		add(mapping.parent.ID)
	}
	for id := range refs {
		if !covered[id] {
			add(id)
		}
	}
	return matched
}
