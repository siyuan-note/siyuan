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
	"strings"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 删除和合并选项共用字段变化快照，恢复实际改变的值、筛选条件、模板默认值和分组状态。
func (tx *Transaction) mutateAttributeViewOption(op *Operation, remove bool) error {
	if op.attributeViewFields != nil {
		return tx.replayAttributeViewFields(op)
	}
	var inverse *Operation
	if tx.fromAPI && !tx.isReplay {
		action := "updateAttrViewColOption"
		if remove {
			action = "updateAttrViewColOptions"
		}
		for _, undo := range tx.UndoOperations {
			if undo.Action == action && undo.AvID == op.AvID && undo.ID == op.ID && undo.attributeViewFields == nil {
				inverse = undo
				break
			}
		}
	}
	blockID := op.BlockID
	if blockID == "" {
		for _, operation := range tx.DoOperations {
			if operation.Action == "doUpdateUpdated" {
				blockID = operation.ID
				break
			}
		}
	}
	if _, err := avParseView(op.AvID, blockID); err != nil {
		return err
	}
	state := &attributeViewFieldsSnapshot{avID: op.AvID, keyID: op.ID, blockID: blockID,
		boxID: av.GetAVBoxID(op.AvID), changes: map[string]*attributeViewFieldChange{}}
	source, err := tx.readAttributeViewForMutation(op.AvID, blockID, state.boxID)
	if err != nil {
		return err
	}
	key, err := source.GetKey(op.ID)
	if err != nil {
		return err
	}
	state.fieldTypes = map[string]map[string]av.KeyType{source.ID: {key.ID: key.Type}}
	before := map[string]*av.AttributeView{}
	views := map[string]*av.AttributeView{source.ID: source}
	// 写入前读取所有关联数据库，缺失的旧关联可以跳过，损坏或认证失败必须终止。
	for _, id := range av.GetSrcAvIDs(source.ID) {
		if views[id] != nil {
			continue
		}
		related, readErr := tx.readAttributeViewForMutation(id, blockID, state.boxID)
		if errors.Is(readErr, av.ErrViewNotFound) {
			continue
		}
		if readErr != nil {
			return readErr
		}
		views[id] = related
	}
	for id, view := range views {
		before[id], err = cloneAttributeViewForFieldMutation(view)
		if err != nil {
			return err
		}
	}
	if remove {
		err = removeAttributeViewColumnOptionValues(source, op)
	} else {
		err = updateAttributeViewColumnOptionValues(source, op)
	}
	if err != nil {
		return err
	}
	for id, view := range views {
		if id == source.ID {
			continue
		}
		// 源数据库中的字段筛选已经随选项值一并更新。
		changed := false
		if remove {
			changed = removeAttrViewOptionFromFieldFilters(view, source.ID, key.ID, op.Data.(string))
		} else {
			var data struct {
				OldName string `json:"oldName"`
				NewName string `json:"newName"`
			}
			encoded, _ := json.Marshal(op.Data)
			if err = json.Unmarshal(encoded, &data); err != nil {
				return err
			}
			oldName, newName := strings.TrimSpace(data.OldName), strings.TrimSpace(data.NewName)
			option := key.GetOption(newName)
			if option != nil {
				changed = renameAttrViewOptionInFieldFilters(view, source.ID, key.ID, oldName, newName, option.Color)
			}
		}
		if !changed {
			delete(views, id)
			delete(before, id)
		}
	}
	regenAttrViewGroups(source)
	if err = tx.saveAttributeViewFieldChanges(state, before, views); err != nil {
		return err
	}
	if inverse != nil {
		for id := range views {
			persisted, readErr := tx.readAttributeViewForMutation(id, blockID, state.boxID)
			if readErr != nil {
				return readErr
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

func removeAttributeViewColumnOption(operation *Operation) (err error) {
	tx := &Transaction{trees: map[string]*parse.Tree{}}
	defer func() { tx.finishAttributeViewMutation(err != nil) }()
	return tx.mutateAttributeViewOption(operation, true)
}

func updateAttributeViewColumnOption(operation *Operation) (err error) {
	tx := &Transaction{trees: map[string]*parse.Tree{}}
	defer func() { tx.finishAttributeViewMutation(err != nil) }()
	return tx.mutateAttributeViewOption(operation, false)
}

func removeAttributeViewColumnOptionValues(attrView *av.AttributeView, operation *Operation) (err error) {
	optName, ok := operation.Data.(string)
	if !ok {
		return errors.New("invalid database option name")
	}

	key, err := attrView.GetKey(operation.ID)
	if err != nil {
		return
	}

	for i, opt := range key.Options {
		if optName == opt.Name {
			key.Options = append(key.Options[:i], key.Options[i+1:]...)
			break
		}
	}
	attrView.RemoveNewItemTemplateSelectOption(operation.ID, optName)

	for _, keyValues := range attrView.KeyValues {
		if keyValues.Key.ID != operation.ID {
			continue
		}

		for _, value := range keyValues.Values {
			if nil == value || nil == value.MSelect {
				continue
			}

			for i, opt := range value.MSelect {
				if optName == opt.Content {
					value.MSelect = append(value.MSelect[:i], value.MSelect[i+1:]...)
					break
				}
			}
		}
		break
	}

	// 如果存在选项对应的过滤条件，则删除过滤条件中设置的选项值 https://github.com/siyuan-note/siyuan/issues/15536
	for _, view := range attrView.Views {
		view.Filters = av.RemoveSelectOptionFromFilters(view.Filters, operation.ID, optName)
		if 0 == len(view.Filters) {
			// 保持 spec 5 根组不变量
			view.Filters = []*av.ViewFilter{{Combination: av.FilterCombinationAnd}}
		}
	}
	removeAttrViewOptionFromFieldFilters(attrView, attrView.ID, operation.ID, optName)

	return nil
}

func updateAttributeViewColumnOptionValues(attrView *av.AttributeView, operation *Operation) (err error) {
	key, err := attrView.GetKey(operation.ID)
	if err != nil {
		return
	}

	var data struct {
		OldName  string `json:"oldName"`
		NewName  string `json:"newName"`
		NewDesc  string `json:"newDesc"`
		NewColor string `json:"newColor"`
	}
	encoded, err := json.Marshal(operation.Data)
	if err != nil {
		return err
	}
	if err = json.Unmarshal(encoded, &data); err != nil {
		return err
	}
	oldName, newName := strings.TrimSpace(data.OldName), strings.TrimSpace(data.NewName)
	newDesc, newColor := strings.TrimSpace(data.NewDesc), attrView.FilterColorValue(data.NewColor)
	rename := oldName != newName

	found := false
	if oldName != newName {
		rename = true

		for _, opt := range key.Options {
			if newName == opt.Name { // 如果选项已经存在则直接使用
				found = true
				newColor = opt.Color
				newDesc = opt.Desc
				break
			}
		}
	}
	if rename {
		attrView.RenameNewItemTemplateSelectOption(operation.ID, oldName, newName, newColor)
	}

	if !found {
		for i, opt := range key.Options {
			if oldName == opt.Name {
				key.Options[i].Name = newName
				key.Options[i].Color = newColor
				key.Options[i].Desc = newDesc
				break
			}
		}
	}

	// 如果存在选项对应的值，需要更新值中的选项
	for _, keyValues := range attrView.KeyValues {
		if keyValues.Key.ID != operation.ID {
			continue
		}

		for _, value := range keyValues.Values {
			if nil == value || nil == value.MSelect {
				continue
			}

			found = false
			for _, opt := range value.MSelect {
				if newName == opt.Content {
					found = true
					break
				}
			}
			if found && rename {
				idx := -1
				for i, opt := range value.MSelect {
					if oldName == opt.Content {
						idx = i
						break
					}
				}
				if 0 <= idx {
					value.MSelect = util.RemoveElem(value.MSelect, idx)
				}
			} else {
				for i, opt := range value.MSelect {
					if oldName == opt.Content {
						value.MSelect[i].Content = newName
						value.MSelect[i].Color = newColor
						break
					}
				}
			}
		}
		break
	}

	// 如果存在选项对应的过滤条件，需要更新过滤条件中设置的选项值
	for _, view := range attrView.Views {
		av.RenameSelectOptionInFilters(view.Filters, key.ID, oldName, newName, newColor)
	}
	renameAttrViewOptionInFieldFilters(attrView, attrView.ID, key.ID, oldName, newName, newColor)

	return nil
}
