// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"

	"github.com/siyuan-note/siyuan/kernel/av"
)

// 只有已验证单元格自身清除反向边时，日志才记录离开详情范围的重放凭据。
type attributeViewRelationCellReplay struct {
	root                                 AttributeViewRelationContext
	blockID, targetID, rootKey, subItems string
	forward, reverse                     string
	cells                                []attributeViewRelationCellReplayValue
	lost                                 []string
}

type attributeViewRelationCellReplayValue struct {
	rowID, keyID, key string
	before, after     []string
	causal            bool
}

type attributeViewRelationCellReplayCapture struct {
	operations       []*Operation
	states           []*attributeViewRelationCellReplay
	requestedRemoval map[[8]string]bool
}

func relationCellReplayRoot(op *Operation) *AttributeViewRelationContext {
	if op.RelationContext != nil {
		return op.RelationContext
	}
	if op.relationCellContext != nil {
		return &op.relationCellContext.RelationContext
	}
	return nil
}

func relationCellReplayCells(op *Operation) []*AttrViewCellUpdate {
	if op.Action == "updateAttrViewCells" {
		return op.CellUpdates
	}
	return []*AttrViewCellUpdate{{RowID: op.RowID, KeyID: op.KeyID, Data: op.Data}}
}

func relationCellReplayKey(key *av.Key) string {
	if key == nil || key.Type != av.KeyTypeRelation || key.Relation == nil {
		return ""
	}
	data, _ := json.Marshal([]any{key.Type, key.Relation.AvID, key.Relation.IsTwoWay, key.Relation.BackKeyID})
	return string(data)
}

func relationCellReplayIDs(view *av.AttributeView, keyID, rowID string) []string {
	if value := view.GetValue(keyID, rowID); value != nil && value.Relation != nil {
		return slices.Clone(value.Relation.BlockIDs)
	}
	return nil
}

func relationCellReplaySubItems(view *av.AttributeView) string {
	data, _ := json.Marshal(view.SubItems)
	return string(data)
}

func relationCellReplayOperation(op *Operation) (string, error) {
	data, err := json.Marshal([]any{op.Action, op.AvID, op.BlockID, op.RowID, op.KeyID, op.Data, op.CellUpdates})
	return string(data), err
}

func sameRelationCellReplayRoot(left, right *AttributeViewRelationContext) bool {
	return left != nil && right != nil && left.SourceAvID == right.SourceAvID && left.SourceItemID == right.SourceItemID &&
		left.RelationKeyID == right.RelationKeyID && (!left.storageKnown || !right.storageKnown || left.storageBoxID == right.storageBoxID)
}

func relationCellReplayAddress(state *attributeViewRelationCellReplay, rowID, keyID string) [8]string {
	return [8]string{state.root.SourceAvID, state.root.SourceItemID, state.root.RelationKeyID, state.root.storageBoxID,
		state.blockID, state.targetID, rowID, keyID}
}

func relationCellReplayRequestsRemoval(data any, rootID string, delta bool) bool {
	encoded, err := json.Marshal(data)
	if err != nil {
		return false
	}
	if delta {
		var change AttributeViewRelationItemsChange
		return json.Unmarshal(encoded, &change) == nil && slices.Contains(change.RemoveItemIDs, rootID)
	}
	var value av.Value
	return json.Unmarshal(encoded, &value) == nil && value.Relation != nil && !slices.Contains(value.Relation.BlockIDs, rootID)
}

func (tx *Transaction) beginRelationCellReplay(operations []*Operation) (*attributeViewRelationCellReplayCapture, error) {
	if tx.isReplay || !tx.fromAPI || len(tx.UndoOperations) == 0 {
		return nil, nil
	}
	ret := &attributeViewRelationCellReplayCapture{requestedRemoval: map[[8]string]bool{}}
	for _, op := range operations {
		root := relationCellReplayRoot(op)
		if root == nil {
			continue
		}
		cells := relationCellReplayCells(op)
		rows := make([]string, 0, len(cells))
		for _, cell := range cells {
			if cell == nil {
				return nil, errors.New("invalid relation detail cell")
			}
			rows = append(rows, cell.RowID)
		}
		scope, err := tx.resolveRelationCellReplayScope(op, root, op.AvID, rows)
		if err != nil {
			return nil, err
		}
		state := &attributeViewRelationCellReplay{root: *root, blockID: op.BlockID, targetID: op.AvID, rootKey: relationCellReplayKey(scope.key)}
		causal := false
		seen := map[[2]string]bool{}
		for _, cell := range cells {
			key, _ := scope.target.GetKey(cell.KeyID)
			identity := relationCellReplayKey(key)
			if identity == "" {
				continue
			}
			value := attributeViewRelationCellReplayValue{rowID: cell.RowID, keyID: cell.KeyID, key: identity,
				before: relationCellReplayIDs(scope.target, cell.KeyID, cell.RowID)}
			value.causal = scope.key.Relation.IsTwoWay && key.Relation.IsTwoWay && key.Relation.AvID == root.SourceAvID &&
				key.Relation.BackKeyID == root.RelationKeyID && scope.key.Relation.BackKeyID == key.ID &&
				slices.Contains(value.before, root.SourceItemID)
			if value.causal && op.Action == "updateAttrViewCells" {
				address := [2]string{cell.RowID, cell.KeyID}
				if seen[address] {
					return nil, errors.New("relation detail batch repeats a membership-changing cell")
				}
				seen[address] = true
			}
			if value.causal && op.Action != "updateAttrViewRelationItems" && relationCellReplayRequestsRemoval(cell.Data, root.SourceItemID, false) {
				ret.requestedRemoval[relationCellReplayAddress(state, cell.RowID, cell.KeyID)] = true
			}
			causal = causal || value.causal
			if scope.target.IsSubItemsKey(key.ID) {
				state.subItems = relationCellReplaySubItems(scope.target)
			}
			state.cells = append(state.cells, value)
		}
		if causal {
			ret.operations, ret.states = append(ret.operations, op), append(ret.states, state)
		}
	}
	return ret, nil
}

func sameRelationCellReplayAddresses(left, right *Operation) bool {
	if left.Action != right.Action || left.AvID != right.AvID || left.BlockID != right.BlockID ||
		!sameRelationCellReplayRoot(relationCellReplayRoot(left), relationCellReplayRoot(right)) {
		return false
	}
	leftCells, rightCells := relationCellReplayCells(left), relationCellReplayCells(right)
	if len(leftCells) != len(rightCells) {
		return false
	}
	counts := map[[2]string]int{}
	for _, cell := range leftCells {
		if cell == nil {
			return false
		}
		counts[[2]string{cell.RowID, cell.KeyID}]++
	}
	for _, cell := range rightCells {
		if cell == nil {
			return false
		}
		address := [2]string{cell.RowID, cell.KeyID}
		if counts[address] == 0 {
			return false
		}
		counts[address]--
	}
	return true
}

func normalizeRelationCellReplayValues(op *Operation, values []attributeViewRelationCellReplayValue, undo bool) {
	if op.Action != "updateAttrViewCell" && op.Action != "updateAttrViewCells" {
		return
	}
	cells := relationCellReplayCells(op)
	updates := make([]*AttrViewCellUpdate, 0, len(cells))
	for _, cell := range cells {
		copy := *cell
		for _, value := range values {
			if value.rowID == cell.RowID && value.keyID == cell.KeyID {
				ids := value.after
				if undo {
					ids = value.before
				}
				copy.Data = &av.Value{Type: av.KeyTypeRelation, Relation: &av.ValueRelation{BlockIDs: slices.Clone(ids)}}
				break
			}
		}
		updates = append(updates, &copy)
	}
	if op.Action == "updateAttrViewCells" {
		op.CellUpdates = updates
	} else {
		op.Data = updates[0].Data
	}
}

func (tx *Transaction) finishRelationCellReplay(capture *attributeViewRelationCellReplayCapture, inverses ...*Operation) error {
	if capture == nil {
		return nil
	}
	matched := map[*Operation]bool{}
	for index, state := range capture.states {
		op := capture.operations[index]
		root := state.root
		if op.Action == "updateAttrViewRelationItems" && relationCellReplayRequestsRemoval(op.Data, root.SourceItemID, true) {
			capture.requestedRemoval[relationCellReplayAddress(state, op.RowID, op.KeyID)] = true
		}
		scope, err := resolveAttributeViewRelationScope(&root, state.blockID, state.targetID, true)
		if err != nil {
			return err
		}
		if relationCellReplayKey(scope.key) != state.rootKey {
			return errors.New("relation detail field changed during cell edit")
		}
		for i := range state.cells {
			cell := &state.cells[i]
			key, _ := scope.target.GetKey(cell.keyID)
			if relationCellReplayKey(key) != cell.key {
				return errors.New("relation cell field changed during edit")
			}
			cell.after = relationCellReplayIDs(scope.target, cell.keyID, cell.rowID)
			if cell.causal && capture.requestedRemoval[relationCellReplayAddress(state, cell.rowID, cell.keyID)] &&
				!slices.Contains(cell.after, root.SourceItemID) && !slices.Contains(scope.itemIDs, cell.rowID) &&
				!slices.Contains(state.lost, cell.rowID) {
				state.lost = append(state.lost, cell.rowID)
			}
		}
		if len(state.lost) == 0 {
			continue
		}
		var inverse *Operation
		if len(inverses) > 0 {
			if index < len(inverses) {
				inverse = inverses[index]
			}
		} else {
			for i := len(tx.UndoOperations) - 1; i >= 0; i-- {
				candidate := tx.UndoOperations[i]
				if !matched[candidate] && candidate.relationCellReplay == nil && sameRelationCellReplayAddresses(op, candidate) {
					inverse = candidate
					break
				}
			}
		}
		if inverse == nil {
			continue
		}
		if !sameRelationCellReplayAddresses(op, inverse) {
			return errors.New("relation cell inverse does not match the edited cells")
		}
		matched[inverse] = true
		normalizeRelationCellReplayValues(op, state.cells, false)
		normalizeRelationCellReplayValues(inverse, state.cells, true)
		if state.forward, err = relationCellReplayOperation(op); err != nil {
			return err
		}
		if state.reverse, err = relationCellReplayOperation(inverse); err != nil {
			return err
		}
		op.relationCellReplay, inverse.relationCellReplay = state, state
		inverse.relationCellReplayUndo = true
	}
	return nil
}

func (tx *Transaction) resolveRelationCellReplayScope(op *Operation, root *AttributeViewRelationContext, targetID string, rows []string) (*attributeViewRelationScope, error) {
	state := op.relationCellReplay
	context := root
	if state != nil {
		if !tx.isReplay || !state.root.storageKnown || !sameRelationCellReplayRoot(root, &state.root) ||
			op.BlockID != state.blockID || targetID != state.targetID || op.AvID != state.targetID {
			return nil, errors.New("relation cell replay context does not match")
		}
		operation, err := relationCellReplayOperation(op)
		if err != nil {
			return nil, err
		}
		expected := state.forward
		if op.relationCellReplayUndo {
			expected = state.reverse
		}
		if operation != expected {
			return nil, errors.New("relation cell replay operation changed")
		}
		copy := state.root
		context = &copy
	}
	scope, err := resolveAttributeViewRelationScope(context, op.BlockID, targetID, true)
	if err != nil {
		return nil, err
	}
	if state != nil {
		if relationCellReplayKey(scope.key) != state.rootKey ||
			state.subItems != "" && relationCellReplaySubItems(scope.target) != state.subItems {
			return nil, errors.New("relation cell replay field changed")
		}
		for _, cell := range state.cells {
			key, _ := scope.target.GetKey(cell.keyID)
			expected := cell.before
			if op.relationCellReplayUndo {
				expected = cell.after
			}
			if relationCellReplayKey(key) != cell.key || scope.target.GetBlockValue(cell.rowID) == nil ||
				!slices.Equal(relationCellReplayIDs(scope.target, cell.keyID, cell.rowID), expected) {
				return nil, errors.New("relation cell changed after edit")
			}
		}
		for _, id := range state.lost {
			if slices.Contains(scope.itemIDs, id) == op.relationCellReplayUndo {
				return nil, errors.New("relation detail membership changed after cell edit")
			}
		}
	}
	for _, id := range rows {
		allowed := slices.Contains(scope.itemIDs, id)
		if state != nil && op.relationCellReplayUndo && slices.Contains(state.lost, id) {
			allowed = true
		}
		if !allowed || scope.target.GetBlockValue(id) == nil {
			return nil, fmt.Errorf("item [%s] is outside the relation detail context", id)
		}
	}
	return scope, nil
}

func (state *attributeViewRelationCellReplay) clone() *attributeViewRelationCellReplay {
	if state == nil {
		return nil
	}
	copy := *state
	copy.lost = slices.Clone(state.lost)
	copy.cells = slices.Clone(state.cells)
	for i := range copy.cells {
		copy.cells[i].before = slices.Clone(state.cells[i].before)
		copy.cells[i].after = slices.Clone(state.cells[i].after)
	}
	return &copy
}
