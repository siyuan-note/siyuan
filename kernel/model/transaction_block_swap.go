package model

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type blockSwapOptions struct {
	IncludeChildren *bool `json:"includeChildren"`
	OriginalToEmbed *bool `json:"originalToEmbed"`
}

// 撤销快照仅保存在内核内存中，客户端不能提交或替换快照。
type blockSwapState struct {
	before, after []blockSwapFragment
	rootIDs       []string
}

type blockSwapFragment struct {
	rootID, boxID, previousID, nextID string
	node                              *ast.Node
}

func (tx *Transaction) doSwapBlockRef(operation *Operation) *TxErr {
	fail := func(err error) *TxErr {
		return &TxErr{code: TxErrCodePushMsg, id: operation.ID, msg: err.Error()}
	}
	if len(tx.DoOperations) != 1 {
		return fail(errors.New("block swap must be submitted as a separate transaction"))
	}
	if tx.isReplay {
		if operation.blockSwapState == nil {
			return fail(errors.New("block swap undo state is unavailable"))
		}
		if err := tx.replayBlockSwap(operation); err != nil {
			return fail(err)
		}
		return nil
	}
	data, err := json.Marshal(operation.Data)
	if err != nil {
		return fail(err)
	}
	var options blockSwapOptions
	if err = json.Unmarshal(data, &options); err != nil || options.IncludeChildren == nil || options.OriginalToEmbed == nil {
		return fail(errors.New("invalid block swap options"))
	}
	refTree, err := tx.loadTree(operation.ID)
	if err != nil {
		return fail(err)
	}
	defTree, err := tx.loadTree(operation.BlockID)
	if err != nil {
		return fail(err)
	}
	if !IsSameCryptoBoundary(refTree.Box, defTree.Box) {
		return fail(errors.New("cannot swap blocks across encrypted notebook boundaries"))
	}
	ref := treenode.GetNodeInTree(refTree, operation.ID)
	def := treenode.GetNodeInTree(defTree, operation.BlockID)
	if err = validateBlockSwap(ref, def, *options.IncludeChildren); err != nil {
		return fail(err)
	}
	trees := []*parse.Tree{refTree}
	if refTree.ID != defTree.ID {
		trees = append(trees, defTree)
	}
	before := captureBlockSwapFragments(trees)
	tx.saveBlockSwapOriginalTrees(trees)
	swapBlockRefNodes(ref, def, operation.BlockID, *options.IncludeChildren, *options.OriginalToEmbed)
	after := captureBlockSwapFragments(trees)
	state := newBlockSwapState(before, after)
	operation.blockSwapState = state
	operation.RetData = state.rootIDs
	tx.UndoOperations = []*Operation{{Action: "swapBlockRef", ID: operation.ID, BlockID: operation.BlockID,
		Data: operation.Data, RetData: state.rootIDs, blockSwapState: state, blockSwapUndo: true}}
	tx.finishBlockSwap(state.before, state.after, trees)
	return nil
}

func validateBlockSwap(ref, def *ast.Node, includeChildren bool) error {
	if ref == nil || def == nil || ref.Parent == nil || def.Parent == nil {
		return errors.New("block swap requires two non-document blocks")
	}
	if ref.Parent.Type == ast.NodeListItem {
		ref = ref.Parent
	}
	if def.Parent.Type == ast.NodeListItem {
		def = def.Parent
	}
	contains := func(parent, node *ast.Node) bool {
		for ; node != nil; node = node.Parent {
			if node == parent {
				return true
			}
		}
		return false
	}
	if contains(ref, def) || contains(def, ref) {
		return errors.New("cannot swap a block with itself or its ancestor")
	}
	if includeChildren && def.Type == ast.NodeHeading {
		for _, child := range treenode.HeadingChildren(def) {
			if contains(child, ref) {
				return errors.New("cannot swap a heading with a block in its section")
			}
		}
	}
	return nil
}

func captureBlockSwapFragments(trees []*parse.Tree) (ret []blockSwapFragment) {
	for _, tree := range trees {
		var previousID string
		for node := tree.Root.FirstChild; node != nil; node = node.Next {
			if !node.IsBlock() || node.ID == "" {
				continue
			}
			fragment := blockSwapFragment{rootID: tree.ID, boxID: tree.Box, previousID: previousID, node: cloneBlockSwapNode(node)}
			for next := node.Next; next != nil; next = next.Next {
				if next.IsBlock() && next.ID != "" {
					fragment.nextID = next.ID
					break
				}
			}
			ret = append(ret, fragment)
			previousID = node.ID
		}
	}
	return
}

func blockSwapFingerprint(node *ast.Node) string {
	cloned := cloneRenderNode(node)
	ast.Walk(cloned, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering {
			n.RemoveIALAttr("updated")
			n.RemoveIALAttr("refcount")
			if n.Type == ast.NodeTextMark && n.IsTextMarkType("block-ref") && n.TextMarkBlockRefSubtype == "d" {
				n.TextMarkTextContent = ""
			}
		}
		return ast.WalkContinue
	})
	luteEngine := util.NewLute()
	return string(render.NewJSONRenderer(&parse.Tree{Root: cloned}, luteEngine.RenderOptions, luteEngine.ParseOptions).Render())
}

func newBlockSwapState(before, after []blockSwapFragment) *blockSwapState {
	state := &blockSwapState{}
	old := map[string]blockSwapFragment{}
	changed := map[string]bool{}
	for _, fragment := range before {
		old[fragment.node.ID] = fragment
	}
	for _, fragment := range after {
		previous, exists := old[fragment.node.ID]
		if !exists || previous.rootID != fragment.rootID || previous.previousID != fragment.previousID ||
			blockSwapFingerprint(previous.node) != blockSwapFingerprint(fragment.node) {
			changed[fragment.node.ID] = true
		}
		delete(old, fragment.node.ID)
	}
	for id := range old {
		changed[id] = true
	}
	roots := map[string]bool{}
	for _, fragment := range before {
		if changed[fragment.node.ID] {
			state.before = append(state.before, fragment)
			if !roots[fragment.rootID] {
				state.rootIDs = append(state.rootIDs, fragment.rootID)
				roots[fragment.rootID] = true
			}
		}
	}
	for _, fragment := range after {
		if changed[fragment.node.ID] {
			state.after = append(state.after, fragment)
		}
	}
	return state
}

func (tx *Transaction) replayBlockSwap(operation *Operation) error {
	state := operation.blockSwapState
	from, to := state.before, state.after
	if operation.blockSwapUndo {
		from, to = to, from
	}
	trees := map[string]*parse.Tree{}
	var orderedTrees []*parse.Tree
	for _, rootID := range state.rootIDs {
		tree, err := tx.loadTree(rootID)
		if err != nil {
			return err
		}
		trees[rootID] = tree
		orderedTrees = append(orderedTrees, tree)
	}
	for _, tree := range orderedTrees {
		if !IsSameCryptoBoundary(orderedTrees[0].Box, tree.Box) {
			return errors.New("cannot replay block swap across encrypted notebook boundaries")
		}
	}
	tx.saveBlockSwapOriginalTrees(orderedTrees)
	if err := restoreBlockSwapFragments(from, to, trees); err != nil {
		return err
	}
	tx.finishBlockSwap(from, to, orderedTrees)
	operation.RetData = state.rootIDs
	return nil
}

func restoreBlockSwapFragments(from, to []blockSwapFragment, trees map[string]*parse.Tree) error {
	removing := map[string]bool{}
	for _, fragment := range from {
		tree := trees[fragment.rootID]
		if tree == nil || tree.Box != fragment.boxID {
			return errors.New("block swap notebook has changed")
		}
		node := treenode.GetNodeInTree(tree, fragment.node.ID)
		if node == nil || node.Parent != tree.Root || blockSwapFingerprint(node) != blockSwapFingerprint(fragment.node) {
			return fmt.Errorf("block changed since conversion: %s", fragment.node.ID)
		}
		previousID, nextID := "", ""
		for previous := node.Previous; previous != nil; previous = previous.Previous {
			if previous.IsBlock() && previous.ID != "" {
				previousID = previous.ID
				break
			}
		}
		for next := node.Next; next != nil; next = next.Next {
			if next.IsBlock() && next.ID != "" {
				nextID = next.ID
				break
			}
		}
		if previousID != fragment.previousID || nextID != fragment.nextID {
			return fmt.Errorf("block position changed since conversion: %s", fragment.node.ID)
		}
		for _, id := range node.BlockIDs() {
			removing[id] = true
		}
	}
	available := map[string]bool{}
	for _, fragment := range to {
		tree := trees[fragment.rootID]
		if tree == nil || tree.Box != fragment.boxID {
			return errors.New("block swap notebook has changed")
		}
		if fragment.previousID != "" && !available[fragment.previousID] {
			previous := treenode.GetNodeInTree(tree, fragment.previousID)
			if previous == nil || previous.Parent != tree.Root || removing[previous.ID] {
				return errors.New("block swap insertion position has changed")
			}
		}
		for _, id := range fragment.node.BlockIDs() {
			if existing := treenode.GetBlockTreeInBox(id, fragment.boxID); existing != nil && !removing[id] {
				return fmt.Errorf("block swap ID already exists: %s", id)
			}
			for _, currentTree := range trees {
				if treenode.GetNodeInTree(currentTree, id) != nil && !removing[id] {
					return fmt.Errorf("block swap ID already exists: %s", id)
				}
			}
		}
		available[fragment.node.ID] = true
	}
	for _, fragment := range from {
		treenode.GetNodeInTree(trees[fragment.rootID], fragment.node.ID).Unlink()
	}
	for _, fragment := range to {
		tree := trees[fragment.rootID]
		node := cloneBlockSwapNode(fragment.node)
		if fragment.previousID == "" {
			tree.Root.PrependChild(node)
		} else {
			treenode.GetNodeInTree(tree, fragment.previousID).InsertAfter(node)
		}
	}
	return nil
}

func (tx *Transaction) finishBlockSwap(from, to []blockSwapFragment, trees []*parse.Tree) {
	origins := map[string]string{}
	for _, fragment := range from {
		for _, id := range fragment.node.BlockIDs() {
			origins[id] = fragment.rootID
		}
		treenode.RemoveBlockTreesByIDs(fragment.boxID, fragment.node.BlockIDs())
	}
	for _, tree := range trees {
		treenode.RefreshUpdated(tree.Root)
		tx.writeTree(tree)
	}
	for _, fragment := range to {
		var tree *parse.Tree
		for _, candidate := range trees {
			if candidate.ID == fragment.rootID {
				tree = candidate
				break
			}
		}
		ast.Walk(treenode.GetNodeInTree(tree, fragment.node.ID), func(node *ast.Node, entering bool) ast.WalkStatus {
			if entering && node.IsBlock() {
				tx.nodes[node.ID] = node
				if originalRootID := origins[node.ID]; originalRootID != "" && originalRootID != tree.ID {
					tx.recordCrossTreeMoveRefRefresh(&parse.Tree{ID: originalRootID, Box: tree.Box}, tree, node, nil)
				}
			}
			return ast.WalkContinue
		})
	}
}

func (tx *Transaction) saveBlockSwapOriginalTrees(trees []*parse.Tree) {
	for _, tree := range trees {
		generateOpTypeHistory(tree, HistoryOpUpdate)
		cloned := *tree
		cloned.Root = cloneBlockSwapNode(tree.Root)
		tx.blockSwapOriginalTrees = append(tx.blockSwapOriginalTrees, &cloned)
	}
}

func cloneBlockSwapNode(node *ast.Node) *ast.Node {
	cloned := cloneRenderNode(node)
	ast.Walk(cloned, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && n.ListData != nil {
			listData := *n.ListData
			n.ListData = &listData
		}
		return ast.WalkContinue
	})
	return cloned
}
