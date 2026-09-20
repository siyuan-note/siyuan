package model

import (
	"sort"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 将通过来源过滤的整篇文档条目展开为可独立排序的引用，保留列表项和标题等局部上下文。
func expandBacklinkDocumentEntries(blocks []*Block, refs []*sql.Ref, defRootID string, keywords []string,
	boxID string, originalRefBlockIDs map[string]string, mode int) []*Block {
	if mode != 1 && mode != 2 {
		return blocks
	}
	var result []*Block
	for _, block := range blocks {
		if block.Type != "NodeDocument" {
			result = append(result, block)
			continue
		}
		var documentRefs []*sql.Ref
		for _, ref := range refs {
			if ref.RootID == block.ID {
				documentRefs = append(documentRefs, ref)
			}
		}
		entries, _, _, mappings := buildLinkRefsInBoxWithDocumentGrouping(defRootID, removeDuplicatedRefs(documentRefs), keywords, boxID, false)
		for parentID, refID := range mappings {
			originalRefBlockIDs[parentID] = refID
		}
		result = append(result, entries...)
	}
	return result
}

// 在渲染高亮前提取每个展示条目内首个命中引用的锚文本，保留父块合并后的正文顺序。
func backlinkAnchorSortKeys(blocks []*Block, tree *parse.Tree, refs []*sql.Ref, originalRefBlockIDs map[string]string, mode int) map[string]string {
	if mode != 1 && mode != 2 {
		return nil
	}
	matched := map[string]map[string]bool{}
	for _, ref := range refs {
		if matched[ref.BlockID] == nil {
			matched[ref.BlockID] = map[string]bool{}
		}
		matched[ref.BlockID][ref.DefBlockID] = true
	}
	keys := map[string]string{}
	for _, block := range blocks {
		node := treenode.GetNodeInTree(tree, block.ID)
		if node == nil {
			continue
		}
		nodes, _ := getBacklinkRenderNodes(node, originalRefBlockIDs)
		found := false
		for _, root := range nodes {
			ast.Walk(root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if !entering || !treenode.IsBlockRef(n) {
					return ast.WalkContinue
				}
				defID, text, _ := treenode.GetBlockRef(n)
				parent := treenode.ParentBlock(n)
				if parent == nil || !matched[parent.ID][defID] {
					return ast.WalkContinue
				}
				keys[block.ID] = strings.TrimSpace(text)
				found = true
				return ast.WalkStop
			})
			if found {
				break
			}
		}
	}
	return keys
}

// 以正文顺序为稳定次序，缺少锚文本的条目在升序和降序中均置后。
func sortBacklinksByAnchor(backlinks []*Backlink, keys map[string]string, mode int) {
	if mode != 1 && mode != 2 {
		return
	}
	sort.SliceStable(backlinks, func(i, j int) bool {
		a, b := keys[backlinks[i].ID], keys[backlinks[j].ID]
		if a == "" || b == "" {
			return a != "" && b == ""
		}
		if mode == 2 {
			a, b = b, a
		}
		return util.NaturalCompare(a, b) && !util.NaturalCompare(b, a)
	})
}
