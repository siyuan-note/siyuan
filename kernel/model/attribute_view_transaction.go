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
	"strings"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 事务失败时恢复本次写入涉及的数据库和文档，租约保持到提交或回滚结束。
type attributeViewRollback struct {
	views  map[string]*av.AttributeView
	trees  map[string]*parse.Tree
	leases map[string]bool
}

func (tx *Transaction) readAttributeViewForMutation(avID, blockID, boxID string) (*av.AttributeView, error) {
	carrierBoxID, exact, err := resolveAttributeViewCarrierBoxID(blockID)
	if err != nil {
		return nil, err
	}
	if exact && carrierBoxID != boxID {
		return nil, fmt.Errorf("database [%s] moved across notebook encryption boundaries", avID)
	}
	if tx.attributeViewRollback == nil {
		tx.attributeViewRollback = &attributeViewRollback{views: map[string]*av.AttributeView{},
			trees: map[string]*parse.Tree{}, leases: map[string]bool{}}
	}
	if boxID != "" && !tx.attributeViewRollback.leases[boxID] {
		if err = AcquireEncryptedBoxOperation(boxID); err != nil {
			return nil, err
		}
		tx.attributeViewRollback.leases[boxID] = true
	}
	current, err := av.ParseAttributeViewForIndexInBox(avID, boxID)
	if err == nil && current == nil {
		err = av.ErrViewNotFound
	}
	return current, err
}

func (tx *Transaction) rememberAttributeViewMutationTree(blockID string) error {
	if blockID == "" {
		return nil
	}
	if tx.attributeViewRollback == nil {
		tx.attributeViewRollback = &attributeViewRollback{views: map[string]*av.AttributeView{},
			trees: map[string]*parse.Tree{}, leases: map[string]bool{}}
	}
	tree, err := tx.loadTree(blockID)
	if err != nil {
		return err
	}
	if tx.attributeViewRollback.trees[tree.ID] != nil {
		return nil
	}
	original, err := filesys.LoadTree(tree.Box, tree.Path, util.NewLute())
	if err != nil {
		return err
	}
	tx.attributeViewRollback.trees[tree.ID] = original
	return nil
}

func syncAttributeViewRelationIndexes(before, after *av.AttributeView) {
	targets := func(view *av.AttributeView) map[string]bool {
		ret := map[string]bool{}
		if view != nil {
			for _, kv := range view.KeyValues {
				if kv.Key.Type == av.KeyTypeRelation && kv.Key.Relation != nil && kv.Key.Relation.AvID != "" {
					ret[kv.Key.Relation.AvID] = true
				}
			}
		}
		return ret
	}
	beforeTargets, afterTargets := targets(before), targets(after)
	for id := range beforeTargets {
		if !afterTargets[id] {
			av.RemoveAvRel(after.ID, id)
		}
	}
	for id := range afterTargets {
		av.UpsertAvBackRel(after.ID, id)
	}
}

// 非编辑器变更在提交成功后清理失效历史；无事务的写入在保存后立即清理。
func (tx *Transaction) invalidateAttributeViewHistory(avID string) {
	if tx == nil {
		GlobalUndoLog.ClearAttributeView(avID)
		return
	}
	if tx.isReplay || tx.fromAPI && len(tx.UndoOperations) > 0 {
		return
	}
	if tx.invalidatedAvHistory == nil {
		tx.invalidatedAvHistory = map[string]bool{}
	}
	tx.invalidatedAvHistory[avID] = true
}

func (tx *Transaction) finishAttributeViewMutation(rollback bool) {
	if !rollback {
		for avID := range tx.invalidatedAvHistory {
			GlobalUndoLog.ClearAttributeView(avID)
		}
	}
	tx.invalidatedAvHistory = nil
	state := tx.attributeViewRollback
	if state == nil {
		return
	}
	if rollback {
		for key, original := range state.views {
			boxID, _, _ := strings.Cut(key, "/")
			current, _ := av.ParseAttributeViewForIndexInBox(original.ID, boxID)
			av.SetAVBoxID(original.ID, boxID)
			if err := av.SaveAttributeView(original); err != nil {
				logging.LogErrorf("restore database [%s] after transaction failure: %s", original.ID, err)
			} else {
				syncAttributeViewRelationIndexes(current, original)
			}
		}
		for _, tree := range state.trees {
			if err := restoreCreatedDocTreeSnapshot(tree); err != nil {
				logging.LogErrorf("restore database document [%s]: %s", tree.ID, err)
			}
		}
		for _, original := range state.views {
			ReloadAttrView(original.ID)
		}
	}
	for boxID := range state.leases {
		ReleaseEncryptedBoxOperation(boxID)
	}
	tx.attributeViewRollback = nil
}
