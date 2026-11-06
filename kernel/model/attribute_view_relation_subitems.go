// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"fmt"

	"github.com/siyuan-note/siyuan/kernel/av"
)

// 快照只记录发生变化的父项边；挂到操作后保持不可变，供撤销日志的浅复制共享。
type attributeViewRelationSubItemsSnapshot struct {
	context                    AttributeViewRelationContext
	parentKeyID, childrenKeyID string
	before, after              map[string]string
}

func captureAttributeViewRelationSubItems(context *AttributeViewRelationContext, scope *attributeViewRelationScope,
	before *av.SubItemsIndex) (*attributeViewRelationSubItemsSnapshot, error) {
	state := &attributeViewRelationSubItemsSnapshot{context: *context,
		parentKeyID: scope.source.SubItems.ParentKeyID, childrenKeyID: scope.source.SubItems.ChildrenKeyID,
		before: map[string]string{}, after: map[string]string{}}
	if err := state.validateScope(scope); err != nil {
		return nil, err
	}
	after, err := scope.source.BuildSubItemsIndex()
	if err != nil {
		return nil, err
	}
	for id, parent := range before.Parents {
		current, exists := after.Parents[id]
		if !exists {
			return nil, av.ErrItemNotFound
		}
		if current != parent {
			state.before[id], state.after[id] = parent, current
		}
	}
	return state, nil
}

func (state *attributeViewRelationSubItemsSnapshot) operationContext(op *Operation) (*AttributeViewRelationContext, error) {
	context := state.context
	if op.Action != "updateAttrViewRelationItems" || op.AvID != context.SourceAvID || op.RowID != context.SourceItemID ||
		op.KeyID != context.RelationKeyID || !context.storageKnown {
		return nil, errors.New("database sub-item relation replay context does not match")
	}
	if previous := op.relationDetailContext; previous != nil {
		if previous.SourceAvID != context.SourceAvID || previous.SourceItemID != context.SourceItemID ||
			previous.RelationKeyID != context.RelationKeyID || previous.storageKnown && previous.storageBoxID != context.storageBoxID {
			return nil, errors.New("database sub-item relation replay changed storage context")
		}
	}
	return &context, nil
}

func (state *attributeViewRelationSubItemsSnapshot) validateScope(scope *attributeViewRelationScope) error {
	source := scope.source
	boxID, scoped := source.StorageContext()
	if !state.context.storageKnown || !scoped || boxID != state.context.storageBoxID || scope.boxID != boxID ||
		source.ID != state.context.SourceAvID || scope.target.ID != source.ID {
		return errors.New("database sub-item relation replay changed storage context")
	}
	if !source.HasSubItems() || source.SubItems.ParentKeyID != state.parentKeyID ||
		source.SubItems.ChildrenKeyID != state.childrenKeyID || !source.IsSubItemsKey(state.context.RelationKeyID) {
		return errors.New("database sub-item relation configuration changed")
	}
	return nil
}

func (tx *Transaction) replayAttributeViewRelationSubItems(op *Operation) error {
	state := op.attributeViewRelationSubItems
	context, err := state.operationContext(op)
	if err != nil {
		return err
	}
	scope, err := tx.resolveRelationChangeScope(op, context, context.SourceAvID, false)
	if err != nil {
		return err
	}
	if err = state.validateScope(scope); err != nil {
		return err
	}
	index, err := scope.source.BuildSubItemsIndex()
	if err != nil {
		return err
	}
	expected, desired := state.before, state.after
	if op.attributeViewRelationSubUndo {
		expected, desired = state.after, state.before
	}
	for id, parent := range expected {
		if current, exists := index.Parents[id]; !exists || current != parent {
			return fmt.Errorf("database sub-item parent of entry [%s] changed after relation edit", id)
		}
	}
	if len(desired) == 0 {
		return nil
	}
	current, err := cloneAttributeViewForFieldMutation(scope.source)
	if err != nil {
		return err
	}
	// 用当前完整图校验并维护反向边，不覆盖其他条目在此期间新增的父子关系。
	if err = current.SetSubItemsParents(desired); err != nil {
		return err
	}
	tx.attributeViewItemCreation = true
	if err = tx.rememberAutomationView(scope.source, op.BlockID); err != nil {
		return err
	}
	regenAttrViewGroups(current)
	if err = avSaveView(current, op.BlockID); err != nil {
		return err
	}
	refreshRelatedSrcAvsInBlock(current.ID, op.BlockID, tx)
	ReloadAttrView(current.ID)
	return nil
}
