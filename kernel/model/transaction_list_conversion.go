package model

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 文档片段和主键换绑快照仅由内核生成，其他字段在重放时保留当前值。
type listConversionState struct {
	fragments *blockSwapState
	bindings  []*listConversionBinding
	focusID   string
}

type listConversionBinding struct {
	avID, boxID, rootID string
	before, after       *av.Value
}

func (tx *Transaction) doConvertList(op *Operation) *TxErr {
	fail := func(err error) *TxErr {
		return &TxErr{code: TxErrCodePushMsg, id: op.ID, msg: err.Error()}
	}
	if len(tx.DoOperations) != 1 {
		return fail(errors.New("list conversion requires a separate transaction"))
	}
	if tx.isReplay {
		if op.listConversion == nil {
			return fail(errors.New("list conversion undo state is unavailable"))
		}
		if err := tx.replayListConversion(op); err != nil {
			return fail(err)
		}
		return nil
	}
	data, err := json.Marshal(op.Data)
	if err != nil {
		return fail(err)
	}
	var options apicontract.TransactionListConversion
	if err = json.Unmarshal(data, &options); err != nil || !slices.Contains([]string{"heading", "paragraph", "remove"}, options.Type) ||
		(options.Type == "heading" && (options.Level < 1 || options.Level > 6)) || len(op.BlockIDs) == 0 {
		return fail(errors.New("invalid list conversion options"))
	}
	originals := map[string]*parse.Tree{}
	working := map[string]*parse.Tree{}
	var selected []*ast.Node
	var ordered []*parse.Tree
	for _, id := range op.BlockIDs {
		tree, loadErr := tx.loadTree(id)
		if loadErr != nil {
			return fail(loadErr)
		}
		if len(ordered) > 0 && !IsSameCryptoBoundary(ordered[0].Box, tree.Box) {
			return fail(errors.New("cannot convert lists across encrypted notebook boundaries"))
		}
		if working[tree.ID] == nil {
			originals[tree.ID] = tree
			copy := *tree
			copy.Root = cloneBlockSwapNode(tree.Root)
			working[tree.ID] = &copy
			ordered = append(ordered, &copy)
		}
		node := treenode.GetNodeInTree(working[tree.ID], id)
		if node == nil || !slices.Contains([]ast.NodeType{ast.NodeList, ast.NodeListItem, ast.NodeParagraph, ast.NodeHeading}, node.Type) {
			return fail(errors.New("invalid list conversion block"))
		}
		for parent := node; parent != nil; parent = parent.Parent {
			if parent.IALAttr("custom-sy-readonly") == "true" || parent.Type == ast.NodeMindmapItem {
				return fail(errors.New("list conversion requires editable blocks"))
			}
		}
		selected = append(selected, node)
	}
	var sourceTrees []*parse.Tree
	for _, tree := range ordered {
		sourceTrees = append(sourceTrees, originals[tree.ID])
	}
	before := captureBlockSwapFragments(sourceTrees)
	removed, focusID, err := convertListNodes(selected, options)
	if err != nil {
		return fail(err)
	}
	state := &listConversionState{focusID: focusID}
	views, err := tx.prepareListConversionBindings(sourceTrees, working, removed, state)
	if err != nil {
		return fail(err)
	}
	state.fragments = newBlockSwapState(before, captureBlockSwapFragments(ordered))
	if len(state.fragments.rootIDs) == 0 {
		op.RetData = listConversionResult(state, false)
		tx.trees = map[string]*parse.Tree{}
		tx.UndoOperations = nil
		return nil
	}
	// 完成整批检查后才备份和写入，每个文档及数据库只处理一次。
	for _, tree := range sourceTrees {
		if err = tx.rememberAttributeViewMutationTree(tree.ID); err != nil {
			return fail(err)
		}
	}
	if err = saveListConversionHistory(sourceTrees); err != nil {
		return fail(err)
	}
	for _, tree := range ordered {
		tx.trees[tree.ID] = tree
	}
	if err = tx.saveListConversionViews(views, state.bindings); err != nil {
		return fail(err)
	}
	tx.finishBlockSwap(state.fragments.before, state.fragments.after, ordered)
	op.listConversion = state
	op.RetData = listConversionResult(state, false)
	tx.UndoOperations = []*Operation{{Action: "convertList", ID: op.ID, BlockIDs: slices.Clone(op.BlockIDs), Data: op.Data,
		listConversion: state, listConversionUndo: true}}
	return nil
}

func firstListConversionBlock(item *ast.Node) *ast.Node {
	for child := item.FirstChild; child != nil; child = child.Next {
		if child.IsBlock() && child.Type != ast.NodeKramdownBlockIAL {
			return child
		}
	}
	return nil
}

func listConversionItems(list *ast.Node) (items []*ast.Node) {
	for child := list.FirstChild; child != nil; child = child.Next {
		if child.Type == ast.NodeListItem {
			items = append(items, child)
		}
	}
	return
}

func convertListText(node *ast.Node, options apicontract.TransactionListConversion) {
	if options.Type == "remove" {
		return
	}
	if node.Type == ast.NodeHeading && (options.Type == "paragraph" || node.HeadingLevel != options.Level) {
		node.RemoveIALAttr("fold")
	}
	if options.Type == "heading" {
		node.Type, node.HeadingLevel = ast.NodeHeading, options.Level
		if node.FirstChild != nil {
			node.FirstChild.Tokens = bytes.TrimLeft(bytes.ReplaceAll(node.FirstChild.Tokens, []byte("\n"), nil), " \t\n")
		}
	} else {
		node.Type, node.HeadingLevel = ast.NodeParagraph, 0
	}
}

// 在副本中解包列表，首个保留片段沿用列表 ID，后续片段使用独立身份。
func convertListNodes(selected []*ast.Node, options apicontract.TransactionListConversion) (map[string]string, string, error) {
	selected = slices.DeleteFunc(slices.Clone(selected), func(node *ast.Node) bool {
		for parent := node.Parent; parent != nil; parent = parent.Parent {
			if slices.Contains(selected, parent) {
				return true
			}
		}
		return false
	})
	var candidates []*ast.Node
	for _, node := range selected {
		candidates = append(candidates, node)
		if options.Recursively && (node.Type == ast.NodeList || node.Type == ast.NodeListItem) {
			ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
				if entering && n != node && n.Type == ast.NodeList && n.ListData.Typ == node.ListData.Typ {
					candidates = append(candidates, n)
				}
				return ast.WalkContinue
			})
		}
	}
	lists := map[*ast.Node]map[string]bool{}
	focusID := ""
	for _, node := range candidates {
		if node.Type == ast.NodeParagraph || node.Type == ast.NodeHeading {
			convertListText(node, options)
			if focusID == "" {
				focusID = node.ID
			}
			continue
		}
		list := node
		items := listConversionItems(node)
		if node.Type == ast.NodeListItem {
			list, items = node.Parent, []*ast.Node{node}
		}
		if list == nil || list.Type != ast.NodeList {
			return nil, "", errors.New("invalid list item parent")
		}
		if lists[list] == nil {
			lists[list] = map[string]bool{}
		}
		for _, item := range items {
			first := firstListConversionBlock(item)
			if first == nil || options.Type != "remove" && first.Type != ast.NodeParagraph && first.Type != ast.NodeHeading {
				continue
			}
			readonly := false
			ast.Walk(item, func(n *ast.Node, entering bool) ast.WalkStatus {
				if entering && n.IALAttr("custom-sy-readonly") == "true" {
					readonly = true
				}
				return ast.WalkContinue
			})
			if readonly {
				return nil, "", errors.New("list conversion requires editable blocks")
			}
			lists[list][item.ID] = true
			if focusID == "" {
				focusID = first.ID
			}
		}
	}
	var ordered []*ast.Node
	for list := range lists {
		ordered = append(ordered, list)
	}
	depth := func(node *ast.Node) (ret int) {
		for ; node != nil; node = node.Parent {
			ret++
		}
		return
	}
	sort.SliceStable(ordered, func(i, j int) bool { return depth(ordered[i]) > depth(ordered[j]) })
	removed := map[string]string{}
	for _, list := range ordered {
		itemIDs := lists[list]
		if len(itemIDs) == 0 {
			continue
		}
		var output []*ast.Node
		var run *ast.Node
		retained := false
		var targets []string
		for _, item := range listConversionItems(list) {
			if !itemIDs[item.ID] {
				if run == nil {
					// 只复制列表外壳，避免每个保留片段重复复制整份列表。
					shell := *list
					shell.FirstChild, shell.LastChild, shell.Parent, shell.Previous, shell.Next = nil, nil, nil, nil, nil
					run = cloneBlockSwapNode(&shell)
					if retained {
						run.ID = ast.NewNodeID()
						run.KramdownIAL = nil
						run.SetIALAttr("id", run.ID)
						if style := list.IALAttr("style"); style != "" {
							run.SetIALAttr("style", style)
						}
					}
					retained = true
					if run.ListData.Typ == 1 {
						run.ListData.Start = item.ListData.Num
					}
					output = append(output, run)
				}
				run.AppendChild(item)
				continue
			}
			run = nil
			first := firstListConversionBlock(item)
			removed[item.ID] = first.ID
			targets = append(targets, first.ID)
			if options.Type != "remove" {
				convertListText(first, options)
			}
			for child := item.FirstChild; child != nil; {
				next := child.Next
				if child.IsBlock() && child.Type != ast.NodeKramdownBlockIAL {
					child.Unlink()
					output = append(output, child)
				}
				child = next
			}
		}
		if !retained {
			removed[list.ID] = ""
			if len(targets) == 1 {
				removed[list.ID] = targets[0]
			}
		}
		for _, node := range output {
			list.InsertBefore(node)
		}
		list.Unlink()
	}
	return removed, focusID, nil
}

func (tx *Transaction) prepareListConversionBindings(originals []*parse.Tree, trees map[string]*parse.Tree,
	removed map[string]string, state *listConversionState) (map[string]*av.AttributeView, error) {
	views := map[string]*av.AttributeView{}
	for _, tree := range originals {
		var failure error
		ast.Walk(tree.Root, func(source *ast.Node, entering bool) ast.WalkStatus {
			if !entering || failure != nil {
				return ast.WalkContinue
			}
			targetID, deleting := removed[source.ID]
			if !deleting {
				return ast.WalkContinue
			}
			avIDs := strings.Split(source.IALAttr(av.NodeAttrNameAvs), ",")
			for _, avID := range avIDs {
				if avID == "" {
					continue
				}
				for next, exists := removed[targetID]; exists && next != targetID; next, exists = removed[targetID] {
					targetID = next
				}
				if targetID == "" {
					failure = errors.New(Conf.Language(410))
					break
				}
				target := treenode.GetNodeInTree(trees[tree.ID], targetID)
				if target == nil {
					failure = ErrBlockNotFound
					break
				}
				if views[avID] == nil {
					boxID := av.GetAVBoxID(avID)
					if failure = validateAttributeViewBinding(avID, tree); failure != nil {
						break
					}
					current, err := tx.readAttributeViewForMutation(avID, tree.ID, boxID)
					if err != nil {
						failure = err
						break
					}
					views[avID], failure = cloneAttributeViewForFieldMutation(current)
					if failure != nil {
						break
					}
				}
				view := views[avID]
				value := view.GetBlockValueByBoundID(source.ID)
				if value == nil || value.Block == nil || value.IsDetached {
					failure = av.ErrItemNotFound
					break
				}
				if existing := view.GetBlockValueByBoundID(targetID); existing != nil && existing.BlockID != value.BlockID {
					failure = errors.New(Conf.Language(411))
					break
				}
				binding := &listConversionBinding{avID: avID, boxID: av.GetAVBoxID(avID), rootID: tree.ID, before: value.Clone()}
				ids := strings.Split(target.IALAttr(av.NodeAttrNameAvs), ",")
				ids = slices.DeleteFunc(ids, func(id string) bool { return id == "" })
				if !slices.Contains(ids, avID) {
					ids = append(ids, avID)
				}
				target.SetIALAttr(av.NodeAttrNameAvs, strings.Join(ids, ","))
				target.SetIALAttr(av.NodeAttrViewNames, getAvNames(strings.Join(ids, ",")))
				for _, attr := range source.KramdownIAL {
					if attr[0] == av.NodeAttrViewStaticText+"-"+avID {
						target.SetIALAttr(attr[0], source.IALAttr(attr[0]))
					}
				}
				if icon := attributeViewInheritedBlockIcon(target, value.Block.Icon); icon != "" {
					target.SetIALAttr("icon", icon)
				}
				value.Block.ID = targetID
				icon, content := getNodeAvBlockText(target, avID)
				value.Block.Icon, value.Block.Content, value.Block.RefSubtype = icon, util.UnescapeHTML(content), getNodeAvBlockRefSubtype(target, avID)
				binding.after = value.Clone()
				state.bindings = append(state.bindings, binding)
			}
			return ast.WalkContinue
		})
		if failure != nil {
			return nil, failure
		}
	}
	return views, nil
}

func (tx *Transaction) saveListConversionViews(views map[string]*av.AttributeView, bindings []*listConversionBinding) error {
	for _, id := range sortedAttributeViewFieldKeys(views) {
		view := views[id]
		regenAttrViewGroups(view)
		rootID := ""
		for _, binding := range bindings {
			if binding.avID == id {
				rootID = binding.rootID
				break
			}
		}
		boxID := av.GetAVBoxID(id)
		if tx.attributeViewRollback.views[boxID+"/"+id] == nil {
			current, err := tx.readAttributeViewForMutation(id, rootID, boxID)
			if err != nil {
				return err
			}
			tx.attributeViewRollback.views[boxID+"/"+id] = current
		}
		if err := avSaveView(view, rootID); err != nil {
			return err
		}
		refreshRelatedSrcAvsInBlock(id, rootID, tx)
	}
	return nil
}

func (tx *Transaction) replayListConversion(op *Operation) error {
	state := op.listConversion
	from, to := state.fragments.before, state.fragments.after
	if op.listConversionUndo {
		from, to = to, from
	}
	trees := map[string]*parse.Tree{}
	var ordered []*parse.Tree
	for _, rootID := range state.fragments.rootIDs {
		tree, err := tx.loadTree(rootID)
		if err != nil {
			return err
		}
		if len(ordered) > 0 && !IsSameCryptoBoundary(ordered[0].Box, tree.Box) {
			return errors.New("list conversion notebook boundary changed")
		}
		copy := *tree
		copy.Root = cloneBlockSwapNode(tree.Root)
		trees[rootID] = &copy
		ordered = append(ordered, &copy)
	}
	if err := restoreBlockSwapFragments(from, to, trees); err != nil {
		return err
	}
	views := map[string]*av.AttributeView{}
	for _, binding := range state.bindings {
		if views[binding.avID] == nil {
			current, err := tx.readAttributeViewForMutation(binding.avID, binding.rootID, binding.boxID)
			if err != nil {
				return err
			}
			views[binding.avID], err = cloneAttributeViewForFieldMutation(current)
			if err != nil {
				return err
			}
		}
		expected, desired := binding.before, binding.after
		if op.listConversionUndo {
			expected, desired = desired, expected
		}
		view := views[binding.avID]
		value := view.GetBlockValue(expected.BlockID)
		if value == nil || value.Block == nil || value.ID != expected.ID || value.KeyID != expected.KeyID || value.IsDetached || value.Block.ID != expected.Block.ID {
			return fmt.Errorf("database entry binding [%s] changed", expected.BlockID)
		}
		if existing := view.GetBlockValueByBoundID(desired.Block.ID); existing != nil && existing.BlockID != value.BlockID {
			return errors.New(Conf.Language(411))
		}
		block := desired.Clone().Block
		block.Created, block.Updated = value.Block.Created, value.Block.Updated
		value.Block = block
	}
	for _, tree := range ordered {
		if err := tx.rememberAttributeViewMutationTree(tree.ID); err != nil {
			return err
		}
	}
	for _, tree := range ordered {
		tx.trees[tree.ID] = tree
	}
	if err := tx.saveListConversionViews(views, state.bindings); err != nil {
		return err
	}
	tx.finishBlockSwap(from, to, ordered)
	op.RetData = listConversionResult(state, op.listConversionUndo)
	return nil
}

func listConversionResult(state *listConversionState, undo bool) apicontract.TransactionListConversionResult {
	from, to := state.fragments.before, state.fragments.after
	if undo {
		from, to = to, from
	}
	ret := apicontract.TransactionListConversionResult{RootIDs: append([]string{}, state.fragments.rootIDs...), RemovedIDs: []string{}, FocusID: state.focusID}
	kept := map[string]bool{}
	for _, fragment := range to {
		for _, id := range fragment.node.BlockIDs() {
			kept[id] = true
		}
	}
	for _, fragment := range from {
		for _, id := range fragment.node.BlockIDs() {
			if !kept[id] {
				ret.RemovedIDs = append(ret.RemovedIDs, id)
			}
		}
	}
	return ret
}

// 历史目录独立于同秒其他操作，文档及数据库快照保持配对；加密数据直接保存经过认证读取的密文。
func saveListConversionHistory(trees []*parse.Tree) error {
	dir := filepath.Join(util.HistoryDir, time.Now().Format("2006-01-02-150405.000000000")+"-"+HistoryOpFormat)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	var err error
	for _, tree := range trees {
		if err = backupBoundAttributeViewHistory(tree, dir); err != nil {
			return err
		}
		data, readErr := filelock.ReadFile(filepath.Join(util.DataDir, tree.Box, tree.Path))
		if readErr != nil {
			return readErr
		}
		target := filepath.Join(dir, tree.Box, tree.Path)
		if err = os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return err
		}
		if err = gulu.File.WriteFileSafer(target, data, 0644); err != nil {
			return err
		}
	}
	indexHistoryDir(filepath.Base(dir), util.NewLute())
	return nil
}
