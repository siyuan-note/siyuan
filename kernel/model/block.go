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
	"errors"
	"fmt"
	"html"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/editor"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/open-spaced-repetition/go-fsrs/v3"
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

func CheckBlockRef(ids []string) bool {
	bts := treenode.GetBlockTrees(ids)

	var rootIDs, blockIDs []string
	for _, bt := range bts {
		if "d" == bt.Type {
			rootIDs = append(rootIDs, bt.ID)
		} else {
			blockIDs = append(blockIDs, bt.ID)
		}
	}
	rootIDs = gulu.Str.RemoveDuplicatedElem(rootIDs)
	blockIDs = gulu.Str.RemoveDuplicatedElem(blockIDs)

	existRef := func(refCounts map[string]int) bool {
		for _, refCount := range refCounts {
			if 0 < refCount {
				return true
			}
		}
		return false
	}

	for _, rootID := range rootIDs {
		refCounts := sql.QueryRootChildrenRefCount(rootID)
		if existRef(refCounts) {
			return true
		}
	}

	refCounts := sql.QueryRefCount(blockIDs)
	if existRef(refCounts) {
		return true
	}

	// TODO 还需要考虑容器块的子块引用计数 https://github.com/siyuan-note/siyuan/issues/13396

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
	ret = map[string]*BlockTreeInfo{}
	trees := filesys.LoadTrees(ids)
	for id, tree := range trees {
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
	tree, err := LoadTreeByBlockID(id)
	if err != nil {
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
			}
			if nil != parentBlock.Next {
				next = parentBlock.Next.ID
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
	tree, err := LoadTreeByBlockID(id)
	if err != nil {
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

	var firstFoldedParent *ast.Node
	for parent := treenode.HeadingParent(node); nil != parent && ast.NodeDocument != parent.Type; parent = treenode.HeadingParent(parent) {
		if "1" == parent.IALAttr("fold") {
			firstFoldedParent = parent
			parentID = firstFoldedParent.ID
		} else {
			if nil != firstFoldedParent {
				parentID = firstFoldedParent.ID
			} else {
				parentID = id
			}
			return
		}
	}
	if "" == parentID {
		parentID = id
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

	for i := 0; i < 32; i++ {
		b, _ := getBlock(id, nil)
		if nil == b {
			return
		}

		if "1" == b.IAL["fold"] {
			isFolded = true
			return
		}

		id = b.ParentID

	}
	return
}

func RecentUpdatedBlocks() (ret []*Block) {
	ret = []*Block{}

	sqlStmt := "SELECT * FROM blocks WHERE type = 'p' AND length > 1"
	if util.ContainerIOS == util.Container || util.ContainerAndroid == util.Container || util.ContainerHarmony == util.Container {
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

	refreshUpdated(defNode)
	refreshUpdated(refNode)

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
		err = errors.New(fmt.Sprintf(Conf.Language(15), id))
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
		op.Data = luteEngine.RenderNodeBlockDOM(n)
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
		err = errors.New(fmt.Sprintf(Conf.Language(15), id))
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
		op.Data = luteEngine.RenderNodeBlockDOM(n)
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

	children := treenode.HeadingChildren(heading)
	nodes := append([]*ast.Node{}, children...)
	for _, n := range nodes {
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
	ret = renderBlockDOMByNodes(nodes, luteEngine)
	return
}

func GetHeadingLevelTransaction(id string, level int) (transaction *Transaction, err error) {
	tree, err := LoadTreeByBlockID(id)
	if err != nil {
		return
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		err = errors.New(fmt.Sprintf(Conf.Language(15), id))
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
	fillBlockRefCount(childrenHeadings)

	transaction = &Transaction{}
	if "1" == node.IALAttr("fold") {
		unfoldHeading(node, node)
	}

	luteEngine := util.NewLute()
	for _, c := range childrenHeadings {
		op := &Operation{}
		op.ID = c.ID
		op.Action = "update"
		op.Data = luteEngine.RenderNodeBlockDOM(c)
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
		op.Data = luteEngine.RenderNodeBlockDOM(c)
		transaction.DoOperations = append(transaction.DoOperations, op)
	}
	return
}

func GetBlockDOM(id string) (ret string) {
	if "" == id {
		return
	}

	doms := GetBlockDOMs([]string{id})
	ret = doms[id]
	return
}

func GetBlockDOMs(ids []string) (ret map[string]string) {
	ret = map[string]string{}
	if 0 == len(ids) {
		return
	}

	luteEngine := NewLute()
	trees := filesys.LoadTrees(ids)
	for id, tree := range trees {
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

		ret[id] = luteEngine.RenderNodeBlockDOM(node)
	}
	return
}

func GetBlockDOMWithEmbed(id string) (ret string) {
	if "" == id {
		return
	}

	doms := GetBlockDOMsWithEmbed([]string{id})
	ret = doms[id]
	return
}

func GetBlockDOMsWithEmbed(ids []string) (ret map[string]string) {
	ret = map[string]string{}
	if 0 == len(ids) {
		return
	}

	luteEngine := NewLute()
	trees := filesys.LoadTrees(ids)
	for id, tree := range trees {
		node := treenode.GetNodeInTree(tree, id)
		if nil == node {
			continue
		}

		resolveEmbedContent(node, luteEngine)

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

		htmlContent := luteEngine.RenderNodeBlockDOM(node)

		htmlContent = processEmbedHTML(htmlContent)

		ret[id] = htmlContent
	}
	return
}

func resolveEmbedContent(n *ast.Node, luteEngine *lute.Lute) {
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
		sqlBlocks := sql.SelectBlocksRawStmt(stmt, 1, Conf.Search.Limit)

		// 收集所有嵌入块的内容 HTML
		var embedContents []string
		for _, sqlBlock := range sqlBlocks {
			if "query_embed" == sqlBlock.Type {
				continue
			}

			subTree, _ := LoadTreeByBlockID(sqlBlock.ID)
			if nil == subTree {
				continue
			}

			// 将内容转换为 HTML，直接使用原始 AST 节点渲染以保持正确的 data-node-id
			var contentHTML string
			if "d" == sqlBlock.Type {
				// 文档块：直接使用原始 AST 节点渲染，保持原始的 data-node-id
				contentHTML = luteEngine.RenderNodeBlockDOM(subTree.Root)
			} else if "h" == sqlBlock.Type {
				// 标题块：使用标题及其子块的原始 AST 节点渲染
				h := treenode.GetNodeInTree(subTree, sqlBlock.ID)
				if nil == h {
					continue
				}
				var hChildren []*ast.Node
				hChildren = append(hChildren, h)
				hChildren = append(hChildren, treenode.HeadingChildren(h)...)

				// 创建一个临时的文档节点来包含所有子节点
				tempRoot := &ast.Node{Type: ast.NodeDocument}
				for _, hChild := range hChildren {
					tempRoot.AppendChild(hChild)
				}
				contentHTML = luteEngine.RenderNodeBlockDOM(tempRoot)
			} else {
				// 其他块：直接使用原始 AST 节点渲染
				blockNode := treenode.GetNodeInTree(subTree, sqlBlock.ID)
				if nil == blockNode {
					continue
				}
				contentHTML = luteEngine.RenderNodeBlockDOM(blockNode)
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
	if "" == id {
		return
	}

	tree, err := LoadTreeByBlockID(id)
	if err != nil {
		return
	}

	addBlockIALNodes(tree, false)
	node := treenode.GetNodeInTree(tree, id)
	root := &ast.Node{Type: ast.NodeDocument}
	root.AppendChild(node.Next) // IAL
	root.PrependChild(node)
	luteEngine := NewLute()
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

func GetBlockKramdowns(ids []string, mode string) (ret map[string]string) {
	ret = map[string]string{}
	if 0 == len(ids) {
		return
	}

	luteEngine := NewLute()
	if "md" == mode {
		// `/api/block/getBlockKramdown` link/image URLs are no longer encoded with spaces https://github.com/siyuan-note/siyuan/issues/15611
		luteEngine.SetPreventEncodeLinkSpace(true)
	}

	trees := filesys.LoadTrees(ids)
	for id, tree := range trees {
		node := treenode.GetNodeInTree(tree, id)
		if nil == node {
			continue
		}

		addBlockIALNodes(tree, false)
		root := &ast.Node{Type: ast.NodeDocument}
		root.AppendChild(node.Next) // IAL
		root.PrependChild(node)

		var kramdown string
		if "md" == mode {
			kramdown = treenode.ExportNodeStdMd(root, luteEngine)
		} else {
			tree.Root = root
			formatRenderer := render.NewFormatRenderer(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
			kramdown = string(formatRenderer.Render())
		}
		ret[id] = kramdown
	}
	return
}

type ChildBlock struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	SubType  string `json:"subType,omitempty"`
	Content  string `json:"content,omitempty"`
	Markdown string `json:"markdown,omitempty"`
}

func GetChildBlocks(id string) (ret []*ChildBlock) {
	ret = []*ChildBlock{}
	if "" == id {
		return
	}

	tree, err := LoadTreeByBlockID(id)
	if err != nil {
		return
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		return
	}

	if ast.NodeHeading == node.Type {
		children := treenode.HeadingChildren(node)
		for _, c := range children {
			block := sql.BuildBlockFromNode(c, tree)
			ret = append(ret, &ChildBlock{
				ID:       c.ID,
				Type:     treenode.TypeAbbr(c.Type.String()),
				SubType:  treenode.SubTypeAbbr(c),
				Content:  block.Content,
				Markdown: block.Markdown,
			})
		}
		return
	}

	if !node.IsContainerBlock() {
		return
	}

	for c := node.FirstChild; nil != c; c = c.Next {
		if !c.IsBlock() {
			continue
		}

		block := sql.BuildBlockFromNode(c, tree)
		ret = append(ret, &ChildBlock{
			ID:       c.ID,
			Type:     treenode.TypeAbbr(c.Type.String()),
			SubType:  treenode.SubTypeAbbr(c),
			Content:  block.Content,
			Markdown: block.Markdown,
		})
	}
	return
}

func GetTailChildBlocks(id string, n int) (ret []*ChildBlock) {
	ret = []*ChildBlock{}
	if "" == id {
		return
	}

	tree, err := LoadTreeByBlockID(id)
	if err != nil {
		return
	}

	node := treenode.GetNodeInTree(tree, id)
	if nil == node {
		return
	}

	if ast.NodeHeading == node.Type {
		children := treenode.HeadingChildren(node)
		for i := len(children) - 1; 0 <= i; i-- {
			c := children[i]
			block := sql.BuildBlockFromNode(c, tree)
			ret = append(ret, &ChildBlock{
				ID:       c.ID,
				Type:     treenode.TypeAbbr(c.Type.String()),
				SubType:  treenode.SubTypeAbbr(c),
				Content:  block.Content,
				Markdown: block.Markdown,
			})
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
		if !c.IsBlock() {
			continue
		}

		block := sql.BuildBlockFromNode(c, tree)
		ret = append(ret, &ChildBlock{
			ID:       c.ID,
			Type:     treenode.TypeAbbr(c.Type.String()),
			SubType:  treenode.SubTypeAbbr(c),
			Content:  block.Content,
			Markdown: block.Markdown,
		})

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
		tree, _ = LoadTreeByBlockID(sqlBlock.RootID)
	}
	if nil == tree {
		return
	}
	def := treenode.GetNodeInTree(tree, sqlBlock.ID)
	if nil == def {
		return
	}

	var unlinks, nodes []*ast.Node
	ast.Walk(def, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeHeading == n.Type {
			if "1" == n.IALAttr("fold") {
				children := treenode.HeadingChildren(n)
				for _, c := range children {
					unlinks = append(unlinks, c)
				}
			}
		}
		return ast.WalkContinue
	})
	for _, n := range unlinks {
		n.Unlink()
	}
	// headingMode: 0=显示标题与下方的块，1=仅显示标题，2=仅显示标题下方的块
	if ast.NodeHeading == def.Type {
		if 1 == headingMode {
			// 仅显示标题
			nodes = append(nodes, def)
		} else if 2 == headingMode {
			// 仅显示标题下方的块（去除标题）
			if "1" != def.IALAttr("fold") {
				children := treenode.HeadingChildren(def)
				for _, c := range children {
					if "1" == c.IALAttr("heading-fold") {
						// 嵌入块包含折叠标题时不应该显示其下方块 https://github.com/siyuan-note/siyuan/issues/4765
						continue
					}
					nodes = append(nodes, c)
				}
			}
		} else {
			// 0: 显示标题与下方的块
			nodes = append(nodes, def)
			if "1" != def.IALAttr("fold") {
				children := treenode.HeadingChildren(def)
				for _, c := range children {
					if "1" == c.IALAttr("heading-fold") {
						// 嵌入块包含折叠标题时不应该显示其下方块 https://github.com/siyuan-note/siyuan/issues/4765
						continue
					}
					nodes = append(nodes, c)
				}
			}
		}
	} else {
		// 非标题块，直接添加
		nodes = append(nodes, def)
	}

	b := treenode.GetBlockTree(def.ID)
	if nil == b {
		return
	}

	// 嵌入块查询结果中显示块引用计数 https://github.com/siyuan-note/siyuan/issues/7191
	fillBlockRefCount(nodes)

	luteEngine := NewLute()
	luteEngine.RenderOptions.ProtyleContenteditable = false // 不可编辑
	dom := renderBlockDOMByNodes(nodes, luteEngine)
	content := renderBlockContentByNodes(nodes)
	block = &Block{Box: def.Box, Path: def.Path, HPath: b.HPath, ID: def.ID, Type: def.Type.String(), Content: dom, Markdown: content /* 这里使用 Markdown 字段来临时存储 content */}

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
