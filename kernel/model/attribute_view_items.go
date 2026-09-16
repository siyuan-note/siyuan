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
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"slices"
	"strings"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

// 删除快照只保存在内核撤销日志中，保留字段值、条目身份和各视图顺序，不参与接口序列化。
type attributeViewItemsSnapshot struct {
	AvID, BoxID, BlockID string
	ItemIDs              []string
	Keys                 []*av.KeyValues
	Orders               map[string][]string
	Covers               map[string]map[string]*av.CardCoverPosition
	relatedChanges       *attributeViewFieldsSnapshot
}

func (tx *Transaction) prepareAttributeViewItemRemoval(op *Operation) error {
	if tx.isReplay && nil != op.attributeViewItems {
		current, err := tx.readAttributeViewItems(op.attributeViewItems)
		if err != nil {
			return err
		}
		if err = validateAttributeViewItemKeys(current, op.attributeViewItems); err != nil {
			return err
		}
		for _, kv := range op.attributeViewItems.Keys {
			for _, value := range kv.Values {
				if !reflect.DeepEqual(value, av.GetValue(current.KeyValues, kv.Key.ID, value.BlockID)) {
					return fmt.Errorf("database entry [%s] changed since deletion was undone", value.BlockID)
				}
			}
		}
		for _, kv := range current.KeyValues {
			for _, value := range kv.Values {
				if slices.Contains(op.attributeViewItems.ItemIDs, value.BlockID) &&
					!reflect.DeepEqual(value, av.GetValue(op.attributeViewItems.Keys, kv.Key.ID, value.BlockID)) {
					return fmt.Errorf("database entry [%s] has newer field values", value.BlockID)
				}
			}
		}
		if err = tx.prepareAttributeViewItemMutation(current, op.attributeViewItems); err != nil {
			return err
		}
		return tx.replayAttributeViewItemConfiguration(op.attributeViewItems, false)
	}
	if tx.isReplay || !tx.fromAPI || len(tx.UndoOperations) == 0 {
		return nil
	}
	current, err := avParseView(op.AvID, op.BlockID)
	if err != nil {
		return err
	}
	if current == nil {
		return av.ErrViewNotFound
	}
	state := &attributeViewItemsSnapshot{AvID: op.AvID, BoxID: av.GetAVBoxID(op.AvID), BlockID: op.BlockID,
		Orders: map[string][]string{}, Covers: map[string]map[string]*av.CardCoverPosition{}}
	current, err = av.ParseAttributeViewForIndexInBox(state.AvID, state.BoxID)
	if err != nil {
		return err
	}
	if current == nil {
		return av.ErrViewNotFound
	}
	for _, id := range op.SrcIDs {
		if current.GetBlockValue(id) != nil && !slices.Contains(state.ItemIDs, id) {
			state.ItemIDs = append(state.ItemIDs, id)
		}
	}
	if len(state.ItemIDs) == 0 {
		return nil
	}
	// 合并同一批删除的逆操作，先恢复所有主键，再恢复条目间关联。
	matched := map[*Operation]bool{}
	var inverse *Operation
	var srcs []map[string]any
	for _, id := range state.ItemIDs {
		primary := current.GetBlockValue(id)
		var match *Operation
		for _, undo := range tx.UndoOperations {
			if undo.Action != "insertAttrViewBlock" || undo.AvID != op.AvID || matched[undo] || len(undo.Srcs) != 1 {
				continue
			}
			src := undo.Srcs[0]
			if src["itemID"] == id || src["id"] == id ||
				(!primary.IsDetached && primary.Block != nil && src["id"] == primary.Block.ID) {
				match = undo
				break
			}
		}
		if match == nil {
			return nil
		}
		matched[match] = true
		if inverse == nil {
			inverse = match
			if state.BlockID == "" {
				state.BlockID = match.BlockID
			}
		}
		src := map[string]any{"itemID": id, "id": id, "isDetached": primary.IsDetached}
		if primary.Block != nil {
			src["content"] = primary.Block.Content
			if !primary.IsDetached {
				src["id"] = primary.Block.ID
			}
		}
		srcs = append(srcs, src)
	}
	for _, kv := range current.KeyValues {
		copyKV := &av.KeyValues{Key: kv.Key}
		for _, value := range kv.Values {
			if slices.Contains(state.ItemIDs, value.BlockID) {
				copyKV.Values = append(copyKV.Values, value)
			}
		}
		state.Keys = append(state.Keys, copyKV)
	}
	for _, view := range current.Views {
		state.Orders[view.ID] = view.ItemIDs
		for _, group := range view.Groups {
			state.Orders[group.ID] = group.GroupItemIDs
		}
	}
	for _, id := range state.ItemIDs {
		state.Covers[id] = current.CardCoverPositions[id]
	}
	data, err := json.Marshal(state)
	if err != nil {
		return err
	}
	state = &attributeViewItemsSnapshot{}
	if err = json.Unmarshal(data, state); err != nil {
		return err
	}
	if err = tx.prepareAttributeViewItemMutation(current, state); err != nil {
		return err
	}
	if err = tx.captureAttributeViewItemConfiguration(state); err != nil {
		return err
	}
	op.attributeViewItems, op.BlockID = state, state.BlockID
	op.SrcIDs = append([]string(nil), state.ItemIDs...)
	inverse.attributeViewItems, inverse.BlockID, inverse.Srcs = state, state.BlockID, srcs
	var undoOperations []*Operation
	for _, undo := range tx.UndoOperations {
		if !matched[undo] || undo == inverse {
			undoOperations = append(undoOperations, undo)
		}
	}
	tx.UndoOperations = undoOperations
	return nil
}

// 条目删除还会清理引用该条目的筛选与模板默认值，单独记录这些配置变化。
func (tx *Transaction) captureAttributeViewItemConfiguration(state *attributeViewItemsSnapshot) error {
	changes := &attributeViewFieldsSnapshot{avID: state.AvID, keyID: state.AvID, blockID: state.BlockID,
		boxID: state.BoxID, changes: map[string]*attributeViewFieldChange{}}
	seen := map[string]bool{}
	for _, id := range append([]string{state.AvID}, av.GetSrcAvIDs(state.AvID)...) {
		if seen[id] {
			continue
		}
		seen[id] = true
		before, err := tx.readAttributeViewForMutation(id, state.BlockID, state.BoxID)
		if id != state.AvID && errors.Is(err, av.ErrViewNotFound) {
			continue
		}
		if err != nil {
			return err
		}
		after, err := cloneAttributeViewForFieldMutation(before)
		if err != nil {
			return err
		}
		templateChanged := after.RemoveNewItemTemplateRelationItems(state.AvID, state.ItemIDs)
		filterChanged := after.RemoveRelationFilterItems(state.AvID, state.ItemIDs)
		if !templateChanged && !filterChanged {
			continue
		}
		oldJSON, err := attributeViewFieldJSON(before)
		if err != nil {
			return err
		}
		newJSON, err := attributeViewFieldJSON(after)
		if err != nil {
			return err
		}
		changes.changes[id] = diffAttributeViewFields(oldJSON, newJSON, true, true)
	}
	state.relatedChanges = changes
	return nil
}

func (tx *Transaction) replayAttributeViewItemConfiguration(state *attributeViewItemsSnapshot, undo bool) error {
	if state.relatedChanges == nil || len(state.relatedChanges.changes) == 0 {
		return nil
	}
	return tx.replayAttributeViewFields(&Operation{AvID: state.AvID, ID: state.AvID,
		attributeViewFields: state.relatedChanges, attributeViewFieldUndo: undo})
}

func (tx *Transaction) readAttributeViewItems(state *attributeViewItemsSnapshot) (*av.AttributeView, error) {
	return tx.readAttributeViewForMutation(state.AvID, state.BlockID, state.BoxID)
}

func (tx *Transaction) prepareAttributeViewItemMutation(current *av.AttributeView, state *attributeViewItemsSnapshot) error {
	if _, err := tx.readAttributeViewItems(state); err != nil {
		return err
	}
	ids := append([]string{state.AvID}, av.GetSrcAvIDs(state.AvID)...)
	for _, kv := range current.KeyValues {
		if kv.Key.Relation != nil && kv.Key.Relation.IsTwoWay {
			for _, value := range kv.Values {
				if slices.Contains(state.ItemIDs, value.BlockID) && value.Relation != nil && len(value.Relation.BlockIDs) > 0 {
					ids = append(ids, kv.Key.Relation.AvID)
					break
				}
			}
		}
	}
	for _, id := range ids {
		key := state.BoxID + "/" + id
		if id == "" || tx.attributeViewRollback.views[key] != nil {
			continue
		}
		original, err := av.ParseAttributeViewForIndexInBox(id, state.BoxID)
		if id != state.AvID && errors.Is(err, av.ErrViewNotFound) {
			continue
		}
		if err != nil {
			return err
		}
		if original == nil {
			return av.ErrViewNotFound
		}
		tx.attributeViewRollback.views[key] = original
	}
	blockIDs := []string{state.BlockID}
	for _, kv := range state.Keys {
		if kv.Key.Type == av.KeyTypeBlock {
			for _, value := range kv.Values {
				if !value.IsDetached && value.Block != nil {
					blockIDs = append(blockIDs, value.Block.ID)
				}
			}
		}
	}
	for _, id := range blockIDs {
		if err := tx.rememberAttributeViewMutationTree(id); err != nil {
			return err
		}
	}
	return nil
}

func (tx *Transaction) restoreAttributeViewItems(op *Operation) error {
	state := op.attributeViewItems
	if !tx.isReplay || op.AvID != state.AvID {
		return fmt.Errorf("invalid database entry replay")
	}
	current, err := tx.readAttributeViewItems(state)
	if err != nil {
		return err
	}
	for _, kv := range current.KeyValues {
		for _, value := range kv.Values {
			if slices.Contains(state.ItemIDs, value.BlockID) {
				return fmt.Errorf("database entry [%s] already exists", value.BlockID)
			}
		}
	}
	if err = validateAttributeViewItemKeys(current, state); err != nil {
		return err
	}
	for _, kv := range state.Keys {
		for _, value := range kv.Values {
			if value.Type != av.KeyTypeBlock || value.IsDetached || value.Block == nil {
				continue
			}
			tree, loadErr := tx.loadTree(value.Block.ID)
			if loadErr != nil {
				return loadErr
			}
			if err = validateAttributeViewBinding(state.AvID, tree); err != nil {
				return err
			}
			if treenode.GetNodeInTree(tree, value.Block.ID) == nil || current.GetBlockValueByBoundID(value.Block.ID) != nil {
				return fmt.Errorf("database entry binding [%s] changed", value.Block.ID)
			}
		}
	}
	if err = tx.prepareAttributeViewItemMutation(current, state); err != nil {
		return err
	}
	for _, kv := range state.Keys {
		dest, _ := current.GetKeyValues(kv.Key.ID)
		for _, value := range kv.Values {
			dest.Values = append(dest.Values, value.Clone())
		}
	}
	// 双向关联先在内存中校验并合并，保留目标条目的其他关联。
	changed := map[string]*av.AttributeView{state.AvID: current}
	for _, kv := range state.Keys {
		if kv.Key.Relation == nil || !kv.Key.Relation.IsTwoWay {
			continue
		}
		for _, value := range kv.Values {
			if value.Relation == nil || len(value.Relation.BlockIDs) == 0 {
				continue
			}
			dest := changed[kv.Key.Relation.AvID]
			if dest == nil {
				dest, err = av.ParseAttributeViewForIndexInBox(kv.Key.Relation.AvID, state.BoxID)
				if err != nil {
					return err
				}
				if dest == nil {
					return av.ErrViewNotFound
				}
				changed[dest.ID] = dest
			}
			back, backErr := dest.GetKeyValues(kv.Key.Relation.BackKeyID)
			if backErr != nil || back.Key.Type != av.KeyTypeRelation || back.Key.Relation == nil ||
				!back.Key.Relation.IsTwoWay || back.Key.Relation.AvID != state.AvID || back.Key.Relation.BackKeyID != kv.Key.ID {
				return fmt.Errorf("database back relation field [%s] changed", kv.Key.Relation.BackKeyID)
			}
			for _, id := range value.Relation.BlockIDs {
				backValue := back.GetValue(id)
				if dest.GetBlockValue(id) == nil || backValue == nil || backValue.Relation == nil {
					return fmt.Errorf("related database entry [%s] changed", id)
				}
				if !slices.Contains(backValue.Relation.BlockIDs, value.BlockID) {
					backValue.Relation.BlockIDs = append(backValue.Relation.BlockIDs, value.BlockID)
				}
			}
		}
	}
	for _, view := range current.Views {
		view.ItemIDs = restoreAttributeViewItemOrder(view.ItemIDs, state.Orders[view.ID], state.ItemIDs)
		for _, group := range view.Groups {
			group.GroupItemIDs = restoreAttributeViewItemOrder(group.GroupItemIDs, state.Orders[group.ID], state.ItemIDs)
		}
	}
	for id, covers := range state.Covers {
		if covers != nil {
			if current.CardCoverPositions == nil {
				current.CardCoverPositions = map[string]map[string]*av.CardCoverPosition{}
			}
			current.CardCoverPositions[id] = map[string]*av.CardCoverPosition{}
			for source, position := range covers {
				cloned := *position
				current.CardCoverPositions[id][source] = &cloned
			}
		}
	}
	for _, dest := range changed {
		regenAttrViewGroups(dest)
		if err = avSaveView(dest, state.BlockID); err != nil {
			return err
		}
	}
	for _, id := range state.ItemIDs {
		primary := current.GetBlockValue(id)
		if primary == nil || primary.IsDetached || primary.Block == nil {
			continue
		}
		node, tree, loadErr := getNodeByBlockID(tx, primary.Block.ID)
		if loadErr != nil {
			return loadErr
		}
		attrs := parse.IAL2Map(node.KramdownIAL)
		ids := strings.Split(attrs[av.NodeAttrNameAvs], ",")
		if !slices.Contains(ids, state.AvID) {
			ids = append(ids, state.AvID)
		}
		attrs[av.NodeAttrNameAvs] = strings.Trim(strings.Join(ids, ","), ",")
		attrs[av.NodeAttrViewNames] = getAvNames(attrs[av.NodeAttrNameAvs])
		if err = setNodeAttrsWithTx(tx, node, tree, attrs); err != nil {
			return err
		}
	}
	refreshRelatedSrcAvsInBlock(state.AvID, state.BlockID, tx)
	if err = tx.replayAttributeViewItemConfiguration(state, true); err != nil {
		return err
	}
	op.RetData = &insertAttrViewBlockResult{InsertedItemIDs: append([]string(nil), state.ItemIDs...)}
	return nil
}

func validateAttributeViewItemKeys(current *av.AttributeView, state *attributeViewItemsSnapshot) error {
	for _, kv := range state.Keys {
		key, err := current.GetKey(kv.Key.ID)
		if err != nil || key.Type != kv.Key.Type || !reflect.DeepEqual(key.Relation, kv.Key.Relation) {
			return fmt.Errorf("database field [%s] changed since entries were deleted", kv.Key.ID)
		}
	}
	return nil
}

func restoreAttributeViewItemOrder(current, original, itemIDs []string) []string {
	for index, id := range original {
		if !slices.Contains(itemIDs, id) || slices.Contains(current, id) {
			continue
		}
		position := -1
		for previous := index - 1; previous >= 0; previous-- {
			if found := slices.Index(current, original[previous]); found >= 0 {
				position = found + 1
				break
			}
		}
		if position < 0 {
			position = 0
		}
		current = slices.Insert(current, position, id)
	}
	for _, id := range itemIDs {
		if !slices.Contains(current, id) {
			current = append(current, id)
		}
	}
	return current
}
