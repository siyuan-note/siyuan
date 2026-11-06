// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strings"

	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/editor"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type collectionRemovalProjection struct {
	before, after map[string]*parse.Tree
	sources       map[string][]byte
	engine        *lute.Lute
	nodes         map[string]*ast.Node
	nodeTrees     map[string]*parse.Tree
	known         map[string]bool
	deleted       map[string]bool
	leases        map[string]bool
	operations    []*Operation
}

func newCollectionRemovalProjection(operations []*Operation) (ret *collectionRemovalProjection, err error) {
	ret = &collectionRemovalProjection{before: map[string]*parse.Tree{}, after: map[string]*parse.Tree{},
		sources: map[string][]byte{}, engine: util.NewLute(), nodes: map[string]*ast.Node{},
		nodeTrees: map[string]*parse.Tree{}, known: map[string]bool{}, deleted: map[string]bool{},
		leases: map[string]bool{}, operations: operations}
	defer func() {
		if err != nil {
			ret.close()
		}
	}()
	for _, operation := range operations {
		if operation == nil {
			return ret, fmt.Errorf("invalid collection removal projection operation")
		}
		switch operation.Action {
		case "update", "insert", "delete", "move", "setAttrs", "append", "appendInsert", "prependInsert", "foldHeading", "unfoldHeading":
		default:
			return ret, fmt.Errorf("unsupported collection removal projection operation [%s]", operation.Action)
		}
	}
	for _, operation := range operations {
		if err = ret.apply(operation); err != nil {
			return ret, err
		}
		if err = ret.reindex(); err != nil {
			return ret, err
		}
	}
	return ret, nil
}

func (projection *collectionRemovalProjection) close() {
	for boxID := range projection.leases {
		ReleaseEncryptedBoxOperation(boxID)
		delete(projection.leases, boxID)
	}
}

func (projection *collectionRemovalProjection) reindex() error {
	projection.nodes, projection.nodeTrees = map[string]*ast.Node{}, map[string]*parse.Tree{}
	for _, tree := range projection.after {
		var err error
		ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if !entering || !node.IsBlock() || node.ID == "" {
				return ast.WalkContinue
			}
			if projection.nodes[node.ID] != nil {
				err = fmt.Errorf("duplicate projected block [%s]", node.ID)
				return ast.WalkStop
			}
			projection.nodes[node.ID], projection.nodeTrees[node.ID], projection.known[node.ID] = node, tree, true
			return ast.WalkContinue
		})
		if err != nil {
			return err
		}
	}
	return nil
}

func (projection *collectionRemovalProjection) node(id string) (*ast.Node, *parse.Tree, error) {
	if node := projection.nodes[id]; node != nil {
		return node, projection.nodeTrees[id], nil
	}
	if projection.known[id] || !ast.IsNodeIDPattern(id) {
		return nil, nil, ErrBlockNotFound
	}
	bt := treenode.GetBlockTree(id)
	if bt == nil {
		for _, boxID := range treenode.GetOpenedEncryptedBoxIDs() {
			if bt = treenode.GetBlockTreeInBox(id, boxID); bt != nil {
				break
			}
		}
	}
	if bt == nil || projection.after[bt.RootID] != nil {
		return nil, nil, ErrBlockNotFound
	}
	if IsEncryptedBox(bt.BoxID) && !projection.leases[bt.BoxID] {
		if err := AcquireEncryptedBoxOperation(bt.BoxID); err != nil {
			return nil, nil, err
		}
		projection.leases[bt.BoxID] = true
	}
	before, source, err := filesys.LoadTreeSnapshot(bt.BoxID, bt.Path, projection.engine)
	if err != nil {
		return nil, nil, err
	}
	// 复制已认证且已规范化的树，保留修复生成的身份，富文本单元格及标题不共用指针。
	renderTree := *before
	renderTree.Root = cloneBlockSwapNode(before.Root)
	data := render.NewJSONRenderer(&renderTree, projection.engine.RenderOptions, projection.engine.ParseOptions).Render()
	copyTree, err := treenode.ParseJSONWithoutFix(data, projection.engine.ParseOptions)
	if err != nil {
		return nil, nil, err
	}
	after := *before
	after.Root, after.Context = copyTree.Root, copyTree.Context
	after.Root.Path = before.Root.Path
	if err = filesys.NormalizeTreeForRead(&after); err != nil {
		return nil, nil, err
	}
	projection.before[bt.RootID], projection.after[bt.RootID], projection.sources[bt.RootID] = before, &after, source
	if err = projection.reindex(); err != nil {
		return nil, nil, err
	}
	node := projection.nodes[id]
	if node == nil {
		return nil, nil, ErrBlockNotFound
	}
	return node, &after, nil
}

func (projection *collectionRemovalProjection) apply(operation *Operation) error {
	switch operation.Action {
	case "insert", "appendInsert", "prependInsert":
		return projection.insert(operation)
	case "move", "append":
		return projection.move(operation)
	}
	node, tree, err := projection.node(operation.ID)
	if err != nil {
		if operation.Action == "delete" && errors.Is(err, ErrBlockNotFound) {
			return nil
		}
		return err
	}
	switch operation.Action {
	case "update":
		return projection.update(operation, node, tree)
	case "delete":
		if node.Parent == nil {
			return fmt.Errorf("cannot project deletion of a document root")
		}
		if len(collectionRemovalDatabaseHosts(node)) > 0 {
			return fmt.Errorf("unsupported collection removal projection: database host changes")
		}
		for _, id := range node.BlockIDs() {
			projection.deleted[id] = true
		}
		if node.Next != nil && node.Next.Type == ast.NodeKramdownBlockIAL && bytes.Contains(node.Next.Tokens, []byte(node.ID)) {
			node.Next.Unlink()
		}
		parent := node.Parent
		node.Unlink()
		if parent.Type == ast.NodeListItem && parent.FirstChild == nil {
			insertingChild := slices.ContainsFunc(projection.operations, func(op *Operation) bool {
				return op != nil && op.Action == "insert" && op.ParentID == parent.ID
			})
			if !insertingChild {
				parent.AppendChild(treenode.NewParagraph(ast.NewNodeID()))
			}
		}
	case "setAttrs":
		data, ok := operation.Data.(string)
		if !ok {
			return fmt.Errorf("invalid projected attributes")
		}
		attrs := map[string]string{}
		if err = json.Unmarshal([]byte(data), &attrs); err != nil {
			return err
		}
		if IsBoxDoc(tree.Box, tree.ID) {
			attrs[DocHiddenAttr] = "true"
			if icon, exists := attrs["icon"]; exists {
				attrs["icon"] = filterBoxIcon(icon)
			}
		}
		_, err = setNodeAttrsData(node, attrs, tree.Box)
		return err
	case "foldHeading":
		treenode.SetSelfFolded(node, true)
	case "unfoldHeading":
		for _, child := range treenode.HeadingChildren(node) {
			ast.Walk(child, func(current *ast.Node, entering bool) ast.WalkStatus {
				if entering && current.IsBlock() {
					treenode.ClearLegacyHeadingFold(current)
				}
				return ast.WalkContinue
			})
		}
		treenode.SetSelfFolded(node, false)
	default:
		return fmt.Errorf("unsupported collection removal projection operation [%s]", operation.Action)
	}
	return nil
}

func (projection *collectionRemovalProjection) parse(operation *Operation, boxID string) (*parse.Tree, error) {
	data, ok := operation.Data.(string)
	if !ok || data == "" {
		return nil, fmt.Errorf("invalid projected block DOM")
	}
	tree := projection.engine.BlockDOM2Tree(strings.ReplaceAll(data, editor.FrontEndCaret, ""))
	if tree == nil || tree.Root == nil || tree.Root.FirstChild == nil {
		return nil, fmt.Errorf("invalid projected block DOM")
	}
	tree.Box = boxID
	return tree, nil
}

func (projection *collectionRemovalProjection) degradeReferences(tree *parse.Tree) {
	boxID := tree.Box
	allowed := map[string]bool{}
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && node.IsBlock() && node.ID != "" {
			allowed[node.ID] = true
		}
		return ast.WalkContinue
	})
	for id, existing := range projection.nodeTrees {
		if IsSameCryptoBoundary(boxID, existing.Box) {
			allowed[id] = true
		}
	}
	// 显式删除已同步移除实际事务的索引，不能从预览前的持久索引复活目标。
	treenode.WalkWithInlineTitles(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && node.Type == ast.NodeTextMark && node.IsTextMarkType("block-ref") &&
			projection.deleted[node.TextMarkBlockRefID] && !allowed[node.TextMarkBlockRefID] {
			node.TextMarkBlockRefID, node.TextMarkBlockRefSubtype = "", ""
			node.TextMarkType = strings.TrimSpace(strings.ReplaceAll(node.TextMarkType, "block-ref", ""))
			node.TextMarkTextContent = strings.TrimSpace(node.TextMarkTextContent)
		}
		return ast.WalkContinue
	})
	degradeCrossBoundaryBlockRefsWithAllowed(tree.Root, boxID, nil, allowed)
}

func (projection *collectionRemovalProjection) update(operation *Operation, old *ast.Node, tree *parse.Tree) error {
	if old.Parent == nil {
		return fmt.Errorf("cannot project replacement of a document root")
	}
	subtree, err := projection.parse(operation, tree.Box)
	if err != nil {
		return err
	}
	updated, err := resolveBlockUpdateNode(old, subtree.Root)
	if err != nil {
		return err
	}
	tx := &Transaction{fromAPI: true, trees: projection.after}
	if err = tx.validateBlockWriteIDs(updated, tree, old); err != nil {
		return err
	}
	if old.Type == ast.NodeTable && updated.Type == ast.NodeTable &&
		(treenode.HasTableCellRich(old) || old.IALAttr(treenode.TableCellRichTableAttribute) == "1") &&
		updated.IALAttr(treenode.TableCellRichTableAttribute) != "1" {
		return fmt.Errorf("table update omitted rich text format metadata")
	}
	if err = treenode.ValidateTableCellRich(updated); err != nil {
		return err
	}
	if err = treenode.ValidateBlockReplacement(old, updated); err != nil {
		return err
	}
	if err = validateBlockUpdateType(old, updated, operation.LockType); err != nil {
		return err
	}
	projection.degradeReferences(subtree)
	previousHosts := collectionRemovalDatabaseHosts(old)
	if old.IsContainerBlock() {
		treenode.MoveFoldHeading(updated, old)
	}
	if !maps.Equal(previousHosts, collectionRemovalDatabaseHosts(updated)) {
		return fmt.Errorf("unsupported collection removal projection: database host changes")
	}
	var emptyMath []*ast.Node
	ast.Walk(updated, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && node.Type == ast.NodeTextMark && node.IsTextMarkType("inline-math") &&
			strings.TrimSpace(node.TextMarkInlineMathContent) == "" && (node.Parent == nil || node.Parent.TableCellRich == nil) {
			emptyMath = append(emptyMath, node)
		}
		return ast.WalkContinue
	})
	for _, node := range emptyMath {
		node.Unlink()
	}
	if updated.Type == ast.NodeHTMLBlock {
		var lines []string
		for line := range strings.SplitSeq(string(updated.Tokens), "\n") {
			if strings.TrimSpace(line) != "" {
				lines = append(lines, line)
			}
		}
		updated.Tokens = []byte(strings.Join(lines, "\n"))
	}
	oldParentHeading := treenode.GetParentFoldedHeading(old)
	needUnfold := old.HeadingLevel > 0 && (updated.HeadingLevel == 0 || old.HeadingLevel < updated.HeadingLevel)
	old.InsertAfter(updated)
	old.Unlink()
	batchRootID, _ := operation.Context["headingBatchRootID"].(string)
	preserveFold := batchRootID == tree.Root.ID && old.Type == ast.NodeHeading && updated.Type == ast.NodeHeading
	if needUnfold && !preserveFold {
		parent := treenode.GetParentFoldedHeading(updated)
		if oldParentHeading == nil || parent != nil && oldParentHeading.ID != parent.ID {
			treenode.SetSelfFolded(parent, false)
		}
	}
	return nil
}

func collectionRemovalDatabaseHosts(root *ast.Node) map[string]string {
	hosts := map[string]string{}
	ast.Walk(root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && node.Type == ast.NodeAttributeView {
			hosts[node.ID] = node.AttributeViewID
		}
		return ast.WalkContinue
	})
	return hosts
}

func (projection *collectionRemovalProjection) insertionNodes(operation *Operation, parent *ast.Node, tree *parse.Tree) ([]*ast.Node, error) {
	subtree, err := projection.parse(operation, tree.Box)
	if err != nil {
		return nil, err
	}
	if _, err = unwrapNativeContainerInsert(subtree.Root, parent); err != nil {
		return nil, err
	}
	tx := &Transaction{fromAPI: true, trees: projection.after}
	if err = tx.validateBlockWriteIDs(subtree.Root, tree, nil); err != nil {
		return nil, err
	}
	projection.degradeReferences(subtree)
	var nodes []*ast.Node
	for node := subtree.Root.FirstChild; node != nil; node = node.Next {
		if node.Type == ast.NodeKramdownBlockIAL {
			continue
		}
		nodes = append(nodes, node)
	}
	if len(nodes) == 0 {
		return nil, fmt.Errorf("invalid projected insertion")
	}
	return nodes, nil
}

func (projection *collectionRemovalProjection) insert(operation *Operation) error {
	anchorID := operation.ParentID
	if operation.Action == "insert" {
		if operation.NextID != "" {
			anchorID = operation.NextID
		} else if operation.PreviousID != "" {
			anchorID = operation.PreviousID
		}
	}
	anchor, tree, err := projection.node(anchorID)
	if err != nil {
		return err
	}
	if operation.Action == "insert" {
		for _, id := range []string{operation.ParentID, operation.PreviousID, operation.NextID} {
			if id == "" || id == anchorID {
				continue
			}
			_, other, readErr := projection.node(id)
			if readErr != nil && !errors.Is(readErr, ErrBlockNotFound) {
				return readErr
			}
			// 内核从锚点索引选择文档；互相矛盾的跨文档锚点没有唯一的可预览结果。
			if other != nil && other.ID != tree.ID {
				return fmt.Errorf("insertion anchors belong to different documents")
			}
		}
	}
	parent := anchor
	sibling := operation.Action == "insert" && (operation.NextID != "" || operation.PreviousID != "")
	if sibling {
		parent = anchor.Parent
		if parent == nil {
			return fmt.Errorf("document blocks cannot be insertion sibling anchors")
		}
	}
	nodes, err := projection.insertionNodes(operation, parent, tree)
	if err != nil {
		return err
	}
	previousHosts := collectionRemovalDatabaseHosts(tree.Root)
	if operation.Action != "insert" {
		if err = projection.insertAtEdge(operation.Action, anchor, nodes); err != nil {
			return err
		}
		if !maps.Equal(previousHosts, collectionRemovalDatabaseHosts(tree.Root)) {
			return fmt.Errorf("unsupported collection removal projection: database host changes")
		}
		return nil
	}
	first, remains := nodes[0], nodes[1:]
	if sibling {
		if operation.NextID == "" && anchor.Type == ast.NodeHeading && treenode.IsSelfFolded(anchor) {
			if children := treenode.HeadingChildren(anchor); len(children) > 0 {
				anchor = children[len(children)-1]
			}
		}
		if first.Type == ast.NodeList && anchor.Parent.Type == ast.NodeList {
			first = first.FirstChild
			if first == nil {
				return fmt.Errorf("projected list insertion has no item")
			}
		}
		if operation.NextID != "" {
			anchor.InsertBefore(first)
			for _, node := range remains {
				anchor.InsertBefore(node)
			}
		} else {
			for _, node := range slices.Backward(remains) {
				anchor.InsertAfter(node)
			}
			anchor.InsertAfter(first)
		}
	} else if anchor.Type == ast.NodeSuperBlock {
		if anchor.FirstChild == nil || anchor.FirstChild.Next == nil {
			return fmt.Errorf("invalid projected super block")
		}
		anchor.FirstChild.Next.InsertAfter(first)
	} else {
		if first.Type == ast.NodeList && first.FirstChild != nil && operation.ID == first.FirstChild.ID && operation.ID != first.ID {
			first = first.FirstChild
		}
		if anchor.Type == ast.NodeListItem && anchor.ListData != nil && anchor.ListData.Typ == 3 {
			if anchor.FirstChild == nil {
				return fmt.Errorf("invalid projected task list item")
			}
			anchor.FirstChild.InsertAfter(first)
			for _, node := range remains {
				anchor.FirstChild.InsertAfter(node)
			}
		} else if !anchor.IsContainerBlock() {
			for _, node := range slices.Backward(remains) {
				anchor.InsertAfter(node)
			}
			anchor.InsertAfter(first)
		} else {
			for _, node := range slices.Backward(remains) {
				anchor.PrependChild(node)
			}
			anchor.PrependChild(first)
		}
	}
	first.RemoveIALAttr(av.NodeAttrNameAvs)
	first.RemoveIALAttr(av.NodeAttrViewNames)
	first.RemoveIALAttrsByPrefix(av.NodeAttrViewStaticText)
	first.RemoveIALAttr(NodeAttrRiffDecks)
	if !maps.Equal(previousHosts, collectionRemovalDatabaseHosts(tree.Root)) {
		return fmt.Errorf("unsupported collection removal projection: database host changes")
	}
	return nil
}

func (projection *collectionRemovalProjection) insertAtEdge(action string, anchor *ast.Node, nodes []*ast.Node) error {
	prepend := action == "prependInsert"
	if prepend || !anchor.IsContainerBlock() {
		slices.Reverse(nodes)
	}
	var headingEnd *ast.Node
	if !prepend && anchor.Type == ast.NodeHeading {
		if children := treenode.HeadingChildren(anchor); len(children) > 0 {
			headingEnd = children[len(children)-1]
		}
	}
	for _, node := range nodes {
		if !anchor.IsContainerBlock() {
			if headingEnd != nil {
				headingEnd.InsertAfter(node)
			} else {
				anchor.InsertAfter(node)
			}
			continue
		}
		switch anchor.Type {
		case ast.NodeList:
			if anchor.ListData == nil {
				return fmt.Errorf("invalid projected list")
			}
			if node.Type == ast.NodeList {
				var children []*ast.Node
				for child := node.FirstChild; child != nil; child = child.Next {
					children = append(children, child)
				}
				if prepend {
					slices.Reverse(children)
				}
				for _, child := range children {
					if prepend {
						anchor.PrependChild(child)
					} else {
						anchor.AppendChild(child)
					}
				}
			} else {
				item := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeListItem, ListData: &ast.ListData{Typ: anchor.ListData.Typ}}
				item.SetIALAttr("id", item.ID)
				if prepend {
					anchor.PrependChild(item)
				} else {
					anchor.AppendChild(item)
				}
				item.AppendChild(node)
			}
		case ast.NodeSuperBlock:
			if anchor.FirstChild == nil || anchor.LastChild == nil {
				return fmt.Errorf("invalid projected super block")
			}
			if prepend {
				layout := anchor.ChildByType(ast.NodeSuperBlockLayoutMarker)
				if layout == nil {
					layout = anchor.FirstChild
				}
				layout.InsertAfter(node)
			} else {
				anchor.LastChild.InsertBefore(node)
			}
		default:
			if prepend {
				anchor.PrependChild(node)
			} else {
				anchor.AppendChild(node)
			}
		}
	}
	return nil
}

func (projection *collectionRemovalProjection) move(operation *Operation) error {
	node, source, err := projection.node(operation.ID)
	if err != nil {
		return err
	}
	if node.Parent == nil {
		return fmt.Errorf("document blocks cannot be moved with block transactions")
	}
	var children []*ast.Node
	if node.Type == ast.NodeHeading && treenode.IsSelfFolded(node) {
		children = treenode.HeadingChildren(node)
	}
	var emptyList *ast.Node
	if node.Type == ast.NodeListItem && node.Parent.FirstChild == node && node.Parent.LastChild == node {
		emptyList = node.Parent
	}
	anchorID := operation.ParentID
	before := operation.NextID != ""
	sibling := operation.Action == "move" && (before || operation.PreviousID != "")
	if sibling {
		anchorID = operation.NextID
		if !before {
			anchorID = operation.PreviousID
		}
	}
	if anchorID == node.ID {
		return fmt.Errorf("cannot project a block move into itself")
	}
	anchor, target, err := projection.node(anchorID)
	if err != nil {
		return err
	}
	if !IsSameCryptoBoundary(source.Box, target.Box) {
		return fmt.Errorf("cannot move blocks across encrypted notebook boundaries")
	}
	if operation.Action == "append" {
		anchor = target.Root
	}
	if sibling {
		if anchor.Parent == nil {
			return fmt.Errorf("document blocks cannot be move sibling anchors")
		}
		if !before && anchor.Type == ast.NodeHeading && treenode.IsSelfFolded(anchor) {
			if below := treenode.HeadingChildren(anchor); len(below) > 0 {
				anchor = below[len(below)-1]
			}
		}
	}
	if isMovingFoldHeadingIntoSelf(anchor, children) || isMovingParentIntoChild(node, anchor) {
		return fmt.Errorf("cannot project a block move into its descendants")
	}
	if operation.Action == "move" && operation.Context["removeFold"] == "true" {
		treenode.SetSelfFolded(node, false)
	}
	if operation.Action == "append" {
		root := target.Root
		if node.Type == ast.NodeListItem {
			if node.ListData == nil {
				return fmt.Errorf("invalid projected list item")
			}
			if root.LastChild != nil && root.LastChild.Type != ast.NodeList {
				list := &ast.Node{ID: ast.NewNodeID(), Type: ast.NodeList, ListData: &ast.ListData{Typ: node.ListData.Typ}}
				list.SetIALAttr("id", list.ID)
				list.AppendChild(node)
				root.AppendChild(list)
			} else if root.LastChild != nil {
				root.LastChild.AppendChild(node)
			} else {
				root.AppendChild(node)
			}
		} else {
			root.AppendChild(node)
		}
		for _, child := range children {
			root.AppendChild(child)
		}
	} else if sibling {
		if before {
			anchor.InsertBefore(node)
			for _, child := range children {
				anchor.InsertBefore(child)
			}
		} else {
			for _, child := range slices.Backward(children) {
				anchor.InsertAfter(child)
			}
			anchor.InsertAfter(node)
		}
	} else {
		if anchor.Type == ast.NodeSuperBlock {
			if anchor.FirstChild == nil || anchor.FirstChild.Next == nil {
				return fmt.Errorf("invalid projected super block")
			}
			anchor = anchor.FirstChild.Next
		} else if anchor.Type == ast.NodeListItem && anchor.ListData != nil && anchor.ListData.Typ == 3 {
			if anchor.FirstChild == nil {
				return fmt.Errorf("invalid projected task list item")
			}
			anchor = anchor.FirstChild
		} else {
			for _, child := range slices.Backward(children) {
				anchor.PrependChild(child)
			}
			anchor.PrependChild(node)
			anchor = nil
		}
		if anchor != nil {
			for _, child := range slices.Backward(children) {
				anchor.InsertAfter(child)
			}
			anchor.InsertAfter(node)
		}
	}
	if emptyList != nil {
		emptyList.Unlink()
	}
	return nil
}
