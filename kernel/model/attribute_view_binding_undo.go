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
	"fmt"
	"slices"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 换绑快照只保留主键值，条目 ID 和其他字段值始终保持不变。
type attributeViewBindingSnapshot struct {
	avID, blockID, boxID string
	before, after        *av.Value
	duplicateItemID      string
}

func (tx *Transaction) replaceAttributeViewBinding(op *Operation) error {
	state := op.attributeViewBinding
	if state != nil {
		if !tx.isReplay || state.avID != op.AvID || state.before.BlockID != op.PreviousID {
			return fmt.Errorf("invalid database binding replay")
		}
		current, err := tx.readAttributeViewForMutation(state.avID, state.blockID, state.boxID)
		if err != nil {
			return err
		}
		if state.duplicateItemID != "" {
			op.RetData = map[string]any{"targetItemID": state.duplicateItemID, "duplicate": true}
			return nil
		}
		expected, desired := state.before, state.after
		if op.attributeViewBindingUndo {
			expected, desired = desired, expected
		}
		value := current.GetBlockValue(expected.BlockID)
		if value == nil || value.Block == nil || value.ID != expected.ID || value.KeyID != expected.KeyID ||
			value.IsDetached != expected.IsDetached || value.Block.ID != expected.Block.ID {
			return fmt.Errorf("database entry binding [%s] changed", expected.BlockID)
		}
		if err = tx.applyAttributeViewBinding(current, value, desired, state); err != nil {
			return err
		}
		op.RetData = map[string]any{"targetItemID": value.BlockID, "duplicate": false}
		return nil
	}

	var inverse *Operation
	if tx.fromAPI && !tx.isReplay {
		for _, undo := range tx.UndoOperations {
			if undo.Action == "replaceAttrViewBlock" && undo.AvID == op.AvID &&
				undo.PreviousID == op.PreviousID && undo.attributeViewBinding == nil {
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
	state = &attributeViewBindingSnapshot{avID: op.AvID, blockID: blockID, boxID: av.GetAVBoxID(op.AvID)}
	current, err := tx.readAttributeViewForMutation(op.AvID, blockID, state.boxID)
	if err != nil {
		return err
	}
	value := current.GetBlockValue(op.PreviousID)
	if value == nil || value.Block == nil {
		return av.ErrItemNotFound
	}
	state.before = value.Clone()
	desired := value.Clone()
	desired.IsDetached, desired.Block.ID = op.IsDetached, op.NextID
	if op.IsDetached {
		desired.Block.ID, desired.Block.RefSubtype = "", ""
	} else if existing := current.GetBlockValueByBoundID(op.NextID); existing != nil && existing.BlockID != value.BlockID {
		// 重复绑定仅定位到已有条目，撤销和重做都不能修改两个条目的绑定。
		node, tree, loadErr := getNodeByBlockID(tx, op.NextID)
		if loadErr != nil {
			return loadErr
		}
		if node == nil {
			return ErrBlockNotFound
		}
		if err = validateAttributeViewBinding(current.ID, tree); err != nil {
			return err
		}
		state.duplicateItemID = existing.BlockID
	}
	if state.duplicateItemID == "" {
		if err = tx.applyAttributeViewBinding(current, value, desired, state); err != nil {
			return err
		}
	} else if err = tx.rememberAttributeViewMutationTree(blockID); err != nil {
		return err
	}
	state.after = value.Clone()
	if inverse != nil {
		op.attributeViewBinding, inverse.attributeViewBinding = state, state
		inverse.attributeViewBindingUndo = true
	}
	targetItemID := value.BlockID
	if state.duplicateItemID != "" {
		targetItemID = state.duplicateItemID
	}
	op.RetData = map[string]any{"targetItemID": targetItemID, "duplicate": state.duplicateItemID != ""}
	return nil
}

func (tx *Transaction) applyAttributeViewBinding(current *av.AttributeView, value, desired *av.Value,
	state *attributeViewBindingSnapshot) error {
	if !desired.IsDetached {
		if existing := current.GetBlockValueByBoundID(desired.Block.ID); existing != nil && existing.BlockID != value.BlockID {
			return fmt.Errorf("database block [%s] is already bound", desired.Block.ID)
		}
	}
	ids := []string{}
	if !value.IsDetached {
		ids = append(ids, value.Block.ID)
	}
	if !desired.IsDetached && !slices.Contains(ids, desired.Block.ID) {
		ids = append(ids, desired.Block.ID)
	}
	nodes, trees := map[string]*ast.Node{}, map[string]*parse.Tree{}
	for _, id := range ids {
		node, tree, err := getNodeByBlockID(tx, id)
		if err != nil {
			return err
		}
		if node == nil {
			return ErrBlockNotFound
		}
		if err = validateAttributeViewBinding(current.ID, tree); err != nil {
			return err
		}
		nodes[id], trees[id] = node, tree
	}
	restoredDocs := append(append([]*parse.Tree{}, tx.restoredCreatedDocs...), tx.restoredTemplateCreatedDocs...)
	for _, id := range append([]string{state.blockID}, ids...) {
		// 本事务恢复的文档由创建文档事务负责回滚，此时可能尚未写入磁盘。
		if slices.ContainsFunc(restoredDocs, func(tree *parse.Tree) bool {
			return trees[id] != nil && tree.ID == trees[id].ID
		}) {
			continue
		}
		if err := tx.rememberAttributeViewMutationTree(id); err != nil {
			return err
		}
	}
	key := state.boxID + "/" + current.ID
	if tx.attributeViewRollback.views[key] == nil {
		original, err := cloneAttributeViewForFieldMutation(current)
		if err != nil {
			return err
		}
		tx.attributeViewRollback.views[key] = original
	}
	for _, id := range ids {
		bound := !desired.IsDetached && id == desired.Block.ID
		avIDs := strings.Split(nodes[id].IALAttr(av.NodeAttrNameAvs), ",")
		avIDs = slices.DeleteFunc(avIDs, func(id string) bool { return id == "" || (!bound && id == current.ID) })
		if bound && !slices.Contains(avIDs, current.ID) {
			avIDs = append(avIDs, current.ID)
		}
		avs := strings.Join(avIDs, ",")
		if err := setNodeAttrsWithTx(tx, nodes[id], trees[id], map[string]string{
			av.NodeAttrNameAvs: avs, av.NodeAttrViewNames: getAvNames(avs),
		}); err != nil {
			return err
		}
	}
	block := desired.Clone().Block
	block.Created, block.Updated = value.Block.Created, value.Block.Updated
	value.IsDetached, value.Block = desired.IsDetached, block
	if !value.IsDetached {
		node := nodes[value.Block.ID]
		icon, content := getNodeAvBlockText(node, current.ID)
		value.Block.Icon, value.Block.Content = icon, util.UnescapeHTML(content)
		value.Block.RefSubtype = getNodeAvBlockRefSubtype(node, current.ID)
	}
	regenAttrViewGroups(current)
	if err := avSaveView(current, state.blockID); err != nil {
		return err
	}
	refreshRelatedSrcAvsInBlock(current.ID, state.blockID, tx)
	return nil
}
