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
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
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

func getRiffCard(card *fsrs.Card) *RiffCard {
	due := card.Due
	if due.IsZero() {
		due = time.Now()
	}

	return &RiffCard{
		Due:        due,
		Reps:       card.Reps,
		Lapses:     card.Lapses,
		State:      card.State,
		LastReview: card.LastReview,
	}
}

func (block *Block) IsContainerBlock() bool {
	switch block.Type {
	case "NodeDocument", "NodeBlockquote", "NodeList", "NodeListItem", "NodeSuperBlock":
		return true
	}
	return false
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

	Updated string `json:"updated"` // 更新时间
	Created string `json:"created"` // 创建时间
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
	luteEngine := util.NewLute()
	treeCache := map[string]*parse.Tree{}
	for _, id := range ids {
		bt := treenode.GetBlockTree(id)
		if nil == bt {
			ret[id] = &BlockTreeInfo{ID: id}
			continue
		}

		tree := treeCache[bt.RootID]
		if nil == tree {
			tree, _ = filesys.LoadTree(bt.BoxID, bt.Path, luteEngine)
			if nil == tree {
				ret[id] = &BlockTreeInfo{ID: id}
				continue
			}

			treeCache[bt.RootID] = tree
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

	parentListCount := 0
	var parentListItem, current *ast.Node
	for p := node.Parent; nil != p; p = p.Parent {
		if ast.NodeListItem == p.Type {
			parentListCount++
			if 1 < parentListCount {
				parentListItem = p
				break
			}
			current = p.Parent
		}
	}

	if nil != parentListItem {
		parent = parentListItem.ID

		if parentListItem.Previous != nil {
			previous = parentListItem.Previous.ID
			if flb := treenode.FirstChildBlock(parentListItem.Previous); nil != flb {
				previous = flb.ID
			}
		}

		if parentListItem.Next != nil {
			next = parentListItem.Next.ID
			if flb := treenode.FirstChildBlock(parentListItem.Next); nil != flb {
				next = flb.ID
			}
		}
		return
	}

	if nil == current {
		current = node
	}

	if nil != current.Parent && current.Parent.IsBlock() {
		parent = current.Parent.ID
		if flb := treenode.FirstChildBlock(current.Parent); nil != flb {
			parent = flb.ID
		}

		if ast.NodeDocument == current.Parent.Type {
			parent = current.Parent.ID

			if nil != current.Previous && current.Previous.IsBlock() {
				previous = current.Previous.ID
				if flb := treenode.FirstChildBlock(current.Previous); nil != flb {
					previous = flb.ID
				}
			}

			if nil != current.Next && current.Next.IsBlock() {
				next = current.Next.ID
				if flb := treenode.FirstChildBlock(current.Next); nil != flb {
					next = flb.ID
				}
			}
		} else {
			if nil != current.Parent.Previous && current.Parent.Previous.IsBlock() {
				previous = current.Parent.Previous.ID
				if flb := treenode.FirstChildBlock(current.Parent.Previous); nil != flb {
					previous = flb.ID
				}
			}

			if nil != current.Parent.Next && current.Parent.Next.IsBlock() {
				next = current.Parent.Next.ID
				if flb := treenode.FirstChildBlock(current.Parent.Next); nil != flb {
					next = flb.ID
				}
			}
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

	sqlBlocks := sql.QueryRecentUpdatedBlocks()
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
		refIDs, _ = sql.QueryRefIDsByDefID(fromID, false)
	}
	for _, refID := range refIDs {
		tree, _ := LoadTreeByBlockID(refID)
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

	sql.WaitForWritingDatabase()
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

	refPivot := treenode.NewParagraph()
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
	WaitForWritingFiles()
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

func GetHeadingChildrenDOM(id string) (ret string) {
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

	transaction = &Transaction{}
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

	tree, err := LoadTreeByBlockID(id)
	if err != nil {
		return
	}
	node := treenode.GetNodeInTree(tree, id)
	luteEngine := NewLute()
	ret = luteEngine.RenderNodeBlockDOM(node)
	return
}

func GetBlockKramdown(id string) (ret string) {
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
	ret = treenode.ExportNodeStdMd(root, luteEngine)
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
	nodes = append(nodes, def)
	if 0 == headingMode && ast.NodeHeading == def.Type && "1" != def.IALAttr("fold") {
		children := treenode.HeadingChildren(def)
		for _, c := range children {
			if "1" == c.IALAttr("heading-fold") {
				// 嵌入块包含折叠标题时不应该显示其下方块 https://github.com/siyuan-note/siyuan/issues/4765
				continue
			}
			nodes = append(nodes, c)
		}
	}

	b := treenode.GetBlockTree(def.ID)
	if nil == b {
		return
	}

	// 嵌入块查询结果中显示块引用计数 https://github.com/siyuan-note/siyuan/issues/7191
	var defIDs []string
	for _, n := range nodes {
		defIDs = append(defIDs, n.ID)
	}
	refCount := sql.QueryRefCount(defIDs)
	for _, n := range nodes {
		if cnt := refCount[n.ID]; 0 < cnt {
			n.SetIALAttr("refcount", strconv.Itoa(cnt))
		}
	}

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
		blockPaths = buildBlockBreadcrumb(def, nil)
	}
	if 1 > len(blockPaths) {
		blockPaths = []*BlockPath{}
	}
	return
}
