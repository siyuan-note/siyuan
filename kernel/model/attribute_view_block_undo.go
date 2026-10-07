package model

import (
	"errors"
	"fmt"
	"reflect"
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
		before, after, err := tx.prepareDeletedAttributeViewRelations(original, current, carrier, boxID)
		if err != nil {
			return err
		}
		state := &attributeViewFieldsSnapshot{avID: avID, keyID: avID, blockID: carrier, boxID: boxID,
			changes: map[string]*attributeViewFieldChange{}, fieldTypes: map[string]map[string]av.KeyType{}}
		for id, view := range before {
			state.fieldTypes[id] = map[string]av.KeyType{}
			for _, kv := range view.KeyValues {
				remaining, _ := after[id].GetKeyValues(kv.Key.ID)
				if !reflect.DeepEqual(kv.Values, remaining.Values) {
					state.fieldTypes[id][kv.Key.ID] = kv.Key.Type
				}
			}
			regenAttrViewGroups(after[id])
		}
		if err = tx.saveAttributeViewFieldChanges(state, before, after); err != nil {
			return err
		}
		if !tx.fromAPI || tx.isReplay || len(tx.UndoOperations) == 0 {
			continue
		}
		for id, view := range before {
			persisted, readErr := tx.readAttributeViewForMutation(id, carrier, boxID)
			if readErr != nil {
				return readErr
			}
			oldJSON, jsonErr := attributeViewFieldJSON(view)
			if jsonErr != nil {
				return jsonErr
			}
			newJSON, jsonErr := attributeViewFieldJSON(persisted)
			if jsonErr != nil {
				return jsonErr
			}
			state.changes[id] = diffAttributeViewFields(oldJSON, newJSON, true, true)
		}
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

// 删除绑定条目时清理所有指向这些条目的关联，两个方向一起保存和撤销。
func (tx *Transaction) prepareDeletedAttributeViewRelations(original, current *av.AttributeView, carrier, boxID string) (
	before, after map[string]*av.AttributeView, err error) {
	before = map[string]*av.AttributeView{original.ID: original}
	after = map[string]*av.AttributeView{current.ID: current}
	err = tx.clearDeletedAttributeViewRelations(original, current, carrier, boxID, before, after)
	return
}

func deletedAttributeViewRelationIDs(original *av.AttributeView) []string {
	ids := append([]string{original.ID}, av.GetSrcAvIDs(original.ID)...)
	for _, kv := range original.KeyValues {
		if kv.Key.Relation != nil && kv.Key.Relation.IsTwoWay {
			ids = append(ids, kv.Key.Relation.AvID)
		}
	}
	return slices.Compact(slices.Sorted(slices.Values(ids)))
}

func (tx *Transaction) clearDeletedAttributeViewRelations(original, current *av.AttributeView, carrier, boxID string,
	before, after map[string]*av.AttributeView) error {
	removed := map[string]bool{}
	for _, value := range original.GetBlockKeyValues().Values {
		if value != nil && current.GetBlockValue(value.BlockID) == nil {
			removed[value.BlockID] = true
		}
	}
	for _, id := range deletedAttributeViewRelationIDs(original) {
		if id == "" {
			continue
		}
		view := after[id]
		var source *av.AttributeView
		if view == nil {
			var err error
			source, err = tx.readAttributeViewForMutation(id, carrier, boxID)
			if errors.Is(err, av.ErrViewNotFound) {
				continue
			}
			if err != nil {
				return err
			}
			view, err = cloneAttributeViewForFieldMutation(source)
			if err != nil {
				return err
			}
		}
		changed := false
		for _, kv := range view.KeyValues {
			if kv.Key.Type != av.KeyTypeRelation || kv.Key.Relation == nil || kv.Key.Relation.AvID != original.ID {
				continue
			}
			for _, value := range kv.Values {
				if value == nil || value.Relation == nil {
					continue
				}
				count := len(value.Relation.BlockIDs)
				value.Relation.BlockIDs = slices.DeleteFunc(value.Relation.BlockIDs, func(id string) bool { return removed[id] })
				if len(value.Relation.BlockIDs) != count {
					value.Relation.Contents = nil
					changed = true
				}
			}
		}
		if changed && source != nil {
			before[id], after[id] = source, view
		}
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
