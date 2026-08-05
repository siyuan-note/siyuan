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
	"bytes"
	"fmt"
	"html"
	"path"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/editor"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/open-spaced-repetition/go-fsrs/v3"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// Block 描述了内容块。
type Block struct {
	Box      string            `json:"box"`
	Path     string            `json:"path"`
	HPath    string            `json:"hPath"`
	ID       string            `json:"id"`
	RootID   string            `json:"rootID"`
	ParentID string            `json:"parentID"`
	Name     string            `json:"name"`
	Alias    string            `json:"alias"`
	Memo     string            `json:"memo"`
	Tag      string            `json:"tag"`
	Content  string            `json:"content"`
	Number   string            `json:"number,omitempty"`
	FContent string            `json:"fcontent"`
	Markdown string            `json:"markdown"`
	Folded   bool              `json:"folded"`
	Type     string            `json:"type"`
	SubType  string            `json:"subType"`
	RefText  string            `json:"refText"`
	Defs     []*Block          `json:"-"`    // 当前块引用了这些块，避免序列化 JSON 时产生循环引用
	Refs     []*Block          `json:"refs"` // 当前块被这些块引用
	DefID    string            `json:"defID"`
	DefPath  string            `json:"defPath"`
	IAL      map[string]string `json:"ial"`
	Children []*Block          `json:"children"`
	Depth    int               `json:"depth"`
	Count    int               `json:"count"`
	RefCount int               `json:"refCount"`
	Sort     int               `json:"sort"`
	Created  string            `json:"created"`
	Updated  string            `json:"updated"`

	RiffCardID string    `json:"riffCardID"`
	RiffCard   *RiffCard `json:"riffCard"`
}

type RiffCard struct {
	Due        time.Time  `json:"due"`
	Reps       uint64     `json:"reps"`
	Lapses     uint64     `json:"lapses"`
	State      fsrs.State `json:"state"`
	LastReview time.Time  `json:"lastReview"`
}

func (block *Block) IsContainerBlock() bool {
	switch block.Type {
	case "NodeDocument", "NodeBlockquote", "NodeList", "NodeListItem", "NodeSuperBlock", "NodeCallout":
		return true
	}
	return false
}

func (block *Block) IsDoc() bool {
	return "NodeDocument" == block.Type
}

type Path struct {
	ID       string   `json:"id"`                 // 块 ID
	Box      string   `json:"box"`                // 块 Box
	Name     string   `json:"name"`               // 当前路径
	Number   string   `json:"number,omitempty"`   // 标题编号
	HPath    string   `json:"hPath"`              // 人类可读路径
	Type     string   `json:"type"`               // "path"
	NodeType string   `json:"nodeType"`           // 节点类型
	SubType  string   `json:"subType"`            // 节点子类型
	Blocks   []*Block `json:"blocks,omitempty"`   // 子块节点
	Children []*Path  `json:"children,omitempty"` // 子路径节点
	Depth    int      `json:"depth"`              // 层级深度
	Count    int      `json:"count"`              // 子块计数
	Folded   bool     `json:"folded"`             // 是否折叠

	Updated string `json:"updated"` // 更新时间
	Created string `json:"created"` // 创建时间
}

type blockRefCheckGroup struct {
	blockIDs        map[string]struct{}
	rootIDs         map[string]struct{}
	deletedBlockIDs map[string]struct{}
	deletedRootIDs  map[string]struct{}
}

func newBlockRefCheckGroup() *blockRefCheckGroup {
	return &blockRefCheckGroup{
		blockIDs:        map[string]struct{}{},
		rootIDs:         map[string]struct{}{},
		deletedBlockIDs: map[string]struct{}{},
		deletedRootIDs:  map[string]struct{}{},
	}
}

// CheckBlockRef 检查将被删除的块是否被引用或绑定到仍存在的数据库。
func CheckBlockRef(ids []string) bool {
	ret, _ := CheckBlockRefInBox(ids, nil, ids, "")
	return ret
}

// CheckBlockRefInBox 检查受影响块的引用，并检查实际删除块的数据库绑定。
func CheckBlockRefInBox(ids, exactIDs, deletedIDs []string, boxID string) (ret bool, err error) {
	sql.FlushQueue()
	ids = filterNonEmptyBlockRefCheckIDs(ids)
	exactIDs = filterNonEmptyBlockRefCheckIDs(exactIDs)
	deletedIDs = filterNonEmptyBlockRefCheckIDs(deletedIDs)
	if 1 > len(ids) {
		return
	}

	var bts map[string]*treenode.BlockTree
	if "" == boxID {
		bts = treenode.GetBlockTrees(ids)
	} else {
		bts = treenode.GetBlockTreesInBox(ids, boxID)
	}
	if len(bts) != len(ids) {
		return false, ErrBlockNotFound
	}

	group := newBlockRefCheckGroup()
	exactIDSet := map[string]struct{}{}
	for _, id := range exactIDs {
		exactIDSet[id] = struct{}{}
	}
	deletedIDSet := map[string]struct{}{}
	for _, id := range deletedIDs {
		deletedIDSet[id] = struct{}{}
	}
	selectedByRoot := map[string]map[string]map[string]struct{}{}
	deletedByRoot := map[string]map[string]map[string]struct{}{}
	for _, bt := range bts {
		if "d" == bt.Type && bt.ID == bt.RootID {
			group.rootIDs[bt.ID] = struct{}{}
			if _, deleted := deletedIDSet[bt.ID]; deleted {
				group.deletedRootIDs[bt.ID] = struct{}{}
			}
			continue
		}
		group.blockIDs[bt.ID] = struct{}{}
		if _, deleted := deletedIDSet[bt.ID]; deleted {
			group.deletedBlockIDs[bt.ID] = struct{}{}
		}
		if _, exact := exactIDSet[bt.ID]; exact {
			continue
		}
		if nil == selectedByRoot[bt.BoxID] {
			selectedByRoot[bt.BoxID] = map[string]map[string]struct{}{}
		}
		if nil == selectedByRoot[bt.BoxID][bt.RootID] {
			selectedByRoot[bt.BoxID][bt.RootID] = map[string]struct{}{}
		}
		selectedByRoot[bt.BoxID][bt.RootID][bt.ID] = struct{}{}
		if _, deleted := deletedIDSet[bt.ID]; deleted {
			if nil == deletedByRoot[bt.BoxID] {
				deletedByRoot[bt.BoxID] = map[string]map[string]struct{}{}
			}
			if nil == deletedByRoot[bt.BoxID][bt.RootID] {
				deletedByRoot[bt.BoxID][bt.RootID] = map[string]struct{}{}
			}
			deletedByRoot[bt.BoxID][bt.RootID][bt.ID] = struct{}{}
		}
	}

	// blocktrees 的父子关系用于展开列表、引述、超级块等容器后代。
	for treeBoxID, selectedRoots := range selectedByRoot {
		for rootID, selected := range selectedRoots {
			deleted := deletedByRoot[treeBoxID][rootID]
			rootTrees := treenode.GetBlockTreesByRootIDInBox(rootID, treeBoxID)
			expandBlockRefCheckDescendants(group, selected, deleted, rootTrees)
		}
	}
	return existBlockRefGroup(group)
}

func expandBlockRefCheckDescendants(group *blockRefCheckGroup, selected, deleted map[string]struct{},
	rootTrees []*treenode.BlockTree) {
	byID := map[string]*treenode.BlockTree{}
	for _, bt := range rootTrees {
		if nil == bt || "" == strings.TrimSpace(bt.ID) {
			continue
		}
		byID[bt.ID] = bt
	}
	for _, bt := range rootTrees {
		if nil == bt || "" == strings.TrimSpace(bt.ID) {
			continue
		}
		current := bt
		affectedBySelected := false
		affectedByDeleted := false
		for nil != current && "" != current.ParentID {
			if _, ok := selected[current.ParentID]; ok {
				affectedBySelected = true
			}
			if _, ok := deleted[current.ParentID]; ok {
				affectedByDeleted = true
			}
			if affectedBySelected && affectedByDeleted {
				break
			}
			current = byID[current.ParentID]
		}
		if affectedBySelected {
			group.blockIDs[bt.ID] = struct{}{}
		}
		if affectedByDeleted {
			group.deletedBlockIDs[bt.ID] = struct{}{}
		}
	}
}

func filterNonEmptyBlockRefCheckIDs(ids []string) (ret []string) {
	seen := map[string]struct{}{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if "" == id {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		ret = append(ret, id)
	}
	return
}

// CheckDocsRef 检查文档删除时会递归移除的全部文档。
func CheckDocsRef(paths []string) (ret bool, err error) {
	FlushTxQueue()
	sql.FlushQueue()
	if _, err = getBoxesByPathsStrict(paths); err != nil {
		return
	}
	paths = util.FilterSelfChildDocs(paths)
	pathsBoxes := getBoxesByPaths(paths)
	group := newBlockRefCheckGroup()
	for docPath, box := range pathsBoxes {
		rootID := util.GetTreeID(docPath)
		group.rootIDs[rootID] = struct{}{}
		group.deletedRootIDs[rootID] = struct{}{}
		childrenDir := path.Join(path.Dir(docPath), rootID)
		for _, bt := range treenode.GetBlockTreesByPathPrefix(box.ID, childrenDir) {
			if bt.ID == bt.RootID {
				group.rootIDs[bt.RootID] = struct{}{}
				group.deletedRootIDs[bt.RootID] = struct{}{}
			}
		}
	}
	return existBlockRefGroup(group)
}

// CheckNotebookRef 检查笔记本当前索引中的全部文档。
func CheckNotebookRef(boxID string) (ret bool, err error) {
	FlushTxQueue()
	sql.FlushQueue()
	if nil == Conf.Box(boxID) {
		return false, ErrBoxNotFound
	}
	group := newBlockRefCheckGroup()
	for _, rootID := range treenode.GetRootBlockIDsByBoxID(boxID) {
		group.rootIDs[rootID] = struct{}{}
		group.deletedRootIDs[rootID] = struct{}{}
	}
	return existBlockRefGroup(group)
}

func existBlockRefGroup(group *blockRefCheckGroup) (ret bool, err error) {
	blockIDs := make([]string, 0, len(group.blockIDs))
	for id := range group.blockIDs {
		blockIDs = append(blockIDs, id)
	}
	rootIDs := make([]string, 0, len(group.rootIDs))
	for id := range group.rootIDs {
		rootIDs = append(rootIDs, id)
	}
	if ret, err = sql.ExistRefByDefIDs(blockIDs, rootIDs, blockIDs, rootIDs); nil != err || ret {
		return
	}
	return existBoundBlockGroup(group)
}

func existBoundBlockGroup(group *blockRefCheckGroup) (ret bool, err error) {
	deletedBlockIDs := make([]string, 0, len(group.deletedBlockIDs))
	for id := range group.deletedBlockIDs {
		deletedBlockIDs = append(deletedBlockIDs, id)
	}
	deletedRootIDs := make([]string, 0, len(group.deletedRootIDs))
	for id := range group.deletedRootIDs {
		deletedRootIDs = append(deletedRootIDs, id)
	}
	boundAVIDs, err := sql.QueryBoundBlockAVIDs(deletedBlockIDs, deletedRootIDs)
	if nil != err || 0 == len(boundAVIDs) {
		return false, err
	}

	avIDSet := map[string]struct{}{}
	for _, avIDs := range boundAVIDs {
		for _, avID := range avIDs {
			avIDSet[avID] = struct{}{}
		}
	}
	avIDs := make([]string, 0, len(avIDSet))
	for avID := range avIDSet {
		avIDs = append(avIDs, avID)
	}
	avBlockRels, err := av.GetBlockRelsByAVIDs(avIDs)
	if nil != err {
		return false, err
	}
	avBlockIDSet := map[string]struct{}{}
	for _, avIDs := range boundAVIDs {
		for _, avID := range avIDs {
			for _, blockID := range avBlockRels[avID] {
				avBlockIDSet[blockID] = struct{}{}
			}
		}
	}
	avBlockIDs := make([]string, 0, len(avBlockIDSet))
	for id := range avBlockIDSet {
		avBlockIDs = append(avBlockIDs, id)
	}
	return hasSurvivingAttributeViewBlock(group, boundAVIDs, avBlockRels, treenode.GetBlockTrees(avBlockIDs)), nil
}

func hasSurvivingAttributeViewBlock(group *blockRefCheckGroup, boundAVIDs, avBlockRels map[string][]string,
	blockTrees map[string]*treenode.BlockTree) bool {
	for _, avIDs := range boundAVIDs {
		for _, avID := range avIDs {
			for _, blockID := range avBlockRels[avID] {
				bt := blockTrees[blockID]
				if nil == bt {
					continue
				}
				if _, deleted := group.deletedBlockIDs[bt.ID]; deleted {
					continue
				}
				if _, deleted := group.deletedRootIDs[bt.RootID]; deleted {
					continue
				}
				return true
			}
		}
	}
	return false
}

type BlockTreeInfo struct {
	ID           string `json:"id"`
	Type         string `json:"type"`
	ParentID     string `json:"parentID"`
	ParentType   string `json:"parentType"`
	PreviousID   string `json:"previousID"`
	PreviousType string `json:"previousType"`
	NextID       string `json:"nextID"`
	NextType     string `json:"nextType"`
}

func GetBlockTreeInfos(ids []string) (ret map[string]*BlockTreeInfo) {
	return GetBlockTreeInfosInBox(ids, "")
}

// GetBlockTreeInfosInBox 获取指定笔记本内的块树信息。空 box 仅查询普通全局库。
func GetBlockTreeInfosInBox(ids []string, boxID string) (ret map[string]*BlockTreeInfo) {
	ret = map[string]*BlockTreeInfo{}
	for _, id := range ids {
		tree := loadTreeForBlockDOM(id, boxID)
		if nil == tree {
			continue
		}
		node := treenode.GetNodeInTree(tree, id)
		if nil == node {
			ret[id] = &BlockTreeInfo{ID: id}
			continue
		}

		bti := &BlockTreeInfo{ID: id, Type: node.Type.String()}
		ret[id] = bti
		parent := treenode.ParentBlock(node)
		if nil != parent {
			bti.ParentID = parent.ID
			bti.ParentType = parent.Type.String()
		}
		previous := treenode.PreviousBlock(node)
		if nil != previous {
			bti.PreviousID = previous.ID
			bti.PreviousType = previous.Type.String()
		}
		next := treenode.NextBlock(node)
		if nil != next {
			bti.NextID = next.ID
			bti.NextType = next.Type.String()
		}
	}
	return
}

func GetBlockSiblingID(id string) (parent, previous, next string) {
	return GetBlockSiblingIDInBox(id, "")
}

// GetBlockSiblingIDInBox 获取指定笔记本内块的相邻关系。空 box 不回退搜索加密笔记本。
func GetBlockSiblingIDInBox(id, boxID string) (parent, previous, next string) {
	tree := loadTreeForBlockDOM(id, boxID)
	if nil == tree {
		return
	}

	current := treenode.GetNodeInTree(tree, id)
	if nil == current || !current.IsBlock() {
		return
	}

	if !current.ParentIs(ast.NodeList) { // 当前块不在列表内的情况
		parentBlock := treenode.ParentBlock(current)
		if nil != parentBlock {
			parent = parentBlock.ID
			if nil != parentBlock.Previous {
				previous = parentBlock.Previous.ID
			} else {
				if nil != current.Previous {
					previous = current.Previous.ID
				}
			}
			if nil != parentBlock.Next {
				next = parentBlock.Next.ID
			} else {
				if nil != current.Next {
					next = current.Next.ID
				}
			}
		}
		return
	}

	if ast.NodeListItem != current.Type && ast.NodeList != current.Parent.Type { // 当前块是列表内的块，但不是列表项或列表的情况
		var listParent, listParent2 *ast.Node
		listParentCount := 0
		for parentBlock := treenode.ParentBlock(current); nil != parentBlock; parentBlock = treenode.ParentBlock(parentBlock) {
			if ast.NodeListItem == parentBlock.Type {
				listParentCount++
				if 1 < listParentCount {
					listParent2 = parentBlock
					break
				}
				listParent = parentBlock
				continue
			}
		}

		if 1 == listParentCount { // 列表只有一层的情况
			if nil != listParent {
				parent = listParent.ID
				previous, next = getPreNext(listParent)
			}
			return
		}

		parent = listParent2.ID
		if nil == listParent.Previous {
			if nil != listParent2.Previous {
				previous = listParent2.Previous.ID
			}
		} else {
			previous = listParent.Previous.ID
		}
		if nil == listParent.Next {
			if nil != listParent2.Next {
				next = listParent2.Next.ID
			}
		} else {
			next = listParent.Next.ID
		}
		return
	}

	if ast.NodeListItem == current.Type {
		// 当前块是列表项的情况
		parentBlock := treenode.ParentBlock(current)
		if nil != parentBlock {
			parentBlock = treenode.ParentBlock(parentBlock)
		}
		if nil != parentBlock {
			parent = parentBlock.ID
			previous, next = getPreNext(current)
		}
		return
	}

	// 当前块是列表的情况
	parentBlock := treenode.ParentBlock(current)
	if nil != parentBlock {
		parent = parentBlock.ID
		previous, next = getPreNext(current)
		return
	}
	return
}

func getPreNext(parent *ast.Node) (previous, next string) {
	if nil != parent {
		if nil != parent.Previous {
			previous = parent.Previous.ID
		}
		if nil != parent.Next {
			next = parent.Next.ID
		}
		return
	}
	return
}

func GetBlockRelevantIDs(id string) (parentID, previousID, nextID string, err error) {
	return GetBlockRelevantIDsInBox(id, "")
}

// GetBlockRelevantIDsInBox 获取指定笔记本内块的父级及相邻块 ID。空 box 不回退搜索加密笔记本。
func GetBlockRelevantIDsInBox(id, boxID string) (parentID, previousID, nextID string, err error) {
	tree := loadTreeForBlockDOM(id, boxID)
	if nil == tree {
		err = ErrTreeNotFound
		return
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		err = ErrBlockNotFound
		return
	}

	if nil != node.Parent {
		parentID = node.Parent.ID
	}
	if nil != node.Previous {
		previous := node.Previous
		if ast.NodeKramdownBlockIAL == previous.Type {
			previous = previous.Previous
		}
		if nil != previous {
			previousID = previous.ID
		}
	}
	if nil != node.Next {
		next := node.Next
		if ast.NodeKramdownBlockIAL == next.Type {
			next = next.Next
		}
		if nil != next {
			nextID = next.ID
		}
	}
	return
}

func GetUnfoldedParentID(id string) (parentID string) {
	tree, err := LoadTreeByBlockID(id)
	if err != nil {
		return
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		return
	}

	if !node.IsBlock() {
		return
	}

	parentID = id
	for parent := treenode.HeadingParent(node); nil != parent && ast.NodeDocument != parent.Type; parent = treenode.HeadingParent(parent) {
		if treenode.IsSelfFolded(parent) {
			parentID = parent.ID
		}
	}
	return
}

func IsBlockFolded(id string) (isFolded, isRoot bool) {
	tree, _ := LoadTreeByBlockID(id)
	if nil == tree {
		return
	}

	if tree.Root.ID == id {
		isRoot = true
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		return
	}
	if treenode.IsSelfFolded(node) || treenode.IsInFoldedHeading(node, nil) {
		isFolded = true
		return
	}
	for parent := node.Parent; nil != parent && ast.NodeDocument != parent.Type; parent = parent.Parent {
		if treenode.IsSelfFolded(parent) {
			isFolded = true
			return
		}
	}
	return
}

func RecentUpdatedBlocks() (ret []*Block) {
	ret = []*Block{}

	sqlStmt := "SELECT * FROM blocks WHERE type = 'p' AND length > 1"
	if util.IsMobileContainer() {
		sqlStmt = "SELECT * FROM blocks WHERE type = 'd'"
	}

	if ignoreLines := getSearchIgnoreLines(); 0 < len(ignoreLines) {
		// Support ignore search results https://github.com/siyuan-note/siyuan/issues/10089
		buf := bytes.Buffer{}
		for _, line := range ignoreLines {
			buf.WriteString(" AND ")
			buf.WriteString(line)
		}
		sqlStmt += buf.String()
	}

	sqlStmt += " ORDER BY updated DESC"
	sqlBlocks := sql.SelectBlocksRawStmt(sqlStmt, 1, 16)
	if 1 > len(sqlBlocks) {
		return
	}

	ret = fromSQLBlocks(&sqlBlocks, "", 0)
	return
}

func TransferBlockRef(fromID, toID string, refIDs []string) (err error) {
	toTree, _ := LoadTreeByBlockID(toID)
	if nil == toTree {
		err = ErrBlockNotFound
		return
	}
	toNode := treenode.GetNodeInTree(toTree, toID)
	if nil == toNode {
		err = ErrBlockNotFound
		return
	}
	toRefText := getNodeRefText(toNode)

	util.PushMsg(Conf.Language(116), 7000)

	if 1 > len(refIDs) { // 如果不指定 refIDs，则转移所有引用了 fromID 的块
		refIDs = sql.QueryRefIDsByDefID(fromID, false)
	}

	trees := filesys.LoadTrees(refIDs)
	for refID, tree := range trees {
		if nil == tree {
			continue
		}

		node := treenode.GetNodeInTree(tree, refID)
		textMarks := node.ChildrenByType(ast.NodeTextMark)
		for _, textMark := range textMarks {
			if textMark.IsTextMarkType("block-ref") && textMark.TextMarkBlockRefID == fromID {
				textMark.TextMarkBlockRefID = toID
				if "d" == textMark.TextMarkBlockRefSubtype {
					textMark.TextMarkTextContent = toRefText
				}
			}
		}

		if err = indexWriteTreeUpsertQueue(tree); err != nil {
			return
		}
	}

	sql.FlushQueue()
	return
}

func SwapBlockRef(refID, defID string, includeChildren bool) (err error) {
	refTree, err := LoadTreeByBlockID(refID)
	if err != nil {
		return
	}
	refNode := treenode.GetNodeInTree(refTree, refID)
	if nil == refNode {
		return
	}
	if ast.NodeListItem == refNode.Parent.Type {
		refNode = refNode.Parent
	}
	defTree, err := LoadTreeByBlockID(defID)
	if err != nil {
		return
	}
	sameTree := defTree.ID == refTree.ID
	var defNode *ast.Node
	if !sameTree {
		defNode = treenode.GetNodeInTree(defTree, defID)
	} else {
		defNode = treenode.GetNodeInTree(refTree, defID)
	}
	if nil == defNode {
		return
	}
	var defNodeChildren []*ast.Node
	if ast.NodeListItem == defNode.Parent.Type {
		defNode = defNode.Parent
	} else if ast.NodeHeading == defNode.Type && includeChildren {
		defNodeChildren = treenode.HeadingChildren(defNode)
	}
	if ast.NodeListItem == defNode.Type {
		for c := defNode.FirstChild; nil != c; c = c.Next {
			if ast.NodeList == c.Type {
				defNodeChildren = append(defNodeChildren, c)
			}
		}
	}

	treenode.RefreshUpdated(defNode)
	treenode.RefreshUpdated(refNode)

	refPivot := treenode.NewParagraph("")
	refNode.InsertBefore(refPivot)

	if ast.NodeListItem == defNode.Type {
		if ast.NodeListItem == refNode.Type {
			if !includeChildren {
				for _, c := range defNodeChildren {
					refNode.AppendChild(c)
				}
			}
			defNode.InsertAfter(refNode)
			refPivot.InsertAfter(defNode)
		} else {
			newID := ast.NewNodeID()
			li := &ast.Node{ID: newID, Type: ast.NodeListItem, ListData: &ast.ListData{Typ: defNode.Parent.ListData.Typ}}
			li.SetIALAttr("id", newID)
			li.SetIALAttr("updated", newID[:14])
			li.AppendChild(refNode)
			defNode.InsertAfter(li)
			if !includeChildren {
				for _, c := range defNodeChildren {
					li.AppendChild(c)
				}
			}

			newID = ast.NewNodeID()
			list := &ast.Node{ID: newID, Type: ast.NodeList, ListData: &ast.ListData{Typ: defNode.Parent.ListData.Typ}}
			list.SetIALAttr("id", newID)
			list.SetIALAttr("updated", newID[:14])
			list.AppendChild(defNode)
			refPivot.InsertAfter(list)
		}
	} else {
		if ast.NodeListItem == refNode.Type {
			newID := ast.NewNodeID()
			list := &ast.Node{ID: newID, Type: ast.NodeList, ListData: &ast.ListData{Typ: refNode.Parent.ListData.Typ}}
			list.SetIALAttr("id", newID)
			list.SetIALAttr("updated", newID[:14])
			list.AppendChild(refNode)
			defNode.InsertAfter(list)

			newID = ast.NewNodeID()
			li := &ast.Node{ID: newID, Type: ast.NodeListItem, ListData: &ast.ListData{Typ: refNode.Parent.ListData.Typ}}
			li.SetIALAttr("id", newID)
			li.SetIALAttr("updated", newID[:14])
			li.AppendChild(defNode)
			for i := len(defNodeChildren) - 1; -1 < i; i-- {
				defNode.InsertAfter(defNodeChildren[i])
			}
			refPivot.InsertAfter(li)
		} else {
			defNode.InsertAfter(refNode)
			refPivot.InsertAfter(defNode)
			for i := len(defNodeChildren) - 1; -1 < i; i-- {
				defNode.InsertAfter(defNodeChildren[i])
			}
		}
	}
	refPivot.Unlink()

	if err = indexWriteTreeUpsertQueue(refTree); err != nil {
		return
	}
	if !sameTree {
		if err = indexWriteTreeUpsertQueue(defTree); err != nil {
			return
		}
	}
	FlushTxQueue()
	util.ReloadUI()
	return
}

func GetHeadingDeleteTransaction(id string) (transaction *Transaction, err error) {
	tree, err := LoadTreeByBlockID(id)
	if err != nil {
		return
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		err = fmt.Errorf(Conf.Language(15), id)
		return
	}

	if ast.NodeHeading != node.Type {
		return
	}

	var nodes []*ast.Node
	nodes = append(nodes, node)
	nodes = append(nodes, treenode.HeadingChildren(node)...)
	hiddenNodes := map[string]bool{}
	for _, hidden := range treenode.CollectFoldHiddenNodes(node.Parent) {
		hiddenNodes[hidden.ID] = true
	}

	transaction = &Transaction{}
	luteEngine := util.NewLute()
	for _, n := range nodes {
		op := &Operation{}
		op.ID = n.ID
		op.Action = "delete"
		transaction.DoOperations = append(transaction.DoOperations, op)

		op = &Operation{}
		op.ID = n.ID
		if nil != n.Parent {
			op.ParentID = n.Parent.ID
		}
		if nil != n.Previous {
			op.PreviousID = n.Previous.ID
		}
		op.Action = "insert"
		op.Data = luteEngine.RenderNodeBlockDOM(cleanRenderNode(n, false))
		if hiddenNodes[n.ID] {
			op.Context = map[string]any{"ignoreProcess": "true"}
		}
		transaction.UndoOperations = append(transaction.UndoOperations, op)
	}
	return
}

func GetHeadingInsertTransaction(id string) (transaction *Transaction, err error) {
	tree, err := LoadTreeByBlockID(id)
	if err != nil {
		return
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		err = fmt.Errorf(Conf.Language(15), id)
		return
	}

	if ast.NodeHeading != node.Type {
		return
	}

	var nodes []*ast.Node
	nodes = append(nodes, node)
	nodes = append(nodes, treenode.HeadingChildren(node)...)

	transaction = &Transaction{}
	luteEngine := util.NewLute()
	for _, n := range nodes {
		n.ID = ast.NewNodeID()
		n.SetIALAttr("id", n.ID)

		op := &Operation{Context: map[string]any{"ignoreProcess": "true"}}
		op.ID = n.ID
		op.Action = "insert"
		op.Data = luteEngine.RenderNodeBlockDOM(cleanRenderNode(n, false))
		transaction.DoOperations = append(transaction.DoOperations, op)

		op = &Operation{}
		op.ID = n.ID
		op.Action = "delete"
		transaction.UndoOperations = append(transaction.UndoOperations, op)
	}
	return
}

func GetHeadingChildrenIDs(id string) (ret []string) {
	tree, err := LoadTreeByBlockID(id)
	if err != nil {
		return
	}
	heading := treenode.GetNodeInTree(tree, id)
	if nil == heading || ast.NodeHeading != heading.Type {
		return
	}
	return headingChildrenIDs(heading)
}

func headingChildrenIDs(heading *ast.Node) (ret []string) {
	for _, n := range treenode.HeadingChildren(heading) {
		if !n.IsBlock() {
			continue
		}
		ret = append(ret, n.ID)
	}
	return
}

func AppendHeadingChildren(id, childrenDOM string) {
	tree, err := LoadTreeByBlockID(id)
	if err != nil {
		return
	}

	heading := treenode.GetNodeInTree(tree, id)
	if nil == heading || ast.NodeHeading != heading.Type {
		return
	}

	luteEngine := util.NewLute()
	subTree := luteEngine.BlockDOM2Tree(childrenDOM)
	var nodes []*ast.Node
	for n := subTree.Root.FirstChild; nil != n; n = n.Next {
		nodes = append(nodes, n)
	}

	slices.Reverse(nodes)
	for _, n := range nodes {
		heading.InsertAfter(n)
	}

	if err = indexWriteTreeUpsertQueue(tree); err != nil {
		return
	}
}

func GetHeadingChildrenDOM(id string, removeFoldAttr bool) (ret string) {
	tree, err := LoadTreeByBlockID(id)
	if err != nil {
		return
	}
	heading := treenode.GetNodeInTree(tree, id)
	if nil == heading || ast.NodeHeading != heading.Type {
		return
	}

	nodes := append([]*ast.Node{}, heading)
	children := treenode.HeadingChildren(heading)
	nodes = append(nodes, children...)

	for _, child := range children {
		ast.Walk(child, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}

			if removeFoldAttr {
				n.RemoveIALAttr("heading-fold")
				n.RemoveIALAttr("fold")
			}
			return ast.WalkContinue
		})

		if removeFoldAttr {
			child.RemoveIALAttr("parent-heading")
		} else {
			child.SetIALAttr("parent-heading", id)
		}
	}

	if removeFoldAttr {
		heading.RemoveIALAttr("fold")
		heading.RemoveIALAttr("heading-fold")
	}

	luteEngine := util.NewLute()
	ret = renderCleanBlockDOMByNodes(nodes, luteEngine)
	return
}

func GetHeadingLevelTransaction(id string, level int) (transaction *Transaction, err error) {
	tree, err := LoadTreeByBlockID(id)
	if err != nil {
		return
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		err = fmt.Errorf(Conf.Language(15), id)
		return
	}

	if ast.NodeHeading != node.Type {
		return
	}

	hLevel := node.HeadingLevel
	if hLevel == level {
		return
	}

	diff := level - hLevel
	var children, childrenHeadings []*ast.Node
	children = append(children, node)
	children = append(children, treenode.HeadingChildren(node)...)
	for _, c := range children {
		ccH := c.ChildrenByType(ast.NodeHeading)
		childrenHeadings = append(childrenHeadings, ccH...)
	}
	fillBlockRefCount(childrenHeadings, tree.Box)

	transaction = &Transaction{}
	if treenode.IsSelfFolded(node) {
		unfoldHeading(node, node)
	}

	luteEngine := util.NewLute()
	for _, c := range childrenHeadings {
		op := &Operation{}
		op.ID = c.ID
		op.Action = "update"
		op.Data = luteEngine.RenderNodeBlockDOM(cleanRenderNode(c, false))
		transaction.UndoOperations = append(transaction.UndoOperations, op)

		c.HeadingLevel += diff
		if 6 < c.HeadingLevel {
			c.HeadingLevel = 6
		} else if 1 > c.HeadingLevel {
			c.HeadingLevel = 1
		}

		op = &Operation{}
		op.ID = c.ID
		op.Action = "update"
		op.Data = luteEngine.RenderNodeBlockDOM(cleanRenderNode(c, false))
		transaction.DoOperations = append(transaction.DoOperations, op)
	}
	return
}

func GetBlockDOM(id string) (ret string) {
	return GetBlockDOMInBox(id, "")
}

// GetBlockDOMInBox 渲染指定笔记本内的块 DOM。boxID 为空时仅查询普通全局库。
func GetBlockDOMInBox(id, boxID string) (ret string) {
	if "" == id {
		return
	}

	doms := GetBlockDOMsInBox([]string{id}, boxID)
	ret = doms[id]
	return
}

func GetBlockDOMs(ids []string) (ret map[string]string) {
	return GetBlockDOMsInBox(ids, "")
}

// GetBlockDOMsInBox 渲染指定笔记本内的块 DOM。禁止在 boxID 未指定时遍历加密笔记本。
func GetBlockDOMsInBox(ids []string, boxID string) (ret map[string]string) {
	ret = map[string]string{}
	if 0 == len(ids) {
		return
	}

	luteEngine := NewLute()
	for _, id := range ids {
		tree := loadTreeForBlockDOM(id, boxID)
		if nil == tree {
			continue
		}
		node := treenode.GetNodeInTree(tree, id)
		if nil == node {
			continue
		}

		ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering || !n.IsBlock() {
				return ast.WalkContinue
			}

			if parentFoldedHeading := treenode.GetParentFoldedHeading(n); nil != parentFoldedHeading {
				n.SetIALAttr("parent-heading", parentFoldedHeading.ID)
			}
			return ast.WalkContinue
		})

		ret[id] = luteEngine.RenderNodeBlockDOM(cleanRenderNode(node, false))
	}
	return
}

func GetBlockDOMWithEmbed(id string) (ret string) {
	return GetBlockDOMWithEmbedInBox(id, "")
}

// GetBlockDOMWithEmbedInBox 渲染指定笔记本内包含嵌入块的 DOM。
func GetBlockDOMWithEmbedInBox(id, boxID string) (ret string) {
	return GetBlockDOMWithEmbedInBoxWithAccessChecker(id, boxID, nil)
}

// EmbedBlockAccessChecker 判断嵌入查询结果块是否允许返回。
type EmbedBlockAccessChecker func(blockID string) bool

// GetBlockDOMWithEmbedInBoxWithAccessChecker 按访问权限渲染指定笔记本内包含嵌入块的 DOM。
func GetBlockDOMWithEmbedInBoxWithAccessChecker(id, boxID string, accessChecker EmbedBlockAccessChecker) (ret string) {
	if "" == id {
		return
	}

	doms := GetBlockDOMsWithEmbedInBoxWithAccessChecker([]string{id}, boxID, accessChecker)
	ret = doms[id]
	return
}

func GetBlockDOMsWithEmbed(ids []string) (ret map[string]string) {
	return GetBlockDOMsWithEmbedInBox(ids, "")
}

// GetBlockDOMsWithEmbedInBox 渲染指定笔记本内包含嵌入块的 DOM。boxID 为空时仅查询普通全局库。
func GetBlockDOMsWithEmbedInBox(ids []string, boxID string) (ret map[string]string) {
	return GetBlockDOMsWithEmbedInBoxWithAccessChecker(ids, boxID, nil)
}

// GetBlockDOMsWithEmbedInBoxWithAccessChecker 按访问权限渲染指定笔记本内包含嵌入块的 DOM。
func GetBlockDOMsWithEmbedInBoxWithAccessChecker(ids []string, boxID string, accessChecker EmbedBlockAccessChecker) (ret map[string]string) {
	ret = map[string]string{}
	if 0 == len(ids) {
		return
	}

	luteEngine := NewLute()
	for _, id := range ids {
		tree := loadTreeForBlockDOM(id, boxID)
		if nil == tree {
			continue
		}
		node := treenode.GetNodeInTree(tree, id)
		if nil == node {
			continue
		}

		resolveEmbedContentInBox(node, luteEngine, boxID, accessChecker)

		// 处理折叠标题
		ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
			if !entering || !n.IsBlock() {
				return ast.WalkContinue
			}

			if parentFoldedHeading := treenode.GetParentFoldedHeading(n); nil != parentFoldedHeading {
				n.SetIALAttr("parent-heading", parentFoldedHeading.ID)
			}
			return ast.WalkContinue
		})

		htmlContent := luteEngine.RenderNodeBlockDOM(cleanRenderNode(node, false))

		htmlContent = processEmbedHTML(htmlContent)

		ret[id] = htmlContent
	}
	return
}

func resolveEmbedContent(n *ast.Node, luteEngine *lute.Lute) {
	resolveEmbedContentInBox(n, luteEngine, "", nil)
}

// loadTreeForBlockDOM 按指定 box 加载树，空 box 不回退搜索已打开的加密笔记本。
func loadTreeForBlockDOM(id, boxID string) *parse.Tree {
	bt := treenode.GetBlockTreeInBox(id, boxID)
	if nil == bt {
		return nil
	}
	tree, err := loadTreeByBlockTree(bt)
	if nil != err {
		return nil
	}
	return tree
}

func resolveEmbedContentInBox(n *ast.Node, luteEngine *lute.Lute, boxID string, accessChecker EmbedBlockAccessChecker) {
	ast.Walk(n, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering || ast.NodeBlockQueryEmbed != node.Type {
			return ast.WalkContinue
		}

		// 获取嵌入块的查询语句
		scriptNode := node.ChildByType(ast.NodeBlockQueryEmbedScript)
		if nil == scriptNode {
			return ast.WalkContinue
		}
		stmt := scriptNode.TokensStr()
		stmt = html.UnescapeString(stmt)
		stmt = strings.ReplaceAll(stmt, editor.IALValEscNewLine, "\n")

		// 执行查询获取嵌入的块
		sqlBlocks := sql.SelectBlocksRawStmtInBox(stmt, 1, Conf.Search.Limit, boxID)
		sqlBlocks = filterEmbedBlocksByAccess(sqlBlocks, accessChecker)

		// 收集所有嵌入块的内容 HTML
		var embedContents []string
		for _, sqlBlock := range sqlBlocks {
			if "query_embed" == sqlBlock.Type {
				continue
			}

			subTree := loadTreeForBlockDOM(sqlBlock.ID, boxID)
			if nil == subTree {
				continue
			}

			// 将内容转换为 HTML，直接使用原始 AST 节点渲染以保持正确的 data-node-id
			var contentHTML string
			if "d" == sqlBlock.Type {
				// 文档块：直接使用原始 AST 节点渲染，保持原始的 data-node-id
				contentHTML = luteEngine.RenderNodeBlockDOM(cleanRenderNode(subTree.Root, true))
			} else if "h" == sqlBlock.Type {
				// 标题块：使用标题及其子块的原始 AST 节点渲染
				h := treenode.GetNodeInTree(subTree, sqlBlock.ID)
				if nil == h {
					continue
				}
				var hChildren []*ast.Node
				hChildren = append(hChildren, h)
				hChildren = append(hChildren, treenode.HeadingChildren(h)...)
				contentHTML = renderVisibleBlockDOMByNodes(hChildren, luteEngine)
			} else {
				// 其他块：直接使用原始 AST 节点渲染
				blockNode := treenode.GetNodeInTree(subTree, sqlBlock.ID)
				if nil == blockNode {
					continue
				}
				contentHTML = luteEngine.RenderNodeBlockDOM(cleanRenderNode(blockNode, true))
			}

			if contentHTML != "" {
				embedContents = append(embedContents, contentHTML)
			}
		}

		// 如果有内容，在嵌入块上添加内容标记
		if len(embedContents) > 0 {
			node.SetIALAttr("embed-content", strings.Join(embedContents, ""))
		}

		return ast.WalkContinue
	})
}

func filterEmbedBlocksByAccess(blocks []*sql.Block, accessChecker EmbedBlockAccessChecker) (ret []*sql.Block) {
	if nil == accessChecker {
		return blocks
	}

	ret = make([]*sql.Block, 0, len(blocks))
	for _, block := range blocks {
		if nil != block && accessChecker(block.ID) {
			ret = append(ret, block)
		}
	}
	return
}

func processEmbedHTML(htmlStr string) string {
	// 使用正则表达式查找所有带有 embed-content 属性的嵌入块
	embedPattern := `<div[^>]*data-type="NodeBlockQueryEmbed"[^>]*embed-content="[^"]*"[^>]*>`
	re := regexp.MustCompile(embedPattern)

	return re.ReplaceAllStringFunc(htmlStr, func(match string) string {
		// 提取 embed-content 属性值
		contentPattern := `embed-content="([^"]*)"`
		contentRe := regexp.MustCompile(contentPattern)
		contentMatches := contentRe.FindStringSubmatch(match)

		if len(contentMatches) > 1 {
			embedContent := contentMatches[1]
			// HTML 解码
			embedContent = html.UnescapeString(embedContent)

			// 移除 embed-content 属性，避免在最终 HTML 中显示
			cleanMatch := contentRe.ReplaceAllString(match, "")

			// 将内容插入到嵌入块内部
			return cleanMatch + embedContent + "</div>"
		}

		return match
	})
}

func GetBlockKramdown(id, mode string) (ret string) {
	return GetBlockKramdownInBox(id, mode, "")
}

// GetBlockKramdownInBox 与 GetBlockKramdown 一致，但按 boxID 路由 blocktree 查询。
func GetBlockKramdownInBox(id, mode, boxID string) (ret string) {
	if "" == id {
		return
	}

	tree, err := loadTreeByBlockIDInBox(id, boxID)
	if err != nil {
		return
	}

	luteEngine := NewLute()
	return getBlockKramdown0(tree, id, mode, luteEngine)
}

func GetBlockKramdowns(ids []string, mode string) (ret map[string]string) {
	return GetBlockKramdownsInBox(ids, mode, "")
}

// GetBlockKramdownsInBox 与 GetBlockKramdowns 一致，但按 boxID 路由 blocktree 查询。
func GetBlockKramdownsInBox(ids []string, mode, boxID string) (ret map[string]string) {
	ret = make(map[string]string, len(ids))
	if 0 == len(ids) {
		return
	}

	luteEngine := NewLute()
	for _, id := range ids {
		// 节点会被移走，tree 不能共享，需重新加载
		tree, err := loadTreeByBlockIDInBox(id, boxID)
		if err != nil {
			continue
		}
		ret[id] = getBlockKramdown0(tree, id, mode, luteEngine)
	}
	return
}

func getBlockKramdown0(tree *parse.Tree, id, mode string, luteEngine *lute.Lute) (ret string) {
	addCanonicalBlockIALNodes(tree, false)
	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		return
	}
	root := &ast.Node{Type: ast.NodeDocument}
	root.AppendChild(node.Next) // IAL
	root.PrependChild(node)
	if "md" == mode {
		// `/api/block/getBlockKramdown` link/image URLs are no longer encoded with spaces https://github.com/siyuan-note/siyuan/issues/15611
		luteEngine.SetPreventEncodeLinkSpace(true)
		ret = treenode.ExportNodeStdMd(root, luteEngine)
	} else {
		tree.Root = root
		formatRenderer := render.NewFormatRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
		ret = string(formatRenderer.Render())
	}
	return
}

var blockKramdownIALAttrPriority = map[string]int{
	"id":        0,
	"updated":   1,
	"type":      2,
	"title":     3,
	"name":      4,
	"alias":     5,
	"memo":      6,
	"bookmark":  7,
	"tags":      8,
	"icon":      9,
	"title-img": 10,
	"style":     11,
	"fold":      12,
}

// canonicalBlockKramdownIAL 返回按 Kramdown API 输出规则排序的块级 IAL 副本。
func canonicalBlockKramdownIAL(ial [][]string) (ret [][]string) {
	ret = slices.Clone(ial)
	if 2 > len(ret) {
		return
	}

	slices.SortStableFunc(ret, func(a, b []string) int {
		return compareBlockKramdownIALAttrNames(a[0], b[0])
	})
	return
}

func compareBlockKramdownIALAttrNames(a, b string) int {
	aPriority, aBuiltIn := blockKramdownIALAttrPriority[a]
	bPriority, bBuiltIn := blockKramdownIALAttrPriority[b]
	if aBuiltIn && bBuiltIn {
		return aPriority - bPriority
	}
	if aBuiltIn {
		return -1
	}
	if bBuiltIn {
		return 1
	}

	aSystemManaged := isSystemManagedBlockKramdownIALAttr(a)
	bSystemManaged := isSystemManagedBlockKramdownIALAttr(b)
	if aSystemManaged && !bSystemManaged {
		return -1
	}
	if !aSystemManaged && bSystemManaged {
		return 1
	}
	return strings.Compare(a, b)
}

func isSystemManagedBlockKramdownIALAttr(name string) bool {
	return "custom-avs" == name || "custom-heading-mode" == name || "custom-reminder-wechat" == name ||
		strings.HasPrefix(name, "custom-riff-") || strings.HasPrefix(name, "custom-sy-")
}

type ChildBlock struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	SubType  string `json:"subType,omitempty"`
	Content  string `json:"content,omitempty"`
	Markdown string `json:"markdown,omitempty"`
}

func GetChildBlocks(id string) (ret []*ChildBlock) {
	return GetChildBlocksInBox(id, "")
}

// GetChildBlocksInBox 返回指定笔记本边界内的直接子块。
func GetChildBlocksInBox(id, boxID string) (ret []*ChildBlock) {
	ret = []*ChildBlock{}
	if "" == id {
		return
	}

	var tree *parse.Tree
	var err error
	if boxID == "" {
		tree, err = LoadTreeByBlockID(id)
	} else {
		tree, err = LoadTreeByBlockIDInExactBox(id, boxID)
	}
	if err != nil {
		return
	}
	return getChildBlocksFromTree(id, tree)
}

func getChildBlocksFromTree(id string, tree *parse.Tree) (ret []*ChildBlock) {
	ret = []*ChildBlock{}
	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		return
	}

	if ast.NodeHeading == node.Type {
		children := treenode.HeadingChildren(node)
		for _, c := range children {
			if childBlock := childBlockFromNode(c, tree); nil != childBlock {
				ret = append(ret, childBlock)
			}
		}
		return
	}

	if !node.IsContainerBlock() {
		return
	}

	for c := node.FirstChild; nil != c; c = c.Next {
		if childBlock := childBlockFromNode(c, tree); nil != childBlock {
			ret = append(ret, childBlock)
		}
	}
	return
}

func childBlockFromNode(node *ast.Node, tree *parse.Tree) *ChildBlock {
	if !node.IsBlock() {
		return nil
	}

	block := sql.BuildBlockFromNode(node, tree)
	return &ChildBlock{
		ID:       node.ID,
		Type:     treenode.TypeAbbr(node.Type.String()),
		SubType:  treenode.SubTypeAbbr(node),
		Content:  block.Content,
		Markdown: block.Markdown,
	}
}

func GetTailChildBlocks(id string, n int) (ret []*ChildBlock) {
	return GetTailChildBlocksInBox(id, n, "")
}

// GetTailChildBlocksInBox 返回指定笔记本边界内末尾的子块。
func GetTailChildBlocksInBox(id string, n int, boxID string) (ret []*ChildBlock) {
	ret = []*ChildBlock{}
	if "" == id {
		return
	}

	var tree *parse.Tree
	var err error
	if boxID == "" {
		tree, err = LoadTreeByBlockID(id)
	} else {
		tree, err = LoadTreeByBlockIDInExactBox(id, boxID)
	}
	if err != nil {
		return
	}
	return getTailChildBlocksFromTree(id, n, tree)
}

func getTailChildBlocksFromTree(id string, n int, tree *parse.Tree) (ret []*ChildBlock) {
	ret = []*ChildBlock{}
	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		return
	}

	if ast.NodeHeading == node.Type {
		children := treenode.HeadingChildren(node)
		for i := len(children) - 1; 0 <= i; i-- {
			c := children[i]
			childBlock := childBlockFromNode(c, tree)
			if nil == childBlock {
				continue
			}
			ret = append(ret, childBlock)
			if n == len(ret) {
				return
			}
		}
		return
	}

	if !node.IsContainerBlock() {
		return
	}

	for c := node.LastChild; nil != c; c = c.Previous {
		childBlock := childBlockFromNode(c, tree)
		if nil == childBlock {
			continue
		}
		ret = append(ret, childBlock)

		if n == len(ret) {
			return
		}
	}
	return
}

func GetBlock(id string, tree *parse.Tree) (ret *Block, err error) {
	ret, err = getBlock(id, tree)
	return
}

// GetBlockInBox 返回指定笔记本边界内的块。
func GetBlockInBox(id, boxID string) (ret *Block, err error) {
	tree, err := LoadTreeByBlockIDInExactBox(id, boxID)
	if err != nil {
		return nil, err
	}
	return getBlock(id, tree)
}

func getBlock(id string, tree *parse.Tree) (ret *Block, err error) {
	if "" == id {
		return
	}

	if nil == tree {
		tree, err = LoadTreeByBlockID(id)
		if err != nil {
			time.Sleep(1 * time.Second)
			tree, err = LoadTreeByBlockID(id)
			if err != nil {
				return
			}
		}
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		err = ErrBlockNotFound
		return
	}

	sqlBlock := sql.BuildBlockFromNode(node, tree)
	if nil == sqlBlock {
		return
	}
	ret = fromSQLBlock(sqlBlock, "", 0)
	return
}

func getEmbeddedBlock(trees map[string]*parse.Tree, sqlBlock *sql.Block, headingMode int, breadcrumb bool) (block *Block, blockPaths []*BlockPath) {
	tree, _ := trees[sqlBlock.RootID]
	if nil == tree {
		if IsEncryptedBox(sqlBlock.Box) {
			tree, _ = LoadTreeByBlockIDInExactBox(sqlBlock.RootID, sqlBlock.Box)
		} else {
			tree, _ = LoadTreeByBlockID(sqlBlock.RootID)
		}
	}
	if nil == tree {
		return
	}
	def := treenode.GetNodeInTree(tree, sqlBlock.ID)
	if nil == def {
		return
	}

	var nodes []*ast.Node
	// headingMode: 0=显示标题与下方的块，1=仅显示标题，2=仅显示标题下方的块
	if ast.NodeHeading == def.Type {
		if 1 == headingMode {
			// 仅显示标题
			nodes = append(nodes, def)
		} else if 2 == headingMode {
			// 仅显示标题下方的块（去除标题）
			if !treenode.IsSelfFolded(def) {
				nodes = append(nodes, treenode.HeadingChildren(def)...)
			}
		} else {
			// 0: 显示标题与下方的块
			nodes = append(nodes, def)
			nodes = append(nodes, treenode.HeadingChildren(def)...)
		}
	} else {
		// 非标题块，直接添加
		nodes = append(nodes, def)
	}

	var b *treenode.BlockTree
	if IsEncryptedBox(sqlBlock.Box) {
		b = treenode.GetBlockTreeInBox(def.ID, sqlBlock.Box)
	} else {
		b = treenode.GetBlockTree(def.ID)
	}
	if nil == b {
		for _, encBoxID := range treenode.GetOpenedEncryptedBoxIDs() {
			if encBT := treenode.GetBlockTreeInBox(def.ID, encBoxID); nil != encBT {
				b = encBT
				break
			}
		}
	}
	if nil == b {
		return
	}

	// 嵌入块查询结果中显示块引用计数 https://github.com/siyuan-note/siyuan/issues/7191
	fillBlockRefCount(nodes, b.BoxID)

	luteEngine := NewLute()
	luteEngine.RenderOptions.ProtyleContenteditable = true
	visibleNodes := cleanRenderNodes(nodes, true)
	dom := renderBlockDOMByNodes(visibleNodes, luteEngine)
	content := renderBlockContentByNodes(visibleNodes)
	block = newEmbeddedBlock(def, b, dom, content)

	if "" != sqlBlock.IAL {
		block.IAL = map[string]string{}
		ialStr := strings.TrimPrefix(sqlBlock.IAL, "{:")
		ialStr = strings.TrimSuffix(ialStr, "}")
		ial := parse.Tokens2IAL([]byte(ialStr))
		for _, kv := range ial {
			block.IAL[kv[0]] = kv[1]
		}
	}

	if breadcrumb {
		blockPaths = buildBlockBreadcrumb(def, nil, true, headingMode)
	}
	if 1 > len(blockPaths) {
		blockPaths = []*BlockPath{}
	}
	return
}

func newEmbeddedBlock(def *ast.Node, blockTree *treenode.BlockTree, dom, content string) *Block {
	return &Block{
		Box:      def.Box,
		Path:     def.Path,
		HPath:    blockTree.HPath,
		ID:       def.ID,
		RootID:   blockTree.RootID,
		Type:     def.Type.String(),
		Content:  dom,
		Markdown: content, // 这里使用 Markdown 字段来临时存储 content
	}
}
