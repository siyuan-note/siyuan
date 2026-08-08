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

package model

import (
	"sort"
	"strings"

	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type backlinkParentMapping struct {
	parent        *Block
	refBlock      *Block
	coveredRefIDs map[string]bool
	coveredIDs    map[string]bool
}

func buildBacklinkParentMappings(refBlocks []*Block, boxID string) (ret []*backlinkParentMapping) {
	parentRefParagraphs := map[string][]*Block{}
	var paragraphParentIDs []string
	for _, refBlock := range refBlocks {
		if nil == refBlock || "NodeParagraph" != refBlock.Type {
			continue
		}

		parentRefParagraphs[refBlock.ParentID] = append(parentRefParagraphs[refBlock.ParentID], refBlock)
		paragraphParentIDs = append(paragraphParentIDs, refBlock.ParentID)
	}
	paragraphParentIDs = uniqueBacklinkStrings(paragraphParentIDs)
	sqlParagraphParents := sql.GetBlocksInBox(paragraphParentIDs, boxID)
	paragraphParents := fromSQLBlocks(&sqlParagraphParents, "", 12)

	luteEngine := util.NewLute()
	treeCache := map[string]*parse.Tree{}
	var mappings []*backlinkParentMapping
	for _, parent := range paragraphParents {
		if nil == parent {
			continue
		}

		refBlock := selectBacklinkParentRef(parent, parentRefParagraphs[parent.ID], boxID, luteEngine, treeCache)
		if nil == refBlock {
			continue
		}

		mappings = append(mappings, &backlinkParentMapping{
			parent:        parent,
			refBlock:      refBlock,
			coveredRefIDs: map[string]bool{},
			coveredIDs:    map[string]bool{parent.ID: true},
		})
	}

	propagatedDocIDs := map[string]bool{}
	for _, mapping := range mappings {
		if "NodeDocument" == mapping.parent.Type {
			propagatedDocIDs[mapping.parent.ID] = true
			for _, refBlock := range refBlocks {
				if nil != refBlock && refBlock.RootID == mapping.parent.ID {
					mapping.coveredRefIDs[refBlock.ID] = true
				}
			}
			ret = append(ret, mapping)
		}
	}

	var headingMappings []*backlinkParentMapping
	for _, mapping := range mappings {
		if "NodeHeading" != mapping.parent.Type || propagatedDocIDs[mapping.parent.RootID] {
			continue
		}

		mapping.coveredIDs = backlinkHeadingCoveredIDs(mapping.parent, boxID, treeCache)
		for _, refBlock := range refBlocks {
			if nil != refBlock && mapping.coveredIDs[refBlock.ID] {
				mapping.coveredRefIDs[refBlock.ID] = true
			}
		}
		headingMappings = append(headingMappings, mapping)
	}
	sort.SliceStable(headingMappings, func(i, j int) bool {
		return len(headingMappings[i].coveredIDs) > len(headingMappings[j].coveredIDs)
	})

	headingCoveredIDs := map[string]bool{}
	for _, mapping := range headingMappings {
		if headingCoveredIDs[mapping.parent.ID] {
			continue
		}

		ret = append(ret, mapping)
		for id := range mapping.coveredIDs {
			headingCoveredIDs[id] = true
		}
	}

	for _, mapping := range mappings {
		if "NodeDocument" == mapping.parent.Type || "NodeHeading" == mapping.parent.Type ||
			propagatedDocIDs[mapping.parent.RootID] || headingCoveredIDs[mapping.parent.ID] {
			continue
		}

		for _, refBlock := range parentRefParagraphs[mapping.parent.ID] {
			mapping.coveredRefIDs[refBlock.ID] = true
		}
		ret = append(ret, mapping)
	}
	return
}

func matchBacklinkParentMapping(mapping *backlinkParentMapping, refBlocksByID map[string]*Block, keywords []string,
	boxID string) bool {
	if matchBacklinkKeyword(mapping.parent, keywords) {
		return true
	}
	for refID := range mapping.coveredRefIDs {
		if refBlock := refBlocksByID[refID]; nil != refBlock && matchBacklinkKeyword(refBlock, keywords) {
			return true
		}
	}
	if 0 < len(keywords) && ("NodeDocument" == mapping.parent.Type || "NodeHeading" == mapping.parent.Type) {
		sqlBlocks := sql.GetChildBlocksInBox(mapping.parent.ID, "", -1, boxID)
		for _, block := range fromSQLBlocks(&sqlBlocks, "", 12) {
			if nil != block && matchBacklinkKeyword(block, keywords) {
				return true
			}
		}
	}
	return false
}

func selectBacklinkParentRef(parent *Block, refBlocks []*Block, boxID string, luteEngine *lute.Lute,
	treeCache map[string]*parse.Tree) *Block {
	if "NodeListItem" == parent.Type {
		for _, refBlock := range refBlocks {
			if parent.FContent == refBlock.Content {
				return refBlock
			}
		}
		for _, refBlock := range refBlocks {
			if isPureBlockRefParagraph(refBlock, luteEngine) {
				return refBlock
			}
		}
		return nil
	}

	for _, refBlock := range refBlocks {
		switch parent.Type {
		case "NodeBlockquote", "NodeSuperBlock", "NodeCallout":
			return refBlock
		case "NodeDocument", "NodeHeading":
			if isPureBlockRefParagraph(refBlock, luteEngine) &&
				isFirstBacklinkParentParagraph(refBlock, parent, boxID, treeCache) {
				return refBlock
			}
		}
	}
	return nil
}

func isPureBlockRefParagraph(block *Block, luteEngine *lute.Lute) bool {
	if nil == block || "NodeParagraph" != block.Type {
		return false
	}

	inlineTree := parse.Inline("", []byte(block.Markdown), luteEngine.ParseOptions)
	if nil == inlineTree || nil == inlineTree.Root.FirstChild {
		return false
	}

	hasBlockRef := false
	for node := inlineTree.Root.FirstChild.FirstChild; nil != node; node = node.Next {
		if treenode.IsBlockRef(node) {
			hasBlockRef = true
			continue
		}
		if ast.NodeText == node.Type && "" == strings.TrimSpace(node.Text()) {
			continue
		}
		return false
	}
	return hasBlockRef
}

func isFirstBacklinkParentParagraph(refBlock, parent *Block, boxID string, treeCache map[string]*parse.Tree) bool {
	tree := backlinkRefTree(refBlock, boxID, treeCache)
	if nil == tree {
		return false
	}

	node := treenode.GetNodeInTree(tree, refBlock.ID)
	if nil == node {
		return false
	}
	return isFirstBacklinkParentParagraphNode(node, parent)
}

func isFirstBacklinkParentParagraphNode(node *ast.Node, parent *Block) bool {
	previous := treenode.PreviousBlock(node)
	if "NodeDocument" == parent.Type {
		actualParent := treenode.ParentBlock(node)
		return nil != actualParent && actualParent.ID == parent.ID && nil == previous
	}
	return "NodeHeading" == parent.Type && nil != previous && previous.ID == parent.ID
}

func backlinkHeadingCoveredIDs(parent *Block, boxID string, treeCache map[string]*parse.Tree) (ret map[string]bool) {
	ret = map[string]bool{parent.ID: true}
	tree := backlinkRefTree(parent, boxID, treeCache)
	if nil == tree {
		return
	}

	heading := treenode.GetNodeInTree(tree, parent.ID)
	if nil == heading || ast.NodeHeading != heading.Type {
		return
	}

	for _, child := range treenode.HeadingChildren(heading) {
		ast.Walk(child, func(node *ast.Node, entering bool) ast.WalkStatus {
			if entering && "" != node.ID && node.IsBlock() {
				ret[node.ID] = true
			}
			return ast.WalkContinue
		})
	}
	return
}

func backlinkRefTree(block *Block, boxID string, treeCache map[string]*parse.Tree) *parse.Tree {
	if nil == block {
		return nil
	}
	if tree, ok := treeCache[block.RootID]; ok {
		return tree
	}

	tree, _ := loadTreeByBlockIDInBox(block.RootID, boxID)
	treeCache[block.RootID] = tree
	return tree
}

func uniqueBacklinkStrings(values []string) (ret []string) {
	seen := map[string]bool{}
	for _, value := range values {
		if seen[value] {
			continue
		}
		seen[value] = true
		ret = append(ret, value)
	}
	return
}

func mergeBacklinkRefDefs(refDefs []*RefDefs) (ret []*RefDefs) {
	ret = []*RefDefs{}
	merged := map[string]*RefDefs{}
	for _, refDef := range refDefs {
		if nil == refDef {
			continue
		}

		existing := merged[refDef.RefID]
		if nil == existing {
			existing = &RefDefs{RefID: refDef.RefID, DefIDs: []string{}}
			merged[refDef.RefID] = existing
			ret = append(ret, existing)
		}
		existing.DefIDs = uniqueBacklinkStrings(append(existing.DefIDs, refDef.DefIDs...))
	}
	return
}
