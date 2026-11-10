// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"fmt"
	"strings"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 事务失败时恢复本次写入涉及的数据库和文档，租约保持到提交或回滚结束。
type attributeViewRollback struct {
	views        map[string]*av.AttributeView
	createdViews map[string]string
	trees        map[string]*parse.Tree
	leases       map[string]bool
}

func (tx *Transaction) readAttributeViewForMutation(avID, blockID, boxID string, exactStorage ...bool) (*av.AttributeView, error) {
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
	var current *av.AttributeView
	storageKnown := tx.attributeViewStorageContexts != nil || len(exactStorage) > 0 && exactStorage[0]
	if tx.historyRecovery != nil {
		current, err = tx.historyRecovery.readCurrent(avID, boxID)
	} else if storageKnown {
		current, err = av.ParseAttributeViewWithStorageContext(avID, boxID)
	} else {
		current, err = av.ParseAttributeViewForIndexInBox(avID, boxID)
	}
	if err == nil && current == nil {
		err = av.ErrViewNotFound
	}
	if err == nil {
		if tx.attributeViewStorageContexts != nil {
			if previous, exists := tx.attributeViewStorageContexts[avID]; exists && previous != boxID {
				return nil, fmt.Errorf("ambiguous database storage context [%s]", avID)
			}
			tx.attributeViewStorageContexts[avID] = boxID
		}
		if storageKnown {
			if err = current.SetStorageContext(boxID); err != nil {
				return nil, err
			}
		}
		tx.watchSourceDatabase(current)
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
	if _, scoped := after.StorageContext(); scoped {
		if err := syncAttributeViewRelationIndexesWithErr(before, after); err != nil {
			logging.LogErrorf("restore database relation indexes [%s]: %s", after.ID, err)
		}
		return
	}
	beforeTargets, afterTargets := attributeViewRelationTargets(before), attributeViewRelationTargets(after)
	for id := range beforeTargets {
		if !afterTargets[id] {
			av.RemoveAvRel(after.ID, id)
		}
	}
	for id := range afterTargets {
		av.UpsertAvBackRel(after.ID, id)
	}
}

func attributeViewRelationTargets(view *av.AttributeView) map[string]bool {
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

func syncAttributeViewRelationIndexesWithErr(before, after *av.AttributeView) error {
	beforeTargets, afterTargets := attributeViewRelationTargets(before), attributeViewRelationTargets(after)
	remove := func(id string) error { return av.RemoveAvRelWithErr(after.ID, id) }
	upsert := func(id string) error { return av.UpsertAvBackRelWithErr(after.ID, id) }
	if boxID, scoped := after.StorageContext(); scoped {
		remove = func(id string) error { return av.RemoveAvRelInBoxWithErr(after.ID, id, boxID) }
		upsert = func(id string) error { return av.UpsertAvBackRelInBoxWithErr(after.ID, id, boxID) }
	}
	for id := range beforeTargets {
		if !afterTargets[id] {
			if err := remove(id); err != nil {
				return err
			}
		}
	}
	for id := range afterTargets {
		if err := upsert(id); err != nil {
			return err
		}
	}
	return nil
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
		if automation := tx.attributeViewAutomations; automation != nil {
			var attrs []*Operation
			for _, operation := range tx.DoOperations {
				if operation == automation.blockAttrs[operation.ID] {
					attrs = append(attrs, operation)
				}
			}
			if len(attrs) > 0 {
				// 块 API 不广播完整事务，提交后仍需独立同步属性。
				event := util.NewCmdResult("transactions", 0, util.PushModeBroadcast)
				event.Data = []*Transaction{{DoOperations: attrs, UndoOperations: []*Operation{}}}
				util.PushEvent(event)
			}
			for _, paused := range automation.paused {
				util.PushMsg(paused.message(), 7000)
			}
			if !tx.isReplay && tx.state.Load() == 2 {
				if message := automation.successMessage(); message != "" {
					notify := tx.pushAutomationMessage
					if notify == nil {
						notify = util.PushMsg
					}
					notify(message, 5000)
				}
			}
		}
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
			if _, created := state.createdViews[key]; created {
				continue
			}
			boxID, _, _ := strings.Cut(key, "/")
			var current *av.AttributeView
			if _, scoped := original.StorageContext(); scoped {
				current, _ = av.ParseAttributeViewWithStorageContext(original.ID, boxID)
			} else {
				current, _ = av.ParseAttributeViewForIndexInBox(original.ID, boxID)
			}
			if tx.sourceDatabase(original.ID, boxID) != nil {
				syncAttributeViewRelationIndexes(current, original)
				continue
			}
			if _, scoped := original.StorageContext(); !scoped {
				av.SetAVBoxID(original.ID, boxID)
			}
			if err := av.SaveAttributeView(original); err != nil {
				logging.LogErrorf("restore database [%s] after transaction failure: %s", original.ID, err)
			} else {
				syncAttributeViewRelationIndexes(current, original)
			}
		}
		for key, filename := range state.createdViews {
			boxID, id, _ := strings.Cut(key, "/")
			var view *av.AttributeView
			if tx.attributeViewStorageContexts != nil {
				view, _ = av.ParseAttributeViewWithStorageContext(id, boxID)
			} else {
				view, _ = av.ParseAttributeViewForIndexInBox(id, boxID)
			}
			if err := filelock.Remove(filename); err != nil {
				logging.LogErrorf("remove restored database [%s] after transaction failure: %s", id, err)
			} else {
				cache.RemoveAVDataInBox(id, boxID)
			}
			if view != nil {
				for _, kv := range view.KeyValues {
					if kv.Key.Relation != nil {
						if tx.attributeViewStorageContexts != nil {
							if err := av.RemoveAvRelInBoxWithErr(id, kv.Key.Relation.AvID, boxID); err != nil {
								logging.LogErrorf("remove restored database relation [%s]: %s", id, err)
							}
						} else {
							av.RemoveAvRel(id, kv.Key.Relation.AvID)
						}
					}
				}
			}
		}
		for _, tree := range state.trees {
			if tx.documentSource(tree) != nil {
				continue
			}
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
