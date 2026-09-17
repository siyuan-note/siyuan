package model

import (
	"github.com/siyuan-note/siyuan/kernel/av"
)

// 跨组拖拽保存实际变化，撤销时恢复完整字段值和分组顺序，不重新计算默认值。
func (tx *Transaction) sortAttributeViewItem(op *Operation) error {
	if op.attributeViewFields != nil {
		return tx.replayAttributeViewFields(op)
	}
	if isAttributeViewRowOrderOperation(op.Data) || op.GroupID == "" || op.GroupID == op.TargetGroupID {
		return sortAttributeViewRow(op)
	}
	if _, err := avParseView(op.AvID, op.BlockID); err != nil {
		return err
	}
	state := &attributeViewFieldsSnapshot{avID: op.AvID, keyID: op.ID, blockID: op.BlockID,
		boxID: av.GetAVBoxID(op.AvID), changes: map[string]*attributeViewFieldChange{}}
	source, err := tx.readAttributeViewForMutation(op.AvID, op.BlockID, state.boxID)
	if err != nil {
		return err
	}
	view, err := resolveAttributeViewView(source, op.ViewID, "", op.BlockID)
	if err != nil {
		return err
	}
	if view.Group == nil {
		return sortAttributeViewRow(op)
	}
	key := view.GetGroupKey(source)
	if key == nil {
		return av.ErrViewNotFound
	}
	state.fieldTypes = map[string]map[string]av.KeyType{source.ID: {key.ID: key.Type}}
	before := map[string]*av.AttributeView{source.ID: source}
	// 默认值可能更新双向关联，相关数据库必须先读取并纳入失败回滚。
	for _, kv := range source.KeyValues {
		relation := kv.Key.Relation
		if kv.Key.Type != av.KeyTypeRelation || relation == nil || !relation.IsTwoWay || relation.AvID == "" || before[relation.AvID] != nil {
			continue
		}
		related, readErr := tx.readAttributeViewForMutation(relation.AvID, op.BlockID, state.boxID)
		if readErr != nil {
			return readErr
		}
		before[related.ID] = related
	}
	if err = tx.rememberAttributeViewMutationTree(op.BlockID); err != nil {
		return err
	}
	for id, original := range before {
		if rollbackKey := state.boxID + "/" + id; tx.attributeViewRollback.views[rollbackKey] == nil {
			tx.attributeViewRollback.views[rollbackKey] = original
		}
	}
	var inverse *Operation
	if tx.fromAPI && !tx.isReplay {
		for _, undo := range tx.UndoOperations {
			if undo.Action == "sortAttrViewRow" && undo.AvID == op.AvID && undo.ID == op.ID &&
				undo.GroupID == op.TargetGroupID && undo.TargetGroupID == op.GroupID && undo.attributeViewFields == nil {
				inverse = undo
				break
			}
		}
	}
	op.ViewID = view.ID
	if err = sortAttributeViewRow(op); err != nil {
		return err
	}
	if inverse == nil {
		return nil
	}
	for id, original := range before {
		current, readErr := tx.readAttributeViewForMutation(id, op.BlockID, state.boxID)
		if readErr != nil {
			return readErr
		}
		oldJSON, jsonErr := attributeViewFieldJSON(original)
		if jsonErr != nil {
			return jsonErr
		}
		newJSON, jsonErr := attributeViewFieldJSON(current)
		if jsonErr != nil {
			return jsonErr
		}
		if change := diffAttributeViewFields(oldJSON, newJSON, true, true); change != nil {
			state.changes[id] = change
		}
	}
	op.attributeViewFields = state
	inverse.attributeViewFields, inverse.attributeViewFieldUndo = state, true
	inverse.BlockID, inverse.ViewID = op.BlockID, view.ID
	return nil
}
