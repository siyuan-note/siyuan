package model

import (
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
)

func (tx *Transaction) collectDeletedAttributeViewBlocks(node *ast.Node, tree *parse.Tree, descendants bool) {
	bound := map[string]map[string]struct{}{}
	collectDeletedAttributeViewBlocks(node, descendants, bound)
	if len(bound) == 0 {
		return
	}
	if err := tx.rememberAttributeViewMutationTree(tree.ID); err != nil {
		tx.attributeViewDeletionErr = err
		return
	}
	boxID := ""
	if IsEncryptedBox(tree.Box) {
		boxID = tree.Box
	}
	for id, blocks := range bound {
		key := boxID + "/" + id
		if tx.deletedAttrViewBlockIDs[key] == nil {
			tx.deletedAttrViewBlockIDs[key] = map[string]struct{}{}
		}
		for blockID := range blocks {
			tx.deletedAttrViewBlockIDs[key][blockID] = struct{}{}
		}
		tx.deletedAttrViewCarriers[key] = tree.ID
	}
}

// 删除正文块时同时记录数据库变化，逆操作放在正文恢复之后执行。
func (tx *Transaction) flushAttributeViewBlockDeletions() error {
	for _, key := range sortedAttributeViewFieldKeys(tx.deletedAttrViewBlockIDs) {
		boxID, avID, _ := strings.Cut(key, "/")
		carrier := tx.deletedAttrViewCarriers[key]
		original, err := tx.readAttributeViewForMutation(avID, carrier, boxID)
		if errors.Is(err, av.ErrViewNotFound) {
			continue
		}
		if err != nil {
			return err
		}
		current, err := cloneAttributeViewForFieldMutation(original)
		if err != nil {
			return err
		}
		if !removeAttributeViewBoundItems(current, tx.deletedAttrViewBlockIDs[key], true) {
			continue
		}
		state := &attributeViewFieldsSnapshot{avID: avID, keyID: avID, blockID: carrier, boxID: boxID,
			changes: map[string]*attributeViewFieldChange{}, fieldTypes: map[string]map[string]av.KeyType{avID: {}}}
		for _, kv := range original.KeyValues {
			if remaining, _ := current.GetKeyValues(kv.Key.ID); len(remaining.Values) != len(kv.Values) {
				state.fieldTypes[avID][kv.Key.ID] = kv.Key.Type
			}
		}
		regenAttrViewGroups(current)
		if err = tx.saveAttributeViewFieldChanges(state, map[string]*av.AttributeView{avID: original},
			map[string]*av.AttributeView{avID: current}); err != nil {
			return err
		}
		if !tx.fromAPI || tx.isReplay || len(tx.UndoOperations) == 0 {
			continue
		}
		current, err = tx.readAttributeViewForMutation(avID, carrier, boxID)
		if err != nil {
			return err
		}
		oldJSON, err := attributeViewFieldJSON(original)
		if err != nil {
			return err
		}
		newJSON, err := attributeViewFieldJSON(current)
		if err != nil {
			return err
		}
		state.changes[avID] = diffAttributeViewFields(oldJSON, newJSON, true, true)
		inverse := &Operation{Action: "insertAttrViewBlock", AvID: avID, ID: avID, BlockID: carrier,
			attributeViewFields: state, attributeViewFieldUndo: true}
		for _, value := range original.GetBlockKeyValues().Values {
			if value.Block == nil {
				continue
			}
			if _, deleted := tx.deletedAttrViewBlockIDs[key][value.Block.ID]; deleted {
				inverse.Srcs = append(inverse.Srcs, map[string]any{"id": value.Block.ID, "itemID": value.BlockID, "isDetached": false})
			}
		}
		tx.attributeViewDeletionUndo = append([]*Operation{inverse}, tx.attributeViewDeletionUndo...)
	}
	return nil
}

func (tx *Transaction) restoreDeletedAttributeViewBlocks(op *Operation) error {
	state := op.attributeViewFields
	if err := tx.rememberAttributeViewMutationTree(state.blockID); err != nil {
		return err
	}
	for _, src := range op.Srcs {
		id, _ := src["id"].(string)
		if err := tx.rememberAttributeViewMutationTree(id); err != nil {
			return err
		}
	}
	current, err := tx.readAttributeViewForMutation(op.AvID, state.blockID, state.boxID)
	if err != nil {
		return err
	}
	for _, src := range op.Srcs {
		id, _ := src["id"].(string)
		if current.GetBlockValueByBoundID(id) != nil {
			return fmt.Errorf("database binding [%s] already exists", id)
		}
		node, tree, err := getNodeByBlockID(tx, id)
		if err != nil {
			return err
		}
		if node == nil {
			return fmt.Errorf("restored database binding [%s] is missing", id)
		}
		if err = validateAttributeViewBinding(op.AvID, tree); err != nil {
			return err
		}
	}
	if err := tx.replayAttributeViewFields(op); err != nil {
		return err
	}
	restored, err := tx.readAttributeViewForMutation(op.AvID, state.blockID, state.boxID)
	if err != nil {
		return err
	}
	var itemIDs []string
	for _, src := range op.Srcs {
		id, _ := src["id"].(string)
		node, tree, err := getNodeByBlockID(tx, id)
		if err != nil {
			return err
		}
		itemID, _ := src["itemID"].(string)
		primary := restored.GetBlockValue(itemID)
		if primary == nil || primary.Block == nil {
			return fmt.Errorf("restored database entry [%s] is missing", itemID)
		}
		attrs := parse.IAL2Map(node.KramdownIAL)
		ids := strings.Split(attrs[av.NodeAttrNameAvs], ",")
		if !slices.Contains(ids, op.AvID) {
			ids = append(ids, op.AvID)
		}
		attrs[av.NodeAttrNameAvs] = strings.Trim(strings.Join(ids, ","), ",")
		attrs[av.NodeAttrViewNames] = getAvNames(attrs[av.NodeAttrNameAvs])
		if primary.Block.RefSubtype == "s" {
			attrs[av.NodeAttrViewStaticText+"-"+op.AvID] = primary.Block.Content
		}
		if err = setNodeAttrsWithTx(tx, node, tree, attrs); err != nil {
			return err
		}
		itemIDs = append(itemIDs, itemID)
	}
	op.RetData = &insertAttrViewBlockResult{InsertedItemIDs: itemIDs}
	return nil
}
