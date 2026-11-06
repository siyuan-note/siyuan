// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"errors"

	"github.com/siyuan-note/siyuan/kernel/av"
)

type relationDetailRetargetPlan struct {
	state              *attributeViewRelationDetailSnapshot
	undoTarget, setter *Operation
}

func (tx *Transaction) prepareRelationDetailRetarget(op *Operation) (*relationDetailRetargetPlan, error) {
	if state := op.relationDetailConfig; state != nil {
		if !tx.isReplay || state.retargetID == "" || op.AvID != state.context.SourceAvID || op.KeyID != state.keyID {
			return nil, errors.New("relation detail retarget replay does not match")
		}
		context := state.context
		if err := context.ResolveStorage(op.BlockID); err != nil {
			return nil, err
		}
		source, err := av.ParseAttributeViewWithStorageContext(op.AvID, context.storageBoxID)
		if err != nil {
			return nil, err
		}
		key, err := source.GetKey(op.KeyID)
		if err != nil || key.Relation == nil {
			return nil, av.ErrKeyNotFound
		}
		currentTarget, desiredTarget, expected := state.targetID, state.retargetID, state.before
		if op.relationDetailConfigUndo {
			currentTarget, desiredTarget, expected = state.retargetID, state.targetID, state.after
		}
		data, err := json.Marshal(key.Relation.DetailView)
		if err != nil {
			return nil, err
		}
		if key.Relation.AvID != currentTarget || op.ID != desiredTarget || string(data) != expected {
			return nil, errors.New("relation detail target or configuration changed after retarget")
		}
		return &relationDetailRetargetPlan{state: state}, nil
	}
	if tx.isReplay || !tx.fromAPI {
		return nil, nil
	}
	source, err := tx.parseAttributeViewForOperation(op.AvID, op.BlockID)
	if err != nil {
		return nil, err
	}
	key, err := source.GetKey(op.KeyID)
	if err != nil || key.Relation == nil || key.Relation.AvID == op.ID || key.Relation.DetailView == nil {
		return nil, nil
	}
	if err = key.Relation.DetailView.Validate(); err != nil {
		return nil, err
	}
	before, err := json.Marshal(key.Relation.DetailView)
	if err != nil {
		return nil, err
	}
	for i := len(tx.UndoOperations) - 1; i >= 0; i-- {
		inverse := tx.UndoOperations[i]
		if inverse.Action != op.Action || inverse.AvID != op.AvID || inverse.KeyID != op.KeyID ||
			inverse.ID != key.Relation.AvID || tx.relationDetailUndoUsed[inverse] {
			continue
		}
		for _, setter := range tx.UndoOperations[i+1:] {
			if setter.AvID != op.AvID || setter.KeyID != op.KeyID {
				continue
			}
			if setter.Action == op.Action {
				break
			}
			if setter.Action != "setAttrViewRelationDetail" || tx.relationDetailUndoUsed[setter] {
				continue
			}
			data, marshalErr := json.Marshal(setter.Data)
			var requested *av.RelationDetailView
			if marshalErr != nil || json.Unmarshal(data, &requested) != nil {
				continue
			}
			data, marshalErr = json.Marshal(requested)
			if marshalErr != nil || string(data) != string(before) {
				continue
			}
			_, boxID := source.StoragePath()
			state := &attributeViewRelationDetailSnapshot{context: AttributeViewRelationContext{SourceAvID: source.ID,
				RelationKeyID: op.KeyID, storageBoxID: boxID, storageKnown: true}, keyID: op.KeyID,
				targetID: key.Relation.AvID, retargetID: op.ID, before: string(before), after: "null"}
			return &relationDetailRetargetPlan{state: state, undoTarget: inverse, setter: setter}, nil
		}
	}
	return nil, nil
}

func (tx *Transaction) recordRelationDetailRetarget(op *Operation, plan *relationDetailRetargetPlan) {
	if plan == nil || plan.setter == nil {
		return
	}
	op.relationDetailConfig = plan.state
	if tx.relationDetailUndoUsed == nil {
		tx.relationDetailUndoUsed = map[*Operation]bool{}
	}
	for _, undo := range []*Operation{plan.undoTarget, plan.setter} {
		undo.relationDetailConfig, undo.relationDetailConfigUndo = plan.state, true
		if undo.BlockID == "" {
			undo.BlockID = op.BlockID
		}
		tx.relationDetailUndoUsed[undo] = true
	}
	plan.setter.Data = json.RawMessage(plan.state.before)
}
