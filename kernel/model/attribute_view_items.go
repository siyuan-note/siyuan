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
	"container/list"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 删除快照只保存在内核撤销日志中，保留字段值、条目身份和各视图顺序，不参与接口序列化。
type attributeViewItemsSnapshot struct {
	AvID, BoxID, BlockID  string
	ItemIDs               []string
	Keys                  []*av.KeyValues
	Orders                map[string][]string
	Covers                map[string]map[string]*av.CardCoverPosition
	MissingBlocks         map[string]bool
	relatedChanges        *attributeViewFieldsSnapshot
	SubItemsParents       map[string]string
	SubItemsPromoted      map[string]string
	SubItemsRemovedOrders map[string][]string
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
		currentValues := newAttrViewValueUpdateContext(current).values
		oldValues := newAttrViewValueUpdateContext(&av.AttributeView{KeyValues: op.attributeViewItems.Keys}).values
		itemIDs := attributeViewItemIDSet(op.attributeViewItems.ItemIDs)
		for _, kv := range op.attributeViewItems.Keys {
			for _, value := range kv.Values {
				if !reflect.DeepEqual(value, currentValues[kv.Key.ID][value.BlockID]) {
					return fmt.Errorf("database entry [%s] changed since deletion was undone", value.BlockID)
				}
			}
		}
		for _, kv := range current.KeyValues {
			for _, value := range kv.Values {
				if itemIDs[value.BlockID] &&
					!reflect.DeepEqual(value, oldValues[kv.Key.ID][value.BlockID]) {
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
	primaryValues := newAttrViewValueUpdateContext(current).blockValues
	selectedIDs := map[string]bool{}
	for _, id := range op.SrcIDs {
		if primaryValues[id] != nil && !selectedIDs[id] {
			state.ItemIDs = append(state.ItemIDs, id)
			selectedIDs[id] = true
		}
	}
	if len(state.ItemIDs) == 0 {
		return nil
	}
	// 合并同一批删除的逆操作，先恢复所有主键，再恢复条目间关联。
	matched := map[*Operation]bool{}
	var inverse *Operation
	var srcs []map[string]any
	inverseByID := map[string][]*Operation{}
	for _, undo := range tx.UndoOperations {
		if undo.Action != "insertAttrViewBlock" || undo.AvID != op.AvID || len(undo.Srcs) != 1 {
			continue
		}
		for _, member := range []string{"itemID", "id"} {
			if id, ok := undo.Srcs[0][member].(string); ok {
				inverseByID[id] = append(inverseByID[id], undo)
			}
		}
	}
	for _, id := range state.ItemIDs {
		primary := primaryValues[id]
		var match *Operation
		candidates := inverseByID[id]
		if !primary.IsDetached && primary.Block != nil {
			candidates = append(slices.Clone(candidates), inverseByID[primary.Block.ID]...)
		}
		for _, undo := range candidates {
			if !matched[undo] {
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
			if selectedIDs[value.BlockID] {
				copyKV.Values = append(copyKV.Values, value)
			}
		}
		state.Keys = append(state.Keys, copyKV)
	}
	for _, view := range current.Views {
		state.Orders[view.ID] = view.ItemIDs
		for _, group := range view.Groups {
			state.Orders[group.ID] = group.GroupItemIDs
			state.Orders[group.ID+"#subitems"] = group.SubItemsItemIDs
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
	if current.HasSubItems() {
		index, indexErr := current.BuildSubItemsIndex()
		if indexErr != nil {
			return indexErr
		}
		state.SubItemsParents, state.SubItemsPromoted = map[string]string{}, map[string]string{}
		state.SubItemsRemovedOrders = map[string][]string{}
		removed := map[string]bool{}
		for _, id := range state.ItemIDs {
			removed[id] = true
		}
		ancestors := map[string]string{}
		for id, parent := range index.Parents {
			if removed[id] {
				continue
			}
			previous := parent
			path := []string{}
			for removed[parent] {
				if cached, ok := ancestors[parent]; ok {
					parent = cached
					break
				}
				path = append(path, parent)
				parent = index.Parents[parent]
			}
			for _, ancestor := range path {
				ancestors[ancestor] = parent
			}
			if parent != previous {
				state.SubItemsParents[id], state.SubItemsPromoted[id] = previous, parent
			}
		}
		for key, order := range state.Orders {
			state.SubItemsRemovedOrders[key] = index.OrderAfterRemoval(order, removed)
		}
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

// 只把索引、文件或认证后文档中的源块缺失视为缺失；其他读取失败均保留错误。
func (tx *Transaction) attributeViewItemSourceMissing(state *attributeViewItemsSnapshot, blockID string) (bool, error) {
	bt := attributeViewBindingBlockTree(blockID, state.BoxID)
	if bt == nil {
		return true, nil
	}
	if tx.trees[bt.RootID] == nil {
		if _, err := os.Stat(filepath.Join(util.DataDir, bt.BoxID, bt.Path)); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return true, nil
			}
			return false, err
		}
	}
	tree, err := tx.loadTreeByBlockTree(bt)
	if errors.Is(err, os.ErrNotExist) {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	return treenode.GetNodeInTree(tree, blockID) == nil, nil
}

func (tx *Transaction) prepareAttributeViewItemMutation(current *av.AttributeView, state *attributeViewItemsSnapshot) error {
	if _, err := tx.readAttributeViewItems(state); err != nil {
		return err
	}
	ids := append([]string{state.AvID}, av.GetSrcAvIDs(state.AvID)...)
	itemIDs := attributeViewItemIDSet(state.ItemIDs)
	for _, kv := range current.KeyValues {
		if kv.Key.Relation != nil && kv.Key.Relation.IsTwoWay {
			for _, value := range kv.Values {
				if itemIDs[value.BlockID] && value.Relation != nil && len(value.Relation.BlockIDs) > 0 {
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
		if id != state.BlockID {
			missing, err := tx.attributeViewItemSourceMissing(state, id)
			if err != nil {
				return err
			}
			// 缺失源块只恢复原条目快照，不创建替代源块；读取或认证失败仍返回错误。
			if missing && !tx.isReplay {
				if state.MissingBlocks == nil {
					state.MissingBlocks = map[string]bool{}
				}
				state.MissingBlocks[id] = true
			}
			if missing && state.MissingBlocks[id] {
				continue
			}
			if missing {
				return ErrBlockNotFound
			}
		}
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
	if len(state.SubItemsPromoted) > 0 {
		for _, view := range current.Views {
			if err = validatePromotedSubItemsOrder(view.ItemIDs, state.SubItemsRemovedOrders[view.ID], state.SubItemsPromoted); err != nil {
				return err
			}
			for _, group := range view.Groups {
				if err = validatePromotedSubItemsOrder(group.GroupItemIDs, state.SubItemsRemovedOrders[group.ID], state.SubItemsPromoted); err != nil {
					return err
				}
				if err = validatePromotedSubItemsOrder(group.SubItemsItemIDs, state.SubItemsRemovedOrders[group.ID+"#subitems"], state.SubItemsPromoted); err != nil {
					return err
				}
			}
		}
	}
	itemIDs := attributeViewItemIDSet(state.ItemIDs)
	for _, kv := range current.KeyValues {
		for _, value := range kv.Values {
			if itemIDs[value.BlockID] {
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
			if current.GetBlockValueByBoundID(value.Block.ID) != nil {
				return fmt.Errorf("database entry binding [%s] changed", value.Block.ID)
			}
			if state.MissingBlocks[value.Block.ID] {
				missing, missingErr := tx.attributeViewItemSourceMissing(state, value.Block.ID)
				if missingErr != nil {
					return missingErr
				}
				if missing {
					continue
				}
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
		if current.IsSubItemsKey(kv.Key.ID) {
			continue
		}
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
	if current.HasSubItems() {
		parents, parentErr := current.GetKeyValues(current.SubItems.ParentKeyID)
		if parentErr != nil {
			return parentErr
		}
		for id, expected := range state.SubItemsPromoted {
			actual := ""
			if value := parents.GetValue(id); value != nil && value.Relation != nil && len(value.Relation.BlockIDs) > 0 {
				actual = value.Relation.BlockIDs[0]
			}
			if actual != expected {
				return fmt.Errorf("database parent entry [%s] changed since deletion", id)
			}
		}
		if err = current.RestoreSubItemsParents(state.SubItemsParents); err != nil {
			return err
		}
	}
	orderIDs := slices.Clone(state.ItemIDs)
	for id := range state.SubItemsPromoted {
		orderIDs = append(orderIDs, id)
	}
	restoreOrder := func(current, original []string) []string {
		current = slices.DeleteFunc(current, func(id string) bool {
			_, promoted := state.SubItemsPromoted[id]
			return promoted
		})
		return restoreAttributeViewItemOrder(current, original, orderIDs)
	}
	for _, view := range current.Views {
		view.ItemIDs = restoreOrder(view.ItemIDs, state.Orders[view.ID])
		for _, group := range view.Groups {
			group.GroupItemIDs = restoreOrder(group.GroupItemIDs, state.Orders[group.ID])
			if original := state.Orders[group.ID+"#subitems"]; original != nil {
				group.SubItemsItemIDs = restoreOrder(group.SubItemsItemIDs, original)
			}
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
	primaryValues := newAttrViewValueUpdateContext(current).blockValues
	for _, id := range state.ItemIDs {
		primary := primaryValues[id]
		if primary == nil || primary.IsDetached || primary.Block == nil {
			continue
		}
		if state.MissingBlocks[primary.Block.ID] {
			missing, missingErr := tx.attributeViewItemSourceMissing(state, primary.Block.ID)
			if missingErr != nil {
				return missingErr
			}
			if missing {
				continue
			}
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
	// 按身份定位锚点，整批恢复时不反复扫描或移动长数组。
	order := list.New()
	present := make(map[string]*list.Element, len(current)+len(itemIDs))
	for _, id := range current {
		element := order.PushBack(id)
		if present[id] == nil {
			present[id] = element
		}
	}
	restored := make(map[string]bool, len(itemIDs))
	for _, id := range itemIDs {
		restored[id] = true
	}
	var previous *list.Element
	for _, id := range original {
		if existing := present[id]; existing != nil {
			previous = existing
			continue
		}
		if !restored[id] {
			continue
		}
		if previous == nil {
			previous = order.PushFront(id)
		} else {
			previous = order.InsertAfter(id, previous)
		}
		present[id] = previous
	}
	for _, id := range itemIDs {
		if present[id] == nil {
			present[id] = order.PushBack(id)
		}
	}
	if order.Len() == 0 {
		return current
	}
	ret := make([]string, 0, order.Len())
	for element := order.Front(); element != nil; element = element.Next() {
		ret = append(ret, element.Value.(string))
	}
	return ret
}

func attributeViewItemIDSet(ids []string) map[string]bool {
	ret := make(map[string]bool, len(ids))
	for _, id := range ids {
		ret[id] = true
	}
	return ret
}

// 新增或移除无关条目可以合并；存活子项相对原有邻项的位置变化必须由用户解决。
func validatePromotedSubItemsOrder(current, expected []string, promoted map[string]string) error {
	currentIDs, expectedIDs := attributeViewItemIDSet(current), attributeViewItemIDSet(expected)
	type neighbors struct{ previous, next string }
	index := func(order []string, allowed map[string]bool) map[string]neighbors {
		ret := map[string]neighbors{}
		previous := ""
		for _, id := range order {
			if !allowed[id] {
				continue
			}
			ret[id] = neighbors{previous: previous}
			if previous != "" {
				entry := ret[previous]
				entry.next = id
				ret[previous] = entry
			}
			previous = id
		}
		return ret
	}
	actual, original := index(current, expectedIDs), index(expected, currentIDs)
	for id := range promoted {
		if expectedIDs[id] && actual[id] != original[id] {
			return fmt.Errorf("database entry [%s] order changed since deletion", id)
		}
	}
	return nil
}
