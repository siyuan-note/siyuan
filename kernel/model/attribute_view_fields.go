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

	"github.com/siyuan-note/siyuan/kernel/av"
)

// 字段快照只包含本次操作的变化，不进入接口响应或数据库持久化格式。
type attributeViewFieldsSnapshot struct {
	avID, keyID, blockID, boxID string
	changes                     map[string]*attributeViewFieldChange
	relationValues              map[string]map[string]attributeViewRelationValues
	fieldTypes                  map[string]map[string]av.KeyType
}

type attributeViewRelationValues map[string][]string

func attributeViewRelationValueIDs(values []*av.Value) attributeViewRelationValues {
	ret := attributeViewRelationValues{}
	for _, value := range values {
		if value.Relation != nil && len(value.Relation.BlockIDs) > 0 {
			ret[value.BlockID] = append([]string(nil), value.Relation.BlockIDs...)
		}
	}
	return ret
}

func (tx *Transaction) removeAttributeViewField(op *Operation) error {
	var inverse *Operation
	if tx.fromAPI && !tx.isReplay {
		for _, undo := range tx.UndoOperations {
			if undo.Action == "addAttrViewCol" && undo.AvID == op.AvID && undo.ID == op.ID {
				inverse = undo
				break
			}
		}
	}
	blockID := op.BlockID
	if blockID == "" && inverse != nil {
		blockID = inverse.BlockID
		if blockID == "" {
			for _, operation := range tx.DoOperations {
				if operation.Action == "doUpdateUpdated" {
					blockID = operation.ID
					break
				}
			}
		}
	}
	resolved, err := avParseView(op.AvID, blockID)
	if err != nil {
		return err
	}
	if resolved == nil {
		return av.ErrViewNotFound
	}
	state := &attributeViewFieldsSnapshot{avID: op.AvID, keyID: op.ID, blockID: blockID,
		boxID: av.GetAVBoxID(op.AvID), changes: map[string]*attributeViewFieldChange{}, relationValues: map[string]map[string]attributeViewRelationValues{}}
	before := map[string]*av.AttributeView{}
	views := map[string]*av.AttributeView{}
	load := func(id string, optional bool) (*av.AttributeView, error) {
		if existing := views[id]; existing != nil {
			return existing, nil
		}
		current, loadErr := tx.readAttributeViewForMutation(id, blockID, state.boxID)
		if optional && errors.Is(loadErr, av.ErrViewNotFound) {
			return nil, nil
		}
		if loadErr != nil {
			return nil, loadErr
		}
		copy, copyErr := cloneAttributeViewForFieldMutation(current)
		if copyErr != nil {
			return nil, copyErr
		}
		before[id], views[id] = copy, current
		return current, nil
	}
	source, err := load(op.AvID, false)
	if err != nil {
		return err
	}
	key, err := source.GetKey(op.ID)
	if err != nil {
		return err
	}
	if key.Type == av.KeyTypeBlock {
		return errors.New("cannot remove primary key field")
	}
	removals := map[string][]string{source.ID: {key.ID}}
	if relation := key.Relation; key.Type == av.KeyTypeRelation && relation != nil && relation.IsTwoWay && relation.AvID != "" {
		dest, loadErr := load(relation.AvID, true)
		if loadErr != nil {
			return loadErr
		}
		if dest != nil {
			back, _ := dest.GetKey(relation.BackKeyID)
			if back != nil && back.Type == av.KeyTypeRelation && back.Relation != nil &&
				back.Relation.AvID == source.ID && back.Relation.IsTwoWay {
				if back.Relation.BackKeyID != key.ID {
					return fmt.Errorf("database back relation field [%s] has changed", back.ID)
				}
				if op.RemoveDest {
					removals[dest.ID] = append(removals[dest.ID], back.ID)
				} else {
					back.Relation.IsTwoWay, back.Relation.BackKeyID = false, ""
					if dest.ID != source.ID || back.ID != key.ID {
						state.relationValues[dest.ID] = map[string]attributeViewRelationValues{back.ID: nil}
					}
				}
			}
		}
	}
	for id := range removals {
		for _, relatedID := range av.GetSrcAvIDs(id) {
			if _, err = load(relatedID, true); err != nil {
				return err
			}
		}
	}
	for id, keyIDs := range removals {
		for _, keyID := range keyIDs {
			removeAttributeViewFieldDefinition(views[id], keyID)
		}
	}
	for _, view := range views {
		for id, keyIDs := range removals {
			for _, keyID := range keyIDs {
				removeAttrViewColumnFromFieldFilters(view, id, keyID)
				for _, kv := range view.KeyValues {
					if kv.Key.Rollup == nil || kv.Key.Rollup.KeyID != keyID {
						continue
					}
					relation, _ := view.GetKey(kv.Key.Rollup.RelationKeyID)
					if relation == nil || relation.Relation == nil || relation.Relation.AvID != id {
						continue
					}
					for _, value := range kv.Values {
						if value.Rollup != nil {
							value.Rollup.Contents = nil
						}
					}
				}
			}
		}
		if view.ID != source.ID {
			regenAttrViewGroups(view)
		}
	}
	if err = tx.saveAttributeViewFieldChanges(state, before, views); err != nil {
		return err
	}
	if inverse != nil {
		for id := range views {
			persisted, readErr := tx.readAttributeViewForMutation(id, blockID, state.boxID)
			if readErr != nil {
				return readErr
			}
			for keyID := range state.relationValues[id] {
				kv, keyErr := persisted.GetKeyValues(keyID)
				if keyErr != nil {
					return keyErr
				}
				state.relationValues[id][keyID] = attributeViewRelationValueIDs(kv.Values)
			}
			oldJSON, jsonErr := attributeViewFieldJSON(before[id])
			if jsonErr != nil {
				return jsonErr
			}
			newJSON, jsonErr := attributeViewFieldJSON(persisted)
			if jsonErr != nil {
				return jsonErr
			}
			if change := diffAttributeViewFields(oldJSON, newJSON, true, true); change != nil {
				state.changes[id] = change
			}
		}
		op.attributeViewFields, op.BlockID = state, blockID
		inverse.attributeViewFields, inverse.attributeViewFieldUndo, inverse.BlockID = state, true, blockID
	}
	return nil
}

func removeAttributeViewFieldDefinition(view *av.AttributeView, keyID string) {
	view.KeyValues = slices.DeleteFunc(view.KeyValues, func(kv *av.KeyValues) bool { return kv.Key.ID == keyID })
	view.KeyIDs = slices.DeleteFunc(view.KeyIDs, func(id string) bool { return id == keyID })
	view.RemoveNewItemTemplateFieldValue(keyID)
	view.RemoveCardCoverPositionsBySource(av.CardCoverSource(av.CoverFromAssetField, keyID))
	for _, layout := range view.Views {
		for _, table := range layout.TableLayouts() {
			if table != nil {
				table.Columns = slices.DeleteFunc(table.Columns, func(column *av.ViewTableColumn) bool { return column.ID == keyID })
			}
		}
		if layout.Gallery != nil {
			layout.Gallery.CardFields = slices.DeleteFunc(layout.Gallery.CardFields, func(field *av.ViewGalleryCardField) bool { return field.ID == keyID })
		}
		if layout.Kanban != nil {
			layout.Kanban.Fields = slices.DeleteFunc(layout.Kanban.Fields, func(field *av.ViewKanbanField) bool { return field.ID == keyID })
		}
		layout.Filters = av.RemoveFiltersByColumn(layout.Filters, keyID)
		if len(layout.Filters) == 0 {
			layout.Filters = []*av.ViewFilter{{Combination: av.FilterCombinationAnd}}
		}
		layout.Sorts = slices.DeleteFunc(layout.Sorts, func(sort *av.ViewSort) bool { return sort.Column == keyID })
		if layout.Group != nil && layout.Group.Field == keyID {
			removeAttributeViewGroup0(layout)
			if layout.LayoutType == av.LayoutTypeKanban {
				// 看板必须保留有效分组，将自动选择的替代分组一并纳入撤销快照。
				setAttributeViewGroup(view, layout, &av.ViewGroup{Field: getKanbanPreferredGroupKey(view).ID})
			}
		}
	}
}

func (tx *Transaction) replayAttributeViewFields(op *Operation) error {
	state := op.attributeViewFields
	if !tx.isReplay || op.AvID != state.avID || op.ID != state.keyID {
		return errors.New("invalid database field replay")
	}
	if len(state.changes) == 0 {
		return nil
	}
	before, after := map[string]*av.AttributeView{}, map[string]*av.AttributeView{}
	for _, id := range sortedAttributeViewFieldKeys(state.changes) {
		current, err := tx.readAttributeViewForMutation(id, state.blockID, state.boxID)
		if err != nil {
			return err
		}
		for keyID, typ := range state.fieldTypes[id] {
			key, keyErr := current.GetKey(keyID)
			if keyErr != nil || key.Type != typ {
				return fmt.Errorf("database field [%s] changed after the operation", keyID)
			}
		}
		// 恢复双向定义时，另一端的单向值必须仍与删除时一致。
		for keyID, expected := range state.relationValues[id] {
			kv, keyErr := current.GetKeyValues(keyID)
			if keyErr != nil {
				return keyErr
			}
			if !reflect.DeepEqual(attributeViewRelationValueIDs(kv.Values), expected) {
				return fmt.Errorf("database back relation values [%s] changed after field deletion", keyID)
			}
		}
		data, err := attributeViewFieldJSON(current)
		if err != nil {
			return err
		}
		patched, _, err := state.changes[id].apply(data, true, op.attributeViewFieldUndo)
		if err != nil {
			return fmt.Errorf("database [%s]: %w", id, err)
		}
		encoded, err := json.Marshal(patched)
		if err != nil {
			return err
		}
		restored := &av.AttributeView{}
		if err = json.Unmarshal(encoded, restored); err != nil {
			return err
		}
		for _, kv := range restored.KeyValues {
			if _, keyErr := current.GetKey(kv.Key.ID); keyErr == nil {
				continue
			}
			for _, value := range kv.Values {
				if restored.GetBlockValue(value.BlockID) == nil {
					return fmt.Errorf("database entry [%s] was removed after the field", value.BlockID)
				}
			}
		}
		before[id], after[id] = current, restored
	}
	return tx.saveAttributeViewFieldChanges(state, before, after)
}

func (tx *Transaction) saveAttributeViewFieldChanges(state *attributeViewFieldsSnapshot, before, after map[string]*av.AttributeView) error {
	if err := tx.rememberAttributeViewMutationTree(state.blockID); err != nil {
		return err
	}
	ids := sortedAttributeViewFieldKeys(after)
	for _, id := range ids {
		key := state.boxID + "/" + id
		if tx.attributeViewRollback.views[key] == nil {
			tx.attributeViewRollback.views[key] = before[id]
		}
	}
	for _, id := range ids {
		av.SetAVBoxID(id, state.boxID)
		if err := av.SaveAttributeView(after[id]); err != nil {
			return err
		}
		tx.invalidateAttributeViewHistory(id)
	}
	for _, id := range ids {
		syncAttributeViewRelationIndexes(before[id], after[id])
		ReloadAttrView(id)
	}
	return nil
}

func cloneAttributeViewForFieldMutation(view *av.AttributeView) (*av.AttributeView, error) {
	data, err := json.Marshal(view)
	if err != nil {
		return nil, err
	}
	ret := &av.AttributeView{}
	err = json.Unmarshal(data, ret)
	return ret, err
}
