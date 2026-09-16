package model

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"slices"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func boundAttributeViewHistoryPath(historyDir, boxID, avID string) string {
	return filepath.Join(historyDir, boxID, "storage", "av", avID+".json")
}

func readBoundAttributeViewHistory(filename, boxID, avID string) (*av.AttributeView, error) {
	data, err := filelock.ReadFile(filename)
	if err != nil {
		return nil, err
	}
	if boxID != "" {
		if !util.IsCiphertext(data) {
			return nil, errors.New("encrypted database history is plaintext")
		}
		data, err = av.DecryptAVData(boxID, avID, data)
		if err != nil {
			return nil, err
		}
	} else if util.IsCiphertext(data) {
		return nil, errors.New("encrypted database history has no notebook context")
	}
	view, err := av.ParseAttributeViewData(avID, data)
	if err != nil {
		return nil, err
	}
	if view.ID != avID {
		return nil, errors.New("database history ID does not match its filename")
	}
	for _, kv := range view.KeyValues {
		if kv == nil || kv.Key == nil {
			return nil, errors.New("database history contains an invalid field")
		}
		for _, value := range kv.Values {
			if value == nil {
				return nil, errors.New("database history contains an invalid value")
			}
		}
	}
	if view.GetBlockKeyValues() == nil {
		return nil, errors.New("database history has no primary field")
	}
	for _, layout := range view.Views {
		if layout == nil {
			return nil, errors.New("database history contains an invalid view")
		}
		for _, group := range layout.Groups {
			if group == nil {
				return nil, errors.New("database history contains an invalid group")
			}
		}
	}
	return view, nil
}

// 内嵌数据库也先认证历史，并与绑定条目恢复一起纳入失败回滚。
func (tx *Transaction) restoreEmbeddedAttributeViewHistory(filename, boxID, avID string) error {
	historical, err := readBoundAttributeViewHistory(filename, boxID, avID)
	if err != nil {
		if boxID == "" && os.IsNotExist(err) {
			return nil
		}
		return err
	}
	current, err := tx.readAttributeViewForMutation(avID, "", boxID)
	if err != nil {
		return err
	}
	return tx.saveAttributeViewFieldChanges(&attributeViewFieldsSnapshot{boxID: boxID},
		map[string]*av.AttributeView{avID: current}, map[string]*av.AttributeView{avID: historical})
}

// 删除文档前备份内嵌和绑定的数据库，沿用现有历史格式与加密路径，保留同一批删除的早期快照。
func backupBoundAttributeViewHistory(tree *parse.Tree, historyDir string) error {
	bound := map[string]map[string]struct{}{}
	collectDeletedAttributeViewBlocks(tree.Root, true, bound)
	for _, node := range tree.Root.ChildrenByType(ast.NodeAttributeView) {
		bound[node.AttributeViewID] = nil
	}
	boxID := ""
	if IsEncryptedBox(tree.Box) {
		boxID = tree.Box
	}
	for _, id := range sortedAttributeViewFieldKeys(bound) {
		source, _ := av.FindAttributeViewPathInBox(id, boxID)
		if source == "" {
			continue
		}
		if _, err := readBoundAttributeViewHistory(source, boxID, id); err != nil {
			return err
		}
		dest := boundAttributeViewHistoryPath(historyDir, boxID, id)
		if _, err := os.Stat(dest); err == nil {
			if _, err = readBoundAttributeViewHistory(dest, boxID, id); err != nil {
				return err
			}
			continue
		} else if !os.IsNotExist(err) {
			return err
		}
		if err := filelock.Copy(source, dest); err != nil {
			return err
		}
	}
	return nil
}

// 文档回滚只合并该文档缺失的条目，不覆盖数据库中其他条目的后续编辑。
func (tx *Transaction) restoreBoundAttributeViewHistory(tree *parse.Tree, historyDir string) error {
	bound := map[string]map[string]struct{}{}
	collectDeletedAttributeViewBlocks(tree.Root, true, bound)
	boxID := ""
	if IsEncryptedBox(tree.Box) {
		boxID = tree.Box
	}
	before, after := map[string]*av.AttributeView{}, map[string]*av.AttributeView{}
	load := func(id string) (*av.AttributeView, error) {
		if after[id] != nil {
			return after[id], nil
		}
		current, err := tx.readAttributeViewForMutation(id, "", boxID)
		if err != nil {
			return nil, err
		}
		copy, err := cloneAttributeViewForFieldMutation(current)
		if err != nil {
			return nil, err
		}
		before[id], after[id] = current, copy
		return copy, nil
	}
	restoredItems := map[string][]string{}
	for _, id := range sortedAttributeViewFieldKeys(bound) {
		historical, err := readBoundAttributeViewHistory(boundAttributeViewHistoryPath(historyDir, boxID, id), boxID, id)
		if os.IsNotExist(err) {
			// 早期文档历史可能没有绑定数据库快照，保留原有文档回滚能力。
			continue
		}
		if err != nil {
			return err
		}
		current, err := load(id)
		if err != nil {
			return err
		}
		var itemIDs []string
		for _, primary := range historical.GetBlockKeyValues().Values {
			if primary.IsDetached || primary.Block == nil {
				continue
			}
			if _, exists := bound[id][primary.Block.ID]; !exists || current.GetBlockValueByBoundID(primary.Block.ID) != nil {
				continue
			}
			if current.GetBlockValue(primary.BlockID) != nil {
				return fmt.Errorf("database entry [%s] has a different binding", primary.BlockID)
			}
			itemIDs = append(itemIDs, primary.BlockID)
		}
		if len(itemIDs) == 0 {
			continue
		}
		for _, kv := range historical.KeyValues {
			for _, value := range kv.Values {
				if !slices.Contains(itemIDs, value.BlockID) {
					continue
				}
				field, err := current.GetKeyValues(kv.Key.ID)
				if err != nil || field.Key.Type != kv.Key.Type || !reflect.DeepEqual(field.Key.Relation, kv.Key.Relation) {
					return fmt.Errorf("database field [%s] changed since document deletion", kv.Key.ID)
				}
				if field.GetValue(value.BlockID) == nil {
					field.Values = append(field.Values, value.Clone())
				}
			}
		}
		for _, view := range current.Views {
			if old := historical.GetView(view.ID); old != nil {
				view.ItemIDs = restoreAttributeViewItemOrder(view.ItemIDs, old.ItemIDs, itemIDs)
				for _, group := range view.Groups {
					if oldGroup := old.GetGroupByID(group.ID); oldGroup != nil {
						group.GroupItemIDs = restoreAttributeViewItemOrder(group.GroupItemIDs, oldGroup.GroupItemIDs, itemIDs)
					}
				}
			}
		}
		for _, itemID := range itemIDs {
			if covers := historical.CardCoverPositions[itemID]; covers != nil {
				if current.CardCoverPositions == nil {
					current.CardCoverPositions = map[string]map[string]*av.CardCoverPosition{}
				}
				current.CardCoverPositions[itemID] = covers
			}
		}
		restoredItems[id] = itemIDs
	}
	// 先合并所有主键，再恢复双向关联，允许同一文档内的条目互相关联。
	for id, itemIDs := range restoredItems {
		for _, kv := range after[id].KeyValues {
			relation := kv.Key.Relation
			if relation == nil || !relation.IsTwoWay {
				continue
			}
			for _, value := range kv.Values {
				if !slices.Contains(itemIDs, value.BlockID) || value.Relation == nil || len(value.Relation.BlockIDs) == 0 {
					continue
				}
				dest, err := load(relation.AvID)
				if err != nil {
					return err
				}
				back, err := dest.GetKeyValues(relation.BackKeyID)
				if err != nil || back.Key.Relation == nil || !back.Key.Relation.IsTwoWay ||
					back.Key.Relation.AvID != id || back.Key.Relation.BackKeyID != kv.Key.ID {
					return errors.New("database back relation changed since document deletion")
				}
				for _, targetID := range value.Relation.BlockIDs {
					if dest.GetBlockValue(targetID) == nil {
						return fmt.Errorf("related database entry [%s] is missing", targetID)
					}
					backValue := back.GetValue(targetID)
					if backValue == nil {
						backValue = &av.Value{ID: ast.NewNodeID(), KeyID: back.Key.ID, BlockID: targetID,
							Type: av.KeyTypeRelation, Relation: &av.ValueRelation{}}
						back.Values = append(back.Values, backValue)
					}
					if backValue.Relation == nil {
						return errors.New("database back relation value is invalid")
					}
					if !slices.Contains(backValue.Relation.BlockIDs, value.BlockID) {
						backValue.Relation.BlockIDs = append(backValue.Relation.BlockIDs, value.BlockID)
					}
				}
			}
		}
	}
	if len(restoredItems) == 0 {
		return nil
	}
	for _, view := range after {
		regenAttrViewGroups(view)
	}
	return tx.saveAttributeViewFieldChanges(&attributeViewFieldsSnapshot{boxID: boxID}, before, after)
}
