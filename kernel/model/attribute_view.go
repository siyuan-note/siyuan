// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"bytes"
	"errors"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/88250/go-humanize"
	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/jinzhu/copier"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/search"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/xrash/smetrics"
)

func RemoveUnusedAttributeView(id string) {
	base := filepath.Join(util.DataDir, "storage", "av")
	absPath := filepath.Join(base, id+".json")
	if !filelock.IsExist(absPath) {
		return
	}

	historyDir, err := getHistoryDir(HistoryOpClean)
	if err != nil {
		logging.LogErrorf("get history dir failed: %s", err)
		return
	}

	newP := strings.TrimPrefix(absPath, util.DataDir)
	historyPath := filepath.Join(historyDir, newP)
	if filelock.IsExist(absPath) {
		if err = filelock.Copy(absPath, historyPath); err != nil {
			return
		}
	}

	if err = filelock.RemoveWithoutFatal(absPath); err != nil {
		logging.LogErrorf("remove unused asset [%s] failed: %s", absPath, err)
		util.PushErrMsg(fmt.Sprintf("%s", err), 7000)
		return
	}

	IncSync()

	indexHistoryDir(filepath.Base(historyDir), util.NewLute())
	return
}

func RemoveUnusedAttributeViews() (ret []string) {
	ret = []string{}
	var size int64

	msgId := util.PushMsg(Conf.Language(100), 30*1000)
	defer func() {
		msg := fmt.Sprintf(Conf.Language(280), len(ret), humanize.BytesCustomCeil(uint64(size), 2))
		util.PushUpdateMsg(msgId, msg, 7000)
	}()

	unusedAttributeViews := UnusedAttributeViews(false)

	historyDir, err := getHistoryDir(HistoryOpClean)
	if err != nil {
		logging.LogErrorf("get history dir failed: %s", err)
		return
	}

	for _, unusedAv := range unusedAttributeViews {
		id := unusedAv.Item
		srcPath := filepath.Join(util.DataDir, "storage", "av", id+".json")
		if filelock.IsExist(srcPath) {
			historyPath := filepath.Join(historyDir, "storage", "av", id+".json")
			if err = filelock.Copy(srcPath, historyPath); err != nil {
				return
			}
		}
	}

	for _, unusedAv := range unusedAttributeViews {
		id := unusedAv.Item
		absPath := filepath.Join(util.DataDir, "storage", "av", id+".json")
		if filelock.IsExist(absPath) {
			info, statErr := os.Stat(absPath)
			if statErr == nil {
				size += info.Size()
			}

			if removeErr := filelock.RemoveWithoutFatal(absPath); removeErr != nil {
				logging.LogErrorf("remove unused av [%s] failed: %s", absPath, removeErr)
				util.PushErrMsg(fmt.Sprintf("%s", removeErr), 7000)
				return
			}
		}
		ret = append(ret, absPath)
	}
	if 0 < len(ret) {
		IncSync()
	}

	indexHistoryDir(filepath.Base(historyDir), util.NewLute())
	return
}

func UnusedAttributeViews(sorted bool) (ret []*UnusedItem) {
	defer logging.Recover()
	ret = []*UnusedItem{}

	allAvIDs, err := getAllAvIDs()
	if err != nil {
		return
	}

	docReferencedAvIDs := map[string]bool{}
	luteEngine := util.NewLute()
	boxes := Conf.GetBoxes()
	for _, box := range boxes {
		pages := pagedPaths(filepath.Join(util.DataDir, box.ID), 32)
		for _, paths := range pages {
			var trees []*parse.Tree
			for _, localPath := range paths {
				tree, loadTreeErr := loadTree(localPath, luteEngine)
				if nil != loadTreeErr {
					continue
				}
				trees = append(trees, tree)
			}
			for _, tree := range trees {
				for _, id := range getAvIDs(tree, allAvIDs) {
					docReferencedAvIDs[id] = true
				}
			}
		}
	}

	templateAvIDs := search.FindAllMatchedTargets(filepath.Join(util.DataDir, "templates"), allAvIDs)
	for _, id := range templateAvIDs {
		docReferencedAvIDs[id] = true
	}

	checkedAvIDs := map[string]bool{}
	for _, id := range allAvIDs {
		if !docReferencedAvIDs[id] && !isRelatedSrcAvDocReferenced(id, docReferencedAvIDs, checkedAvIDs) {
			name, _ := av.GetAttributeViewName(id)

			var modTime time.Time
			if sorted {
				p := filepath.Join(util.DataDir, "storage", "av", id+".json")
				if info, statErr := os.Stat(p); nil == statErr {
					modTime = info.ModTime()
				}
			}

			ret = append(ret, &UnusedItem{Item: id, Name: name, ModTime: modTime})
		}
	}

	if sorted {
		sort.Slice(ret, func(i, j int) bool {
			if !ret[i].ModTime.Equal(ret[j].ModTime) {
				return ret[i].ModTime.After(ret[j].ModTime)
			}
			return ret[i].Item > ret[j].Item
		})
	}
	return
}

func isRelatedSrcAvDocReferenced(destAvID string, docReferencedAvIDs, checkedAvIDs map[string]bool) bool {
	if checkedAvIDs[destAvID] {
		if docReferencedAvIDs[destAvID] {
			return true
		}
		return false
	}
	checkedAvIDs[destAvID] = true

	srcAvIDs := av.GetSrcAvIDs(destAvID)
	srcAvIDs = gulu.Str.RemoveElem(srcAvIDs, destAvID) // 忽略自身关联
	if 1 > len(srcAvIDs) {
		return false
	}

	for _, srcAvID := range srcAvIDs {
		if docReferencedAvIDs[srcAvID] {
			return true
		}
	}

	// 递归检查间接关联的 av
	for _, srcAvID := range srcAvIDs {
		if isRelatedSrcAvDocReferenced(srcAvID, docReferencedAvIDs, checkedAvIDs) {
			return true
		}
	}
	return false
}

func getAvIDs(tree *parse.Tree, allAvIDs []string) (ret []string) {
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeAttributeView == n.Type {
			ret = append(ret, n.AttributeViewID)
		}

		for _, kv := range n.KramdownIAL {
			ids := util.GetContainsSubStrs(kv[1], allAvIDs)
			if 0 < len(ids) {
				ret = append(ret, ids...)
			}
		}

		return ast.WalkContinue
	})

	ret = gulu.Str.RemoveDuplicatedElem(ret)
	return
}

func getAllAvIDs() (ret []string, err error) {
	ret = []string{}

	// 只扫全局 AV 目录。加密笔记本的 AV 存在笔记本级目录（密文），不参与全局枚举——
	// 未引用清理功能在加密笔记本锁定时无法确认引用关系（loadTree 失败），枚举加密 AV 有误删风险
	entries, err := os.ReadDir(filepath.Join(util.DataDir, "storage", "av"))
	if nil != err {
		return
	}

	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasSuffix(name, ".json") {
			continue
		}

		id := strings.TrimSuffix(name, ".json")
		if !ast.IsNodeIDPattern(id) {
			continue
		}

		ret = append(ret, id)
	}
	ret = gulu.Str.RemoveDuplicatedElem(ret)
	return
}

func GetAttributeViewItemIDs(avID string, blockIDs []string) (ret map[string]string) {
	ret = map[string]string{}
	for _, blockID := range blockIDs {
		ret[blockID] = ""
	}

	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}

	blockKv := attrView.GetBlockKeyValues()
	for _, b := range blockKv.Values {
		if _, ok := ret[b.Block.ID]; ok {
			ret[b.Block.ID] = b.BlockID
		}
	}
	return
}

func GetAttributeViewBoundBlockIDs(avID string, itemIDs []string) (ret map[string]string) {
	ret = map[string]string{}
	for _, itemID := range itemIDs {
		ret[itemID] = ""
	}

	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}

	blockKv := attrView.GetBlockKeyValues()
	for _, b := range blockKv.Values {
		if _, ok := ret[b.BlockID]; ok {
			ret[b.BlockID] = b.Block.ID
		}
	}
	return
}

func GetAttrViewAddingBlockDefaultValues(avID, viewID, groupID, previousBlockID, addingBlockID string) (ret map[string]*av.Value) {
	ret = map[string]*av.Value{}

	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}

	view, _ := attrView.GetCurrentView(viewID)
	if nil == view {
		logging.LogErrorf("view [%s] not found in attribute view [%s]", viewID, avID)
		return
	}

	if 1 > len(view.Filters) && !view.IsGroupView() {
		// 没有过滤条件也没有分组条件时忽略
		return
	}

	groupView := view
	if "" != groupID {
		groupView = view.GetGroupByID(groupID)
	}
	if nil == groupView {
		logging.LogErrorf("group [%s] not found in view [%s] of attribute view [%s]", groupID, viewID, avID)
		return
	}

	ret = getAttrViewAddingBlockDefaultValues(attrView, view, groupView, previousBlockID, addingBlockID, true)
	for _, value := range ret {
		// 主键都不返回内容，避免闪烁 https://github.com/siyuan-note/siyuan/issues/15561#issuecomment-3184746195
		if av.KeyTypeBlock == value.Type {
			value.Block.Content = ""
		}
	}
	return
}

func getAttrViewAddingBlockDefaultValues(attrView *av.AttributeView, view, groupView *av.View, previousItemID, addingItemID string, isCreate bool) (ret map[string]*av.Value) {
	ret = map[string]*av.Value{}

	if 1 > len(view.Filters) && !view.IsGroupView() {
		// 没有过滤条件也没有分组条件时忽略
		return
	}

	nearItem := getNearItem(attrView, view, groupView, previousItemID)

	// 使用模板或汇总进行过滤或分组时，需要解析涉及到的其他字段
	templateRelevantKeys, rollupRelevantKeys := map[string][]*av.Key{}, map[string]*av.Key{}
	for _, keyValues := range attrView.KeyValues {
		if av.KeyTypeTemplate == keyValues.Key.Type {
			if tplRelevantKeys := sql.GetTemplateKeyRelevantKeys(attrView, keyValues.Key); 0 < len(tplRelevantKeys) {
				for _, k := range tplRelevantKeys {
					templateRelevantKeys[keyValues.Key.ID] = append(templateRelevantKeys[keyValues.Key.ID], k)
				}
			}
		} else if av.KeyTypeRollup == keyValues.Key.Type {
			if nil != keyValues.Key.Rollup {
				relKey, _ := attrView.GetKey(keyValues.Key.Rollup.RelationKeyID)
				if nil != relKey && nil != relKey.Relation {
					if attrView.ID == relKey.Relation.AvID {
						if k, _ := attrView.GetKey(keyValues.Key.Rollup.KeyID); nil != k {
							rollupRelevantKeys[k.ID] = k
						}
					}
				}
			}
		}
	}

	filterKeyIDs := map[string]bool{}
	if applyFilterDefaultValues(view.Filters, attrView, addingItemID, nearItem, templateRelevantKeys, rollupRelevantKeys, ret, filterKeyIDs) {
		// 遇到 mAsset 过滤即结束全部默认值计算（保留原外层 return 语义）
		return
	}

	groupKey := view.GetGroupKey(attrView)
	if nil == groupKey {
		return
	}

	keyValues, _ := attrView.GetKeyValues(groupKey.ID)
	if nil == keyValues {
		return
	}

	newValue := getNewValueByNearItem(nearItem, groupKey, addingItemID)
	if av.KeyTypeSelect == groupKey.Type || av.KeyTypeMSelect == groupKey.Type {
		// 因为单选或多选只能按选项分组，并且可能存在空白分组（找不到临近项），所以单选或多选类型的分组字段使用分组值内容对应的选项
		if opt := groupKey.GetOption(groupView.GetGroupValue()); nil != opt && groupValueDefault != groupView.GetGroupValue() {
			if nil == newValue {
				newValue = ret[groupKey.ID] // 如果没有临近项，则尝试从过滤结果中获取
			}
			if nil == newValue {
				newValue = keyValues.GetValue(addingItemID) // 尝试从已有值中获取
			}

			if nil != newValue {
				if !av.MSelectExistOption(newValue.MSelect, groupView.GetGroupValue()) {
					if 1 > len(newValue.MSelect) || av.KeyTypeMSelect == groupKey.Type {
						newValue.MSelect = append(newValue.MSelect, &av.ValueSelect{Content: opt.Name, Color: opt.Color})
					} else {
						newValue.MSelect = []*av.ValueSelect{{Content: opt.Name, Color: opt.Color}}
					}
				} else {
					var vals []*av.ValueSelect
					if isCreate {
						vals = append(vals, &av.ValueSelect{Content: opt.Name, Color: opt.Color})
					} else {
						existingVal := keyValues.GetValue(addingItemID)
						if nil != existingVal {
							if !av.MSelectExistOption(existingVal.MSelect, opt.Name) {
								existingVal.MSelect = append(existingVal.MSelect, &av.ValueSelect{Content: opt.Name, Color: opt.Color})
							}
							vals = existingVal.MSelect
						} else {
							vals = append(vals, &av.ValueSelect{Content: opt.Name, Color: opt.Color})
						}
					}

					// 添加过滤结果选项的值
					if nil != ret[groupKey.ID] {
						for _, v := range ret[groupKey.ID].MSelect {
							if !av.MSelectExistOption(vals, v.Content) {
								vals = append(vals, v)
							}
						}
					}
					newValue.MSelect = vals
				}
			} else {
				newValue = av.GetAttributeViewDefaultValue(ast.NewNodeID(), groupKey.ID, addingItemID, groupKey.Type, false)
				newValue.MSelect = append(newValue.MSelect, &av.ValueSelect{Content: opt.Name, Color: opt.Color})
			}
		}

		if nil != newValue {
			ret[groupKey.ID] = newValue
		}
		return
	}

	if av.KeyTypeTemplate == keyValues.Key.Type && nil != nearItem {
		if keys := templateRelevantKeys[keyValues.Key.ID]; 0 < len(keys) {
			for _, k := range keys {
				if nil == ret[k.ID] {
					ret[k.ID] = getNewValueByNearItem(nearItem, k, addingItemID)
				}
			}
		}
		return
	}

	if av.KeyTypeRollup == keyValues.Key.Type && nil != nearItem {
		if relKey, ok := rollupRelevantKeys[keyValues.Key.ID]; ok {
			if nil == ret[relKey.ID] {
				ret[relKey.ID] = getNewValueByNearItem(nearItem, relKey, addingItemID)
			}
		}
		return
	}

	if nil != nearItem && filterKeyIDs[groupKey.ID] {
		// 临近项不为空并且分组字段和过滤字段相同时，优先使用临近项 https://github.com/siyuan-note/siyuan/issues/15591
		newValue = getNewValueByNearItem(nearItem, groupKey, addingItemID)
		ret[groupKey.ID] = newValue

		if nil != keyValues.Key.Date && keyValues.Key.Date.AutoFillNow {
			newValue.Date.Content = time.Now().UnixMilli()
			newValue.Date.IsNotEmpty = true
		}
		return
	}

	if nil == nearItem && !filterKeyIDs[groupKey.ID] {
		// 没有临近项并且分组字段和过滤字段不同时，使用分组值
		newValue = av.GetAttributeViewDefaultValue(ast.NewNodeID(), groupKey.ID, addingItemID, groupKey.Type, false)
		if av.KeyTypeText == groupView.GroupVal.Type {
			content := groupView.GroupVal.Text.Content
			if groupValueDefault == content {
				content = ""
			}

			switch newValue.Type {
			case av.KeyTypeBlock:
				newValue.Block.Content = content
			case av.KeyTypeText:
				newValue.Text.Content = content
			case av.KeyTypeNumber:
				num, _ := strconv.ParseFloat(strings.Split(content, " - ")[0], 64)
				newValue.Number.Content = num
				newValue.Number.IsNotEmpty = true
			case av.KeyTypeURL:
				newValue.URL.Content = content
			case av.KeyTypeEmail:
				newValue.Email.Content = content
			case av.KeyTypePhone:
				newValue.Phone.Content = content
			}
		} else if av.KeyTypeCheckbox == groupView.GroupVal.Type {
			newValue.Checkbox.Checked = groupView.GroupVal.Checkbox.Checked
		}

		ret[groupKey.ID] = newValue
		return
	}

	if nil != newValue && !filterKeyIDs[groupKey.ID] {
		ret[groupKey.ID] = newValue

		if nil != keyValues.Key.Date && keyValues.Key.Date.AutoFillNow {
			newValue.Date.Content = time.Now().UnixMilli()
			newValue.Date.IsNotEmpty = true
		}
	}
	return
}

// applyFilterDefaultValues 递归遍历过滤节点树，对叶子节点计算新增行的默认值。
// 分组节点只负责向下递归；叶子节点保留原扁平时代的默认值计算逻辑。
// 返回 true 表示遇到 mAsset 过滤，调用方应立即结束全部默认值计算（保留原外层 return 语义）。
func applyFilterDefaultValues(filters []*av.ViewFilter, attrView *av.AttributeView, addingItemID string, nearItem av.Item,
	templateRelevantKeys map[string][]*av.Key, rollupRelevantKeys map[string]*av.Key,
	ret map[string]*av.Value, filterKeyIDs map[string]bool) (stop bool) {
	for _, filter := range filters {
		if nil == filter {
			continue
		}
		if filter.IsGroup() {
			if applyFilterDefaultValues(filter.Filters, attrView, addingItemID, nearItem, templateRelevantKeys, rollupRelevantKeys, ret, filterKeyIDs) {
				return true
			}
			continue
		}

		filterKeyIDs[filter.Column] = true
		keyValues, _ := attrView.GetKeyValues(filter.Column)
		if nil == keyValues {
			continue
		}

		if av.KeyTypeTemplate == keyValues.Key.Type && nil != nearItem {
			if keys := templateRelevantKeys[keyValues.Key.ID]; 0 < len(keys) {
				for _, k := range keys {
					if nil == ret[k.ID] {
						ret[k.ID] = getNewValueByNearItem(nearItem, k, addingItemID)
					}
				}
			}
			continue
		}

		if av.KeyTypeRollup == keyValues.Key.Type && nil != nearItem {
			if relKey, ok := rollupRelevantKeys[keyValues.Key.ID]; ok {
				if nil == ret[relKey.ID] {
					ret[relKey.ID] = getNewValueByNearItem(nearItem, relKey, addingItemID)
				}
			}
			continue
		}

		if av.KeyTypeMAsset == keyValues.Key.Type {
			if nil != nearItem {
				if _, ok := ret[keyValues.Key.ID]; !ok {
					ret[keyValues.Key.ID] = getNewValueByNearItem(nearItem, keyValues.Key, addingItemID)
				}
			}
			return true // 保留原语义：遇到 mAsset 过滤即结束默认值计算
		}

		newValue := filter.GetAffectValue(keyValues.Key, addingItemID)
		if nil == newValue {
			if filter.IsValid() {
				newValue = getNewValueByNearItem(nearItem, keyValues.Key, addingItemID)
			}
		}
		if nil != newValue {
			if av.KeyTypeDate == keyValues.Key.Type {
				if nil != nearItem {
					nearValue := getNewValueByNearItem(nearItem, keyValues.Key, addingItemID)
					newValue.Date.IsNotTime = nearValue.Date.IsNotTime
				}

				if nil != keyValues.Key.Date && keyValues.Key.Date.AutoFillNow {
					newValue.Date.Content = time.Now().UnixMilli()
					newValue.Date.IsNotEmpty = true
				}
			}

			ret[keyValues.Key.ID] = newValue
		}
	}
	return false
}

func (tx *Transaction) doSortAttrViewGroup(operation *Operation) (ret *TxErr) {
	if err := sortAttributeViewGroup(operation.AvID, operation.BlockID, operation.PreviousID, operation.ID); nil != err {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func sortAttributeViewGroup(avID, blockID, previousGroupID, groupID string) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, blockID)
	if err != nil {
		return err
	}

	sortGroupViews(attrView, view)

	var groupView *av.View
	var index, previousIndex int
	for i, g := range view.Groups {
		if g.ID == groupID {
			groupView = g
			index = i
			break
		}
	}
	if nil == groupView {
		return
	}
	view.Group.Order = av.GroupOrderMan

	view.Groups = append(view.Groups[:index], view.Groups[index+1:]...)
	for i, g := range view.Groups {
		if g.ID == previousGroupID {
			previousIndex = i + 1
			break
		}
	}
	view.Groups = util.InsertElem(view.Groups, previousIndex, groupView)

	for i, g := range view.Groups {
		g.GroupSort = i
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doRemoveAttrViewGroup(operation *Operation) (ret *TxErr) {
	if err := removeAttributeViewGroup(operation.AvID, operation.BlockID); nil != err {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func removeAttributeViewGroup(avID, blockID string) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		return err
	}

	view, err := getAttrViewViewByBlockID(attrView, blockID)
	if err != nil {
		return err
	}

	removeAttributeViewGroup0(view)
	err = av.SaveAttributeView(attrView)
	if err != nil {
		logging.LogErrorf("save attribute view [%s] failed: %s", avID, err)
		return err
	}
	return nil
}

func removeAttributeViewGroup0(view *av.View) {
	view.Group, view.Groups, view.GroupCreated = nil, nil, 0
}

func (tx *Transaction) doSyncAttrViewTableColWidth(operation *Operation) (ret *TxErr) {
	err := syncAttrViewTableColWidth(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func syncAttrViewTableColWidth(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	view := attrView.GetView(operation.ID)
	if nil == view {
		err = av.ErrViewNotFound
		logging.LogErrorf("view [%s] not found in attribute view [%s]", operation.ID, operation.AvID)
		return
	}

	var width string
	switch view.LayoutType {
	case av.LayoutTypeTable:
		for _, column := range view.Table.Columns {
			if column.ID == operation.KeyID {
				width = column.Width
				break
			}
		}
	case av.LayoutTypeGallery, av.LayoutTypeKanban:
		return
	}

	for _, v := range attrView.Views {
		if av.LayoutTypeTable == v.LayoutType {
			for _, column := range v.Table.Columns {
				if column.ID == operation.KeyID {
					column.Width = width
					break
				}
			}
		}
	}

	err = av.SaveAttributeView(attrView)
	ReloadAttrView(attrView.ID)
	return
}

func (tx *Transaction) doHideAttrViewGroup(operation *Operation) (ret *TxErr) {
	if err := hideAttributeViewGroup(operation.AvID, operation.BlockID, operation.ID, int(operation.Data.(float64))); nil != err {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func hideAttributeViewGroup(avID, blockID, groupID string, hidden int) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, blockID)
	if err != nil {
		return
	}

	for _, group := range view.Groups {
		if group.ID == groupID {
			group.GroupHidden = hidden
			break
		}
	}

	err = av.SaveAttributeView(attrView)
	if err != nil {
		logging.LogErrorf("save attribute view [%s] failed: %s", avID, err)
		return
	}
	return
}

func (tx *Transaction) doHideAttrViewAllGroups(operation *Operation) (ret *TxErr) {
	if err := hideAttributeViewAllGroups(operation.AvID, operation.BlockID, operation.Data.(bool)); nil != err {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func hideAttributeViewAllGroups(avID, blockID string, hidden bool) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, blockID)
	if err != nil {
		return
	}

	for _, group := range view.Groups {
		if hidden {
			group.GroupHidden = 2
		} else {
			group.GroupHidden = 0
		}
	}

	err = av.SaveAttributeView(attrView)
	if err != nil {
		logging.LogErrorf("save attribute view [%s] failed: %s", avID, err)
		return
	}
	return
}

func (tx *Transaction) doFoldAttrViewGroup(operation *Operation) (ret *TxErr) {
	if err := foldAttrViewGroup(operation.AvID, operation.BlockID, operation.ID, operation.Data.(bool)); nil != err {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func foldAttrViewGroup(avID, blockID, groupID string, folded bool) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		return err
	}

	view, err := getAttrViewViewByBlockID(attrView, blockID)
	if err != nil {
		return err
	}

	if !view.IsGroupView() {
		return
	}

	for _, group := range view.Groups {
		if group.ID == groupID {
			group.GroupFolded = folded
			break
		}
	}

	err = av.SaveAttributeView(attrView)
	if err != nil {
		logging.LogErrorf("save attribute view [%s] failed: %s", avID, err)
		return err
	}
	return nil
}

func (tx *Transaction) doSetAttrViewGroup(operation *Operation) (ret *TxErr) {
	data, err := gulu.JSON.MarshalJSON(operation.Data)
	if nil != err {
		logging.LogErrorf("marshal operation data failed: %s", err)
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}

	group := &av.ViewGroup{}
	if err = gulu.JSON.UnmarshalJSON(data, &group); nil != err {
		logging.LogErrorf("unmarshal operation data failed: %s", err)
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}

	if err = SetAttributeViewGroup(operation.AvID, operation.BlockID, group); nil != err {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func SetAttributeViewGroup(avID, blockID string, group *av.ViewGroup) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		return err
	}

	view, err := getAttrViewViewByBlockID(attrView, blockID)
	if err != nil {
		return err
	}

	setAttributeViewGroup(attrView, view, group)

	err = av.SaveAttributeView(attrView)
	ReloadAttrView(avID)
	return
}

func setAttributeViewGroup(attrView *av.AttributeView, view *av.View, group *av.ViewGroup) {
	var oldHideEmpty, firstInit, changeGroupField bool
	if nil != view.Group {
		oldHideEmpty = view.Group.HideEmpty
		changeGroupField = group.Field != view.Group.Field
	} else {
		firstInit = true
	}

	groupStates := getAttrViewGroupStates(view)
	view.Group = group
	regenAttrViewGroups(attrView)
	setAttrViewGroupStates(view, groupStates)

	if view.Group.HideEmpty != oldHideEmpty {
		if !oldHideEmpty && view.Group.HideEmpty { // 启用隐藏空分组
			for _, g := range view.Groups {
				groupViewable := sql.RenderGroupView(attrView, view, g, "")
				// 必须经过渲染才能得到最终的条目数
				renderViewableInstance(groupViewable, view, attrView, 1, -1, false, "")
				if g.GroupHidden == 0 && 1 > groupViewable.(av.Collection).CountItems() {
					g.GroupHidden = 1
				}
			}
		}
		if oldHideEmpty && !view.Group.HideEmpty { // 禁用隐藏空分组
			for _, g := range view.Groups {
				groupViewable := sql.RenderGroupView(attrView, view, g, "")
				renderViewableInstance(groupViewable, view, attrView, 1, -1, false, "")
				if g.GroupHidden == 1 && 1 > groupViewable.(av.Collection).CountItems() {
					g.GroupHidden = 0
				}
			}
		}
	}

	if firstInit || changeGroupField { // 首次设置分组时
		if groupKey := view.GetGroupKey(attrView); nil != groupKey {
			if av.KeyTypeSelect == groupKey.Type || av.KeyTypeMSelect == groupKey.Type {
				// 如果分组字段是单选或多选，则将分组排序方式改为按选项排序 https://github.com/siyuan-note/siyuan/issues/15534
				view.Group.Order = av.GroupOrderSelectOption
				sortGroupsBySelectOption(view, groupKey)
			} else if av.KeyTypeCheckbox == groupKey.Type {
				// 如果分组字段是复选框，则将分组排序改为手动排序，并且已勾选在前面
				view.Group.Order = av.GroupOrderMan
				checked := view.GetGroupByGroupValue(av.CheckboxCheckedStr)
				unchecked := view.GetGroupByGroupValue("")
				view.Groups = nil
				view.Groups = append(view.Groups, checked, unchecked)
			}

		}

		for i, g := range view.Groups {
			g.GroupSort = i
		}
	}
}

func (tx *Transaction) doSetAttrViewCardAspectRatio(operation *Operation) (ret *TxErr) {
	err := setAttrViewCardAspectRatio(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttrViewCardAspectRatio(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if err != nil {
		return
	}

	switch view.LayoutType {
	case av.LayoutTypeTable:
		return
	case av.LayoutTypeGallery:
		view.Gallery.CardAspectRatio = av.CardAspectRatio(operation.Data.(float64))
	case av.LayoutTypeKanban:
		view.Kanban.CardAspectRatio = av.CardAspectRatio(operation.Data.(float64))
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewBlockView(operation *Operation) (ret *TxErr) {
	err := SetDatabaseBlockView(operation.BlockID, operation.AvID, operation.ID)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func (tx *Transaction) doChangeAttrViewLayout(operation *Operation) (ret *TxErr) {
	err := ChangeAttrViewLayout(operation.BlockID, operation.AvID, operation.Layout)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func ChangeAttrViewLayout(blockID, avID string, newLayout av.LayoutType) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, blockID)
	if err != nil {
		return
	}

	if newLayout == view.LayoutType {
		return
	}

	oldLayout := view.LayoutType
	view.LayoutType = newLayout

	switch newLayout {
	case av.LayoutTypeTable:
		if view.Name == av.GetAttributeViewI18n("gallery") || view.Name == av.GetAttributeViewI18n("kanban") {
			view.Name = av.GetAttributeViewI18n("table")
		}

		if nil != view.Table {
			break
		}

		view.Table = av.NewLayoutTable()
		switch oldLayout {
		case av.LayoutTypeGallery:
			for _, field := range view.Gallery.CardFields {
				view.Table.Columns = append(view.Table.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: field.ID}})
			}
		case av.LayoutTypeKanban:
			for _, field := range view.Kanban.Fields {
				view.Table.Columns = append(view.Table.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: field.ID}})
			}
		}
	case av.LayoutTypeGallery:
		if view.Name == av.GetAttributeViewI18n("table") || view.Name == av.GetAttributeViewI18n("kanban") {
			view.Name = av.GetAttributeViewI18n("gallery")
		}

		if nil != view.Gallery {
			break
		}

		view.Gallery = av.NewLayoutGallery()
		switch oldLayout {
		case av.LayoutTypeTable:
			for _, col := range view.Table.Columns {
				view.Gallery.CardFields = append(view.Gallery.CardFields, &av.ViewGalleryCardField{BaseField: &av.BaseField{ID: col.ID}})
			}
		case av.LayoutTypeKanban:
			for _, field := range view.Kanban.Fields {
				view.Gallery.CardFields = append(view.Gallery.CardFields, &av.ViewGalleryCardField{BaseField: &av.BaseField{ID: field.ID}})
			}
		}
	case av.LayoutTypeKanban:
		if view.Name == av.GetAttributeViewI18n("table") || view.Name == av.GetAttributeViewI18n("gallery") {
			view.Name = av.GetAttributeViewI18n("kanban")
		}

		if nil != view.Kanban {
			break
		}

		view.Kanban = av.NewLayoutKanban()
		switch oldLayout {
		case av.LayoutTypeTable:
			for _, col := range view.Table.Columns {
				view.Kanban.Fields = append(view.Kanban.Fields, &av.ViewKanbanField{BaseField: &av.BaseField{ID: col.ID}})
			}
		case av.LayoutTypeGallery:
			for _, field := range view.Gallery.CardFields {
				view.Kanban.Fields = append(view.Kanban.Fields, &av.ViewKanbanField{BaseField: &av.BaseField{ID: field.ID}})
			}
		}

		if !view.IsGroupView() {
			preferredGroupKey := getKanbanPreferredGroupKey(attrView)
			group := &av.ViewGroup{Field: preferredGroupKey.ID}
			setAttributeViewGroup(attrView, view, group)
		}
	}

	blockIDs := treenode.GetMirrorAttrViewBlockIDs(avID)
	for _, bID := range blockIDs {
		node, tree, _ := getNodeByBlockID(nil, bID)
		if nil == node || nil == tree {
			logging.LogErrorf("get node by block ID [%s] failed", bID)
			continue
		}

		changed := false
		attrs := parse.IAL2Map(node.KramdownIAL)
		if blockID == bID { // 当前操作的镜像库
			attrs[av.NodeAttrView] = view.ID
			node.AttributeViewType = string(view.LayoutType)
			attrView.ViewID = view.ID
			changed = true
		} else {
			if view.ID == attrs[av.NodeAttrView] {
				// 仅更新和当前操作的镜像库指定的视图相同的镜像库
				node.AttributeViewType = string(view.LayoutType)
				changed = true
			}
		}

		if changed {
			err = setNodeAttrs(node, tree, attrs)
			if err != nil {
				logging.LogWarnf("set node [%s] attrs failed: %s", bID, err)
				return
			}
		}
	}

	regenAttrViewGroups(attrView)

	if err = av.SaveAttributeView(attrView); nil != err {
		logging.LogErrorf("save attribute view [%s] failed: %s", avID, err)
		return
	}

	ReloadAttrView(avID)
	return
}

func (tx *Transaction) doSetAttrViewWrapField(operation *Operation) (ret *TxErr) {
	err := setAttrViewWrapField(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttrViewWrapField(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if err != nil {
		return
	}

	allFieldWrap := operation.Data.(bool)
	switch view.LayoutType {
	case av.LayoutTypeTable:
		view.Table.WrapField = allFieldWrap
		for _, col := range view.Table.Columns {
			col.Wrap = allFieldWrap
		}
	case av.LayoutTypeGallery:
		view.Gallery.WrapField = allFieldWrap
		for _, field := range view.Gallery.CardFields {
			field.Wrap = allFieldWrap
		}
	case av.LayoutTypeKanban:
		view.Kanban.WrapField = allFieldWrap
		for _, field := range view.Kanban.Fields {
			field.Wrap = allFieldWrap
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewShowIcon(operation *Operation) (ret *TxErr) {
	err := setAttrViewShowIcon(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttrViewShowIcon(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if err != nil {
		return
	}

	switch view.LayoutType {
	case av.LayoutTypeTable:
		view.Table.ShowIcon = operation.Data.(bool)
	case av.LayoutTypeGallery:
		view.Gallery.ShowIcon = operation.Data.(bool)
	case av.LayoutTypeKanban:
		view.Kanban.ShowIcon = operation.Data.(bool)
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewFitImage(operation *Operation) (ret *TxErr) {
	err := setAttrViewFitImage(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttrViewFitImage(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if err != nil {
		return
	}

	switch view.LayoutType {
	case av.LayoutTypeTable:
		return
	case av.LayoutTypeGallery:
		view.Gallery.FitImage = operation.Data.(bool)
	case av.LayoutTypeKanban:
		view.Kanban.FitImage = operation.Data.(bool)
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewDisplayFieldName(operation *Operation) (ret *TxErr) {
	err := setAttrViewDisplayFieldName(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func (tx *Transaction) doSetAttrViewFillColBackgroundColor(operation *Operation) (ret *TxErr) {
	err := setAttrViewFillColBackgroundColor(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttrViewDisplayFieldName(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if err != nil {
		return
	}

	switch view.LayoutType {
	case av.LayoutTypeTable:
		return
	case av.LayoutTypeGallery:
		view.Gallery.DisplayFieldName = operation.Data.(bool)
	case av.LayoutTypeKanban:
		view.Kanban.DisplayFieldName = operation.Data.(bool)
	}

	err = av.SaveAttributeView(attrView)
	return
}

func setAttrViewFillColBackgroundColor(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if err != nil {
		return
	}

	switch view.LayoutType {
	case av.LayoutTypeTable:
		return
	case av.LayoutTypeGallery:
		return
	case av.LayoutTypeKanban:
		view.Kanban.FillColBackgroundColor = operation.Data.(bool)
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewCardSize(operation *Operation) (ret *TxErr) {
	err := setAttrViewCardSize(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttrViewCardSize(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if err != nil {
		return
	}

	switch view.LayoutType {
	case av.LayoutTypeTable:
		return
	case av.LayoutTypeGallery:
		view.Gallery.CardSize = av.CardSize(operation.Data.(float64))
	case av.LayoutTypeKanban:
		view.Kanban.CardSize = av.CardSize(operation.Data.(float64))
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewCoverFromAssetKeyID(operation *Operation) (ret *TxErr) {
	err := setAttrViewCoverFromAssetKeyID(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttrViewCoverFromAssetKeyID(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if err != nil {
		return
	}

	switch view.LayoutType {
	case av.LayoutTypeTable:
		return
	case av.LayoutTypeGallery:
		view.Gallery.CoverFromAssetKeyID = operation.KeyID
	case av.LayoutTypeKanban:
		view.Kanban.CoverFromAssetKeyID = operation.KeyID
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewCoverFrom(operation *Operation) (ret *TxErr) {
	err := setAttrViewCoverFrom(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttrViewCoverFrom(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if err != nil {
		return
	}

	switch view.LayoutType {
	case av.LayoutTypeTable:
		return
	case av.LayoutTypeGallery:
		view.Gallery.CoverFrom = av.CoverFrom(operation.Data.(float64))
	case av.LayoutTypeKanban:
		view.Kanban.CoverFrom = av.CoverFrom(operation.Data.(float64))
	}

	err = av.SaveAttributeView(attrView)
	return
}

func AppendAttributeViewDetachedBlocksWithValues(avID string, blocksValues [][]*av.Value) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}

	now := util.CurrentTimeMillis()
	var blockIDs []string
	for _, blockValues := range blocksValues {
		blockID := ast.NewNodeID()
		if v := blockValues[0]; "" != v.BlockID {
			blockID = v.BlockID
		}
		blockIDs = append(blockIDs, blockID)
		for _, v := range blockValues {
			keyValues, _ := attrView.GetKeyValues(v.KeyID)
			if nil == keyValues {
				err = fmt.Errorf("key [%s] not found", v.KeyID)
				return
			}

			v.ID = ast.NewNodeID()
			v.BlockID = blockID
			v.Type = keyValues.Key.Type
			if av.KeyTypeBlock == v.Type {
				v.Block.Created = now
				v.Block.Updated = now
				v.Block.ID = ""
			}
			v.IsDetached = true
			v.CreatedAt = now
			v.UpdatedAt = now
			v.IsRenderAutoFill = false
			keyValues.Values = append(keyValues.Values, v)

			if av.KeyTypeSelect == v.Type || av.KeyTypeMSelect == v.Type {
				// 保存选项 https://github.com/siyuan-note/siyuan/issues/12475
				key, _ := attrView.GetKey(v.KeyID)
				if nil != key && 0 < len(v.MSelect) {
					for _, valOpt := range v.MSelect {
						if opt := key.GetOption(valOpt.Content); nil == opt {
							// 不存在的选项新建保存
							opt = &av.SelectOption{Name: valOpt.Content, Color: valOpt.Color}
							key.Options = append(key.Options, opt)
						} else {
							// 已经存在的选项颜色需要保持不变
							valOpt.Color = opt.Color
						}
					}
				}
			}
		}
	}

	for _, v := range attrView.Views {
		for _, addingBlockID := range blockIDs {
			v.ItemIDs = append(v.ItemIDs, addingBlockID)
		}
	}

	regenAttrViewGroups(attrView)
	if err = av.SaveAttributeView(attrView); err != nil {
		logging.LogErrorf("save attribute view [%s] failed: %s", avID, err)
		return
	}

	ReloadAttrView(avID)
	return
}

// DuplicateAttributeViewRow 创建源行的纯文本副本，复制除主键、Rollup、Created、Updated 外的所有字段值，
// 双向关联同步更新目标属性视图的反向关联列。新行 ID 由调用方（前端）生成并通过 newRowID 传入，
// 副本插入到 previousItemID（通常为最后选中的条目）之后。
func DuplicateAttributeViewRow(tx *Transaction, avID, previousItemID, srcRowID, newRowID string) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}

	blockKeyValues := attrView.GetBlockKeyValues()
	if nil == blockKeyValues {
		err = fmt.Errorf("attribute view [%s] has no block key", avID)
		return
	}

	srcBlockVal := blockKeyValues.GetValue(srcRowID)
	if nil == srcBlockVal {
		err = fmt.Errorf("source row [%s] not found in attribute view [%s]", srcRowID, avID)
		return
	}

	if "" == newRowID {
		newRowID = ast.NewNodeID()
	}

	now := util.CurrentTimeMillis()

	// 创建副本的主键值，强制为纯文本（非绑定块）
	blockContent := ""
	if nil != srcBlockVal.Block {
		blockContent = srcBlockVal.Block.Content
	}
	newBlockVal := &av.Value{
		ID:         ast.NewNodeID(),
		KeyID:      blockKeyValues.Key.ID,
		BlockID:    newRowID,
		Type:       av.KeyTypeBlock,
		IsDetached: true,
		CreatedAt:  now,
		UpdatedAt:  now,
		Block:      &av.ValueBlock{Content: blockContent, Created: now, Updated: now},
	}
	blockKeyValues.Values = append(blockKeyValues.Values, newBlockVal)

	// 收集双向关联字段，循环结束后统一处理，避免跨属性视图重复 parse/save
	type pendingTwoWay struct {
		key *av.Key
		val *av.Value
	}
	var pendingTwoWays []*pendingTwoWay

	for _, keyValues := range attrView.KeyValues {
		if av.KeyTypeBlock == keyValues.Key.Type {
			continue // 主键已处理
		}
		if av.KeyTypeRollup == keyValues.Key.Type || av.KeyTypeCreated == keyValues.Key.Type || av.KeyTypeUpdated == keyValues.Key.Type {
			continue // 汇总/创建时间/更新时间字段在渲染或自动生成时处理，不复制
		}

		srcVal := keyValues.GetValue(srcRowID)
		if nil == srcVal {
			continue // 源行该字段无值，跳过
		}

		newVal := srcVal.Clone()
		if nil == newVal {
			continue
		}
		newVal.ID = ast.NewNodeID()
		newVal.BlockID = newRowID
		newVal.IsDetached = false
		newVal.CreatedAt = now
		newVal.UpdatedAt = now
		newVal.IsRenderAutoFill = false
		if nil != newVal.Relation {
			newVal.Relation.Contents = nil // 清除渲染期数据
		}

		// 单选/多选选项同步，保证目标属性视图存在对应选项 https://github.com/siyuan-note/siyuan/issues/12475
		if av.KeyTypeSelect == newVal.Type || av.KeyTypeMSelect == newVal.Type {
			if 0 < len(newVal.MSelect) {
				for _, valOpt := range newVal.MSelect {
					if opt := keyValues.Key.GetOption(valOpt.Content); nil == opt {
						opt = &av.SelectOption{Name: valOpt.Content, Color: valOpt.Color}
						keyValues.Key.Options = append(keyValues.Key.Options, opt)
					} else {
						valOpt.Color = opt.Color
					}
				}
			}
		}

		keyValues.Values = append(keyValues.Values, newVal)

		// 双向关联值收集，稍后统一更新目标属性视图的反向列
		if av.KeyTypeRelation == newVal.Type && nil != keyValues.Key.Relation && keyValues.Key.Relation.IsTwoWay && 0 < len(newVal.Relation.BlockIDs) {
			pendingTwoWays = append(pendingTwoWays, &pendingTwoWay{key: keyValues.Key, val: newVal})
		}
	}

	// 在所有视图上添加新行，插入位置为 previousItemID 之后
	for _, v := range attrView.Views {
		addRowToViewItems(v, newRowID, previousItemID)
	}

	// 统一处理双向关联：按目标属性视图聚合，每个目标只 parse/save 一次
	twoWayByDestAv := map[string][]*pendingTwoWay{}
	for _, p := range pendingTwoWays {
		destAvID := p.key.Relation.AvID
		twoWayByDestAv[destAvID] = append(twoWayByDestAv[destAvID], p)
	}
	for destAvID, items := range twoWayByDestAv {
		if destAvID == attrView.ID {
			// 自关联，直接在内存对象上更新，随主属性视图一起保存
			for _, p := range items {
				updateTwoWayRelationDestAttrView(attrView, p.key, p.val, 1, nil)
			}
			continue
		}

		destAv, parseErr := av.ParseAttributeView(destAvID)
		if nil != parseErr || nil == destAv {
			logging.LogWarnf("parse dest attribute view [%s] failed: %s", destAvID, parseErr)
			continue
		}
		for _, p := range items {
			// 复用反向更新逻辑，传入 mode=1（增加）、oldBlockIDs 为空
			updateTwoWayRelationDestAttrView(destAv, p.key, p.val, 1, nil)
		}
		regenAttrViewGroups(destAv)
		if saveErr := av.SaveAttributeView(destAv); nil != saveErr {
			logging.LogErrorf("save dest attribute view [%s] failed: %s", destAvID, saveErr)
		}
		if nil != tx {
			tx.relatedAvIDs = append(tx.relatedAvIDs, destAvID)
		}
		ReloadAttrView(destAvID)
	}

	regenAttrViewGroups(attrView)
	if err = av.SaveAttributeView(attrView); err != nil {
		logging.LogErrorf("save attribute view [%s] failed: %s", avID, err)
		return
	}
	return
}

// addRowToViewItems 将 newRowID 插入到视图及其所有分组的项目列表中，位置在 previousItemID 之后；
// 若 previousItemID 为空或未找到，则追加到末尾。
func addRowToViewItems(view *av.View, newRowID, previousItemID string) {
	view.ItemIDs = insertItemAfter(view.ItemIDs, newRowID, previousItemID)
	for _, g := range view.Groups {
		g.GroupItemIDs = insertItemAfter(g.GroupItemIDs, newRowID, previousItemID)
	}
}

// insertItemAfter 将 item 插入到 items 中 previousItemID 之后；若 previousItemID 为空或未找到，则追加到末尾。
func insertItemAfter(items []string, item, previousItemID string) []string {
	if "" != previousItemID {
		for i, id := range items {
			if id == previousItemID {
				items = append(items[:i+1], append([]string{item}, items[i+1:]...)...)
				return items
			}
		}
	}
	return append(items, item)
}

func DuplicateDatabaseBlock(avID string) (newAvID, newBlockID string, err error) {
	// 加密笔记本的 AV 定义在笔记本级目录，通过 fallback 查找实际路径
	oldAvPath, avBoxID := av.FindAttributeViewPath(avID)
	if oldAvPath == "" {
		oldAvPath = av.GetAttributeViewDataPath(avID)
	}
	newAvID, newBlockID = ast.NewNodeID(), ast.NewNodeID()

	oldAv, err := av.ParseAttributeView(avID)
	if err != nil {
		return
	}

	data, err := filelock.ReadFile(oldAvPath)
	if err != nil {
		logging.LogErrorf("read attribute view [%s] failed: %s", avID, err)
		return
	}

	// 加密笔记本的 AV 是密文，需先解密再处理（av.DecryptAVData 内部按 box 加密/已解锁路由）
	if avBoxID != "" && IsEncryptedBox(avBoxID) {
		var decErr error
		data, decErr = av.DecryptAVData(avBoxID, avID, data)
		if decErr != nil {
			logging.LogErrorf("decrypt attribute view [%s] failed: %s", avID, decErr)
			err = decErr
			return
		}
	}

	data = bytes.ReplaceAll(data, []byte(avID), []byte(newAvID))
	av.UpsertBlockRel(newAvID, newBlockID)

	newAv := &av.AttributeView{}
	if err = gulu.JSON.UnmarshalJSON(data, newAv); err != nil {
		logging.LogErrorf("unmarshal attribute view [%s] failed: %s", newAvID, err)
		return
	}

	if "" != newAv.Name {
		newAv.Name = oldAv.Name + " (Duplicated " + time.Now().Format("2006-01-02 15:04:05") + ")"
	}

	for _, keyValues := range newAv.KeyValues {
		if nil != keyValues.Key.Relation && keyValues.Key.Relation.IsTwoWay {
			// 断开双向关联
			keyValues.Key.Relation.IsTwoWay = false
			keyValues.Key.Relation.BackKeyID = ""
		}
	}

	data, err = gulu.JSON.MarshalJSON(newAv)
	if err != nil {
		logging.LogErrorf("marshal attribute view [%s] failed: %s", newAvID, err)
		return
	}

	// 加密笔记本的新 AV 定义也存笔记本级目录，且需 avKey 加密
	newAvPath := filepath.Join(util.DataDir, "storage", "av", newAvID+".json")
	if avBoxID != "" {
		newAvPath = filepath.Join(util.DataDir, avBoxID, "storage", "av", newAvID+".json")
		var encErr error
		data, encErr = av.EncryptAVData(avBoxID, newAvID, data)
		if encErr != nil {
			logging.LogErrorf("encrypt attribute view [%s] failed: %s", newAvID, encErr)
			err = encErr
			return
		}
		av.SetAVBoxID(newAvID, avBoxID)
	}
	if err = filelock.WriteFile(newAvPath, data); err != nil {
		logging.LogErrorf("write attribute view [%s] failed: %s", newAvID, err)
		return
	}

	updateBoundBlockAvsAttribute([]string{newAvID})
	return
}

func GetAttributeViewKeysByID(avID string, keyIDs ...string) (ret []*av.Key) {
	ret = []*av.Key{}

	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}

	if 1 > len(keyIDs) {
		for _, keyValues := range attrView.KeyValues {
			key := keyValues.Key
			ret = append(ret, key)
		}
		return
	}

	for _, keyValues := range attrView.KeyValues {
		key := keyValues.Key
		for _, keyID := range keyIDs {
			if key.ID == keyID {
				ret = append(ret, key)
			}
		}
	}
	return ret
}

func SetDatabaseBlockView(blockID, avID, viewID string) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}
	if attrView.ViewID != viewID {
		attrView.ViewID = viewID
		if err = av.SaveAttributeView(attrView); err != nil {
			return
		}
	}

	view := attrView.GetView(viewID)
	if nil == view {
		err = av.ErrViewNotFound
		logging.LogErrorf("view [%s] not found in attribute view [%s]", viewID, avID)
		return
	}

	node, tree, err := getNodeByBlockID(nil, blockID)
	if err != nil {
		return
	}

	node.AttributeViewType = string(view.LayoutType)
	attrs := parse.IAL2Map(node.KramdownIAL)
	attrs[av.NodeAttrView] = viewID
	err = setNodeAttrs(node, tree, attrs)
	if err != nil {
		logging.LogWarnf("set node [%s] attrs failed: %s", blockID, err)
		return
	}
	return
}

func GetAttributeViewPrimaryKeyValues(avID, keyword string, page, pageSize int) (attributeViewName string, databaseBlockIDs []string, keyValues *av.KeyValues, err error) {
	waitForSyncingStorages()

	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}
	attributeViewName = getAttrViewName(attrView)

	databaseBlockIDs = treenode.GetMirrorAttrViewBlockIDs(avID)

	keyValues = attrView.GetBlockKeyValues()
	var values []*av.Value
	for _, kv := range keyValues.Values {
		if !kv.IsDetached && !treenode.ExistBlockTree(kv.Block.ID) {
			continue
		}

		if strings.Contains(strings.ToLower(kv.String(true)), strings.ToLower(keyword)) {
			values = append(values, kv)
		}
	}
	keyValues.Values = values

	sort.Slice(keyValues.Values, func(i, j int) bool {
		return keyValues.Values[i].Block.Updated > keyValues.Values[j].Block.Updated
	})

	if 1 > pageSize {
		pageSize = 16
	}
	start := (page - 1) * pageSize
	end := min(len(keyValues.Values), start+pageSize)
	keyValues.Values = keyValues.Values[start:end]
	return
}

func GetAttributeViewFilterSort(avID, blockID string) (filters []*av.ViewFilter, sorts []*av.ViewSort) {
	waitForSyncingStorages()

	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, blockID)
	if nil == view {
		view, err = attrView.GetCurrentView(attrView.ViewID)
		if nil == view || err != nil {
			logging.LogErrorf("get current view failed: %s", err)
			return
		}
	}

	filters = view.Filters
	sorts = view.Sorts
	if 1 > len(filters) {
		filters = []*av.ViewFilter{}
	}
	if 1 > len(sorts) {
		sorts = []*av.ViewSort{}
	}
	return
}

func SearchAttributeViewRollupDestKeys(avID, keyword string) (ret []*av.Key) {
	waitForSyncingStorages()

	ret = []*av.Key{}
	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}

	for _, keyValues := range attrView.KeyValues {
		if av.KeyTypeRollup != keyValues.Key.Type && av.KeyTypeLineNumber != keyValues.Key.Type {
			if strings.Contains(strings.ToLower(keyValues.Key.Name), strings.ToLower(keyword)) {
				ret = append(ret, keyValues.Key)
			}
		}
	}
	return
}

func SearchAttributeViewRelationKey(avID, keyword string) (ret []*av.Key) {
	waitForSyncingStorages()

	ret = []*av.Key{}
	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}

	for _, keyValues := range attrView.KeyValues {
		if av.KeyTypeRelation == keyValues.Key.Type && nil != keyValues.Key.Relation {
			if strings.Contains(strings.ToLower(keyValues.Key.Name), strings.ToLower(keyword)) {
				ret = append(ret, keyValues.Key)
			}
		}
	}
	return
}

func GetAttributeView(avID string) (ret *av.AttributeView) {
	waitForSyncingStorages()

	ret, _ = av.ParseAttributeView(avID)
	return
}

type AvSearchResult struct {
	AvID       string            `json:"avID"`
	AvName     string            `json:"avName"`
	ViewName   string            `json:"viewName"`
	ViewID     string            `json:"viewID"`
	ViewLayout av.LayoutType     `json:"viewLayout"`
	BlockID    string            `json:"blockID"`
	HPath      string            `json:"hPath"`
	Children   []*AvSearchResult `json:"children,omitempty"`
}

type AvSearchTempResult struct {
	AvID      string
	AvName    string
	AvUpdated int64
	Score     float64
}

func SearchAttributeView(keyword string, excludeAvIDs []string, currentAvID, currentBlockID string) (ret []*AvSearchResult) {
	waitForSyncingStorages()

	ret = []*AvSearchResult{}
	keyword = strings.TrimSpace(keyword)
	keywords := strings.Fields(keyword)

	var avSearchTmpResults []*AvSearchTempResult
	boxID := ""
	if currentBlockID != "" {
		if bt := treenode.GetBlockTree(currentBlockID); nil != bt && IsEncryptedBox(bt.BoxID) {
			boxID = bt.BoxID
		}
	} else if currentAvID != "" {
		_, boxID = av.FindAttributeViewPath(currentAvID)
	}
	avDir := filepath.Join(util.DataDir, "storage", "av")
	if boxID != "" {
		avDir = filepath.Join(util.DataDir, boxID, "storage", "av")
	}
	entries, err := os.ReadDir(avDir)
	if err != nil {
		logging.LogErrorf("read directory [%s] failed: %s", avDir, err)
		return
	}

	avBlockRels := av.GetBlockRels()
	if 1 > len(avBlockRels) {
		return
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		id := strings.TrimSuffix(entry.Name(), ".json")
		if !ast.IsNodeIDPattern(id) {
			continue
		}

		if gulu.Str.Contains(id, excludeAvIDs) {
			continue
		}

		if nil == avBlockRels[id] {
			continue
		}

		name, _ := av.GetAttributeViewNameInBox(id, boxID)
		info, _ := entry.Info()
		if "" != keyword {
			score := 0.0
			hit := false
			for _, k := range keywords {
				if strings.Contains(strings.ToLower(name), strings.ToLower(k)) {
					score += smetrics.JaroWinkler(name, k, 0.7, 4)
					hit = true
				} else {
					hit = false
					break
				}
			}

			if hit {
				a := &AvSearchTempResult{AvID: id, AvName: name, Score: score}
				if nil != info && !info.ModTime().IsZero() {
					a.AvUpdated = info.ModTime().UnixMilli()
				}
				avSearchTmpResults = append(avSearchTmpResults, a)
			}
		} else {
			a := &AvSearchTempResult{AvID: id, AvName: name}
			if nil != info && !info.ModTime().IsZero() {
				a.AvUpdated = info.ModTime().UnixMilli()
			}
			avSearchTmpResults = append(avSearchTmpResults, a)
		}
	}

	if "" == keyword {
		sort.Slice(avSearchTmpResults, func(i, j int) bool { return avSearchTmpResults[i].AvUpdated > avSearchTmpResults[j].AvUpdated })
	} else {
		sort.SliceStable(avSearchTmpResults, func(i, j int) bool {
			if avSearchTmpResults[i].Score == avSearchTmpResults[j].Score {
				return avSearchTmpResults[i].AvUpdated > avSearchTmpResults[j].AvUpdated
			}
			return avSearchTmpResults[i].Score > avSearchTmpResults[j].Score
		})
	}
	if 12 <= len(avSearchTmpResults) {
		avSearchTmpResults = avSearchTmpResults[:12]
	}

	for _, tmpResult := range avSearchTmpResults {
		bIDs := avBlockRels[tmpResult.AvID]
		var node *ast.Node
		for _, bID := range bIDs {
			tree, _ := loadTreeByBlockIDInBox(bID, boxID)
			if nil == tree {
				continue
			}

			node = treenode.GetNodeInTree(tree, bID)
			if nil == node || "" == node.AttributeViewID || ast.NodeAttributeView != node.Type {
				node = nil
				continue
			}

			break
		}

		if nil == node {
			continue
		}

		attrView, _ := av.ParseAttributeViewInBox(tmpResult.AvID, boxID)
		if nil == attrView {
			continue
		}

		var hPath string
		baseBlock := treenode.GetBlockTreeRootByPath(node.Box, node.Path)
		if nil != baseBlock {
			hPath = baseBlock.HPath
		}
		box := Conf.Box(node.Box)
		if nil != box {
			hPath = box.Name + hPath
		}

		name := tmpResult.AvName
		if "" == name {
			name = Conf.language(267)
		}

		parent := &AvSearchResult{
			AvID:    tmpResult.AvID,
			AvName:  tmpResult.AvName,
			BlockID: node.ID,
			HPath:   hPath,
		}
		ret = append(ret, parent)

		for _, view := range attrView.Views {
			child := &AvSearchResult{
				AvID:       tmpResult.AvID,
				AvName:     tmpResult.AvName,
				ViewName:   view.Name,
				ViewID:     view.ID,
				ViewLayout: view.LayoutType,
				BlockID:    node.ID,
				HPath:      hPath,
			}
			parent.Children = append(parent.Children, child)
		}
	}
	return
}

type BlockAttributeViewKeys struct {
	AvID      string          `json:"avID"`
	AvName    string          `json:"avName"`
	BlockIDs  []string        `json:"blockIDs"`
	KeyValues []*av.KeyValues `json:"keyValues"`
}

type AttributeViewBacklinkRelation struct {
	KeyID        string `json:"keyID"`
	KeyName      string `json:"keyName"`
	TargetAvID   string `json:"targetAvID"`
	TargetItemID string `json:"targetItemID"`
}

type AttributeViewBacklink struct {
	AvID            string                           `json:"avID"`
	AvName          string                           `json:"avName"`
	BlockIDs        []string                         `json:"blockIDs"`
	DatabaseBlockID string                           `json:"databaseBlockID"`
	BoxID           string                           `json:"boxID"`
	DatabasePath    string                           `json:"databasePath"`
	ItemID          string                           `json:"itemID"`
	ValueID         string                           `json:"valueID"`
	Title           string                           `json:"title"`
	Icon            string                           `json:"icon"`
	BoundBlockID    string                           `json:"boundBlockID"`
	IsDetached      bool                             `json:"isDetached"`
	Relations       []*AttributeViewBacklinkRelation `json:"relations"`
}

type AttributeViewBacklinks struct {
	Total int                      `json:"total"`
	Items []*AttributeViewBacklink `json:"items"`
}

type attributeViewBacklinkTarget struct {
	avID   string
	itemID string
}

func getAttributeViewBacklinkMatches(srcAttrView *av.AttributeView, target *attributeViewBacklinkTarget) (ret map[string][]*AttributeViewBacklinkRelation) {
	ret = map[string][]*AttributeViewBacklinkRelation{}
	seenRelations := map[string]bool{}
	for _, keyValues := range srcAttrView.KeyValues {
		key := keyValues.Key
		if av.KeyTypeRelation != key.Type || nil == key.Relation || key.Relation.AvID != target.avID {
			continue
		}

		for _, value := range keyValues.Values {
			if nil == value.Relation || !slices.Contains(value.Relation.BlockIDs, target.itemID) {
				continue
			}

			relationID := value.BlockID + "\x00" + key.ID + "\x00" + target.avID + "\x00" + target.itemID
			if seenRelations[relationID] {
				continue
			}
			seenRelations[relationID] = true
			ret[value.BlockID] = append(ret[value.BlockID], &AttributeViewBacklinkRelation{
				KeyID:        key.ID,
				KeyName:      key.Name,
				TargetAvID:   target.avID,
				TargetItemID: target.itemID,
			})
		}
	}
	return
}

func getAttributeViewBacklinkBlockValues(attrView *av.AttributeView) (ret map[string]*av.Value) {
	ret = map[string]*av.Value{}
	blockKeyValues := attrView.GetBlockKeyValues()
	if nil == blockKeyValues {
		return
	}
	for _, value := range blockKeyValues.Values {
		ret[value.BlockID] = value
	}
	return
}

func resolveAttributeViewBacklinkItemID(attrView *av.AttributeView, itemID, valueID string) string {
	if nil != attrView.GetBlockValue(itemID) {
		return itemID
	}
	if "" == valueID {
		return ""
	}
	for _, value := range getAttributeViewBacklinkBlockValues(attrView) {
		if value.ID == valueID {
			return value.BlockID
		}
	}
	return ""
}

func sortAttributeViewBacklinkBlockIDs(blockIDs []string, blockTrees map[string]*treenode.BlockTree) {
	sort.Slice(blockIDs, func(i, j int) bool {
		left, right := blockTrees[blockIDs[i]], blockTrees[blockIDs[j]]
		if nil == left || nil == right {
			if nil == left && nil != right {
				return false
			}
			if nil != left && nil == right {
				return true
			}
			return blockIDs[i] < blockIDs[j]
		}
		if left.HPath != right.HPath {
			return left.HPath < right.HPath
		}
		if left.BoxID != right.BoxID {
			return left.BoxID < right.BoxID
		}
		return blockIDs[i] < blockIDs[j]
	})
}

func GetAttributeViewBacklinks(nodeID, avID, itemID, valueID string) (ret *AttributeViewBacklinks) {
	waitForSyncingStorages()

	ret = &AttributeViewBacklinks{Items: []*AttributeViewBacklink{}}
	targets := getAttributeViewBacklinkTargets(nodeID, avID, itemID, valueID)
	if 1 > len(targets) {
		return
	}

	backlinks := map[string]*AttributeViewBacklink{}
	relationKeys := map[string]map[string]bool{}
	cachedAttrViews := map[string]*av.AttributeView{}
	cachedBlockValues := map[string]map[string]*av.Value{}
	cachedBlockIDs := map[string][]string{}
	cachedBlockTrees := map[string]map[string]*treenode.BlockTree{}
	for _, target := range targets {
		for _, srcAvID := range av.GetSrcAvIDs(target.avID) {
			srcAttrView := cachedAttrViews[srcAvID]
			if nil == srcAttrView {
				var err error
				srcAttrView, err = av.ParseAttributeView(srcAvID)
				if nil == srcAttrView {
					logging.LogErrorf("parse attribute view [%s] failed: %s", srcAvID, err)
					continue
				}
				cachedAttrViews[srcAvID] = srcAttrView
			}

			blockValues := cachedBlockValues[srcAvID]
			if nil == blockValues {
				blockValues = getAttributeViewBacklinkBlockValues(srcAttrView)
				cachedBlockValues[srcAvID] = blockValues
			}
			for sourceItemID, relations := range getAttributeViewBacklinkMatches(srcAttrView, target) {
				blockValue := blockValues[sourceItemID]
				if nil == blockValue || nil == blockValue.Block {
					continue
				}

				backlinkID := srcAvID + "\x00" + sourceItemID
				backlink := backlinks[backlinkID]
				if nil == backlink {
					blockIDs, cached := cachedBlockIDs[srcAvID]
					blockTrees := cachedBlockTrees[srcAvID]
					if !cached {
						blockIDs = treenode.GetMirrorAttrViewBlockIDs(srcAvID)
						blockTrees = treenode.GetBlockTrees(blockIDs)
						sortAttributeViewBacklinkBlockIDs(blockIDs, blockTrees)
						cachedBlockIDs[srcAvID] = blockIDs
						cachedBlockTrees[srcAvID] = blockTrees
					}
					backlink = &AttributeViewBacklink{
						AvID:         srcAvID,
						AvName:       getAttrViewName(srcAttrView),
						BlockIDs:     blockIDs,
						ItemID:       sourceItemID,
						ValueID:      blockValue.ID,
						Title:        blockValue.Block.Content,
						Icon:         blockValue.Block.Icon,
						BoundBlockID: blockValue.Block.ID,
						IsDetached:   blockValue.IsDetached || "" == blockValue.Block.ID,
						Relations:    []*AttributeViewBacklinkRelation{},
					}
					if 0 < len(blockIDs) {
						backlink.DatabaseBlockID = blockIDs[0]
						if bt := blockTrees[blockIDs[0]]; nil != bt {
							backlink.BoxID = bt.BoxID
							backlink.DatabasePath = bt.HPath
						}
					}
					backlinks[backlinkID] = backlink
					relationKeys[backlinkID] = map[string]bool{}
				}

				for _, relation := range relations {
					relationID := relation.KeyID + "\x00" + relation.TargetAvID + "\x00" + relation.TargetItemID
					if relationKeys[backlinkID][relationID] {
						continue
					}
					relationKeys[backlinkID][relationID] = true
					backlink.Relations = append(backlink.Relations, relation)
				}
			}
		}
	}

	for _, backlink := range backlinks {
		ret.Items = append(ret.Items, backlink)
	}
	sort.Slice(ret.Items, func(i, j int) bool {
		if ret.Items[i].AvName != ret.Items[j].AvName {
			return ret.Items[i].AvName < ret.Items[j].AvName
		}
		if ret.Items[i].Title != ret.Items[j].Title {
			return ret.Items[i].Title < ret.Items[j].Title
		}
		return ret.Items[i].ItemID < ret.Items[j].ItemID
	})
	ret.Total = len(ret.Items)
	return
}

func getAttributeViewBacklinkTargets(nodeID, avID, itemID, valueID string) (ret []*attributeViewBacklinkTarget) {
	if "" != avID && ("" != itemID || "" != valueID) {
		attrView, err := av.ParseAttributeView(avID)
		if nil == attrView {
			logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
			return
		}
		itemID = resolveAttributeViewBacklinkItemID(attrView, itemID, valueID)
		if "" != itemID {
			ret = append(ret, &attributeViewBacklinkTarget{avID: avID, itemID: itemID})
		}
		return
	}

	attrs := sql.GetBlockAttrs(nodeID)
	for targetAvID := range strings.SplitSeq(attrs[av.NodeAttrNameAvs], ",") {
		if "" == targetAvID {
			continue
		}
		attrView, err := av.ParseAttributeView(targetAvID)
		if nil == attrView {
			logging.LogErrorf("parse attribute view [%s] failed: %s", targetAvID, err)
			continue
		}
		blockValue := attrView.GetBlockValueByBoundID(nodeID)
		if nil != blockValue {
			ret = append(ret, &attributeViewBacklinkTarget{avID: targetAvID, itemID: blockValue.BlockID})
		}
	}
	return
}

func GetAttributeViewItemKeys(avID, itemID, valueID string) (ret []*BlockAttributeViewKeys) {
	waitForSyncingStorages()

	ret = []*BlockAttributeViewKeys{}
	attrView, err := av.ParseAttributeView(avID)
	if nil == attrView {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}
	if nil == attrView.GetBlockValue(itemID) && "" != valueID {
		blockKeyValues := attrView.GetBlockKeyValues()
		if nil != blockKeyValues {
			for _, value := range blockKeyValues.Values {
				if value.ID == valueID {
					itemID = value.BlockID
					break
				}
			}
		}
	}
	if nil == attrView.GetBlockValue(itemID) {
		return
	}

	view, err := getRenderAttributeViewView(attrView, "", "", true)
	if nil != err {
		return
	}
	sql.RenderView(attrView, view, "", false)

	var keyValues []*av.KeyValues
	for _, kv := range attrView.KeyValues {
		if av.KeyTypeLineNumber == kv.Key.Type {
			continue
		}

		itemKeyValues := &av.KeyValues{Key: kv.Key}
		for _, value := range kv.Values {
			if value.BlockID == itemID {
				itemKeyValues.Values = append(itemKeyValues.Values, value)
			}
		}
		if 0 < len(itemKeyValues.Values) {
			keyValues = append(keyValues, itemKeyValues)
		}
	}

	refreshAttrViewKeyIDs(attrView, true)
	sorts := map[string]int{}
	for i, keyID := range attrView.KeyIDs {
		sorts[keyID] = i
	}
	sort.Slice(keyValues, func(i, j int) bool {
		return sorts[keyValues[i].Key.ID] < sorts[keyValues[j].Key.ID]
	})

	ret = append(ret, &BlockAttributeViewKeys{
		AvID:      avID,
		AvName:    getAttrViewName(attrView),
		BlockIDs:  treenode.GetMirrorAttrViewBlockIDs(avID),
		KeyValues: keyValues,
	})
	return
}

func GetBlockAttributeViewKeys(nodeID string) (ret []*BlockAttributeViewKeys) {
	waitForSyncingStorages()

	ret = []*BlockAttributeViewKeys{}
	attrs := sql.GetBlockAttrs(nodeID)
	avs := attrs[av.NodeAttrNameAvs]
	if "" == avs {
		return
	}

	cachedAttrViews := map[string]*av.AttributeView{}
	avIDs := strings.SplitSeq(avs, ",")
	for avID := range avIDs {
		attrView := cachedAttrViews[avID]
		if nil == attrView {
			var err error
			attrView, err = av.ParseAttributeView(avID)
			if nil == attrView {
				logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
				continue
			}
			cachedAttrViews[avID] = attrView
		}

		if !attrView.ExistBoundBlock(nodeID) {
			// 比如剪切后粘贴，块 ID 会变，但是属性还在块上，这里做一次数据订正
			// Auto verify the database name when clicking the block superscript icon https://github.com/siyuan-note/siyuan/issues/10861
			unbindBlockAv(nil, avID, nodeID)
			return
		}

		blockVal := attrView.GetBlockValueByBoundID(nodeID)
		if nil == blockVal {
			continue
		}

		itemID := blockVal.BlockID
		view, err := getRenderAttributeViewView(attrView, "", nodeID, true)
		if nil != err {
			continue
		}

		// 渲染填充 attrView.KeyValues
		sql.RenderView(attrView, view, "", false)

		var keyValues []*av.KeyValues
		for _, kv := range attrView.KeyValues {
			if av.KeyTypeLineNumber == kv.Key.Type {
				// 属性面板中不显示行号字段
				// The line number field no longer appears in the database attribute panel https://github.com/siyuan-note/siyuan/issues/11319
				continue
			}

			kValues := &av.KeyValues{Key: kv.Key}
			for _, v := range kv.Values {
				if v.BlockID == itemID {
					kValues.Values = append(kValues.Values, v)
				}
			}

			keyValues = append(keyValues, kValues)
		}

		// 字段排序
		refreshAttrViewKeyIDs(attrView, true)
		sorts := map[string]int{}
		for i, k := range attrView.KeyIDs {
			sorts[k] = i
		}
		sort.Slice(keyValues, func(i, j int) bool {
			return sorts[keyValues[i].Key.ID] < sorts[keyValues[j].Key.ID]
		})

		blockIDs := treenode.GetMirrorAttrViewBlockIDs(avID)
		if 1 > len(blockIDs) {
			// 老数据兼容处理
			avBts := treenode.GetBlockTreesByType("av")
			for _, avBt := range avBts {
				if nil == avBt {
					continue
				}
				tree, _ := LoadTreeByBlockID(avBt.ID)
				if nil == tree {
					continue
				}
				node := treenode.GetNodeInTree(tree, avBt.ID)
				if nil == node {
					continue
				}
				if avID == node.AttributeViewID {
					blockIDs = append(blockIDs, avBt.ID)
				}
			}
			if 1 > len(blockIDs) {
				tree, _ := LoadTreeByBlockID(nodeID)
				if nil != tree {
					node := treenode.GetNodeInTree(tree, nodeID)
					if nil != node {
						if removeErr := removeNodeAvID(node, avID, nil, tree); nil != removeErr {
							logging.LogErrorf("remove node avID [%s] failed: %s", avID, removeErr)
						}
					}
				}
				continue
			}
			blockIDs = gulu.Str.RemoveDuplicatedElem(blockIDs)
			for _, blockID := range blockIDs {
				av.UpsertBlockRel(avID, blockID)
			}
		}

		ret = append(ret, &BlockAttributeViewKeys{
			AvID:      avID,
			AvName:    getAttrViewName(attrView),
			BlockIDs:  blockIDs,
			KeyValues: keyValues,
		})
	}
	return
}

func genAttrViewGroups(view *av.View, attrView *av.AttributeView) {
	if !view.IsGroupView() {
		return
	}

	groupStates := getAttrViewGroupStates(view)

	group := view.Group
	view.Groups = nil
	viewable := sql.RenderView(attrView, view, "", false)
	var items []av.Item
	for _, item := range viewable.(av.Collection).GetItems() {
		items = append(items, item)
	}

	groupKey := view.GetGroupKey(attrView)
	if nil == groupKey {
		return
	}

	var rangeStart, rangeEnd float64
	switch group.Method {
	case av.GroupMethodValue:
		if av.GroupOrderMan != group.Order {
			sort.SliceStable(items, func(i, j int) bool {
				return items[i].GetValue(group.Field).String(false) < items[j].GetValue(group.Field).String(false)
			})
		}
	case av.GroupMethodRangeNum:
		if nil == group.Range {
			return
		}

		rangeStart, rangeEnd = group.Range.NumStart, group.Range.NumStart+group.Range.NumStep
		sort.SliceStable(items, func(i, j int) bool {
			return items[i].GetValue(group.Field).Number.Content < items[j].GetValue(group.Field).Number.Content
		})
	case av.GroupMethodDateDay, av.GroupMethodDateWeek, av.GroupMethodDateMonth, av.GroupMethodDateYear, av.GroupMethodDateRelative:
		if av.KeyTypeCreated == groupKey.Type {
			sort.SliceStable(items, func(i, j int) bool {
				return items[i].GetValue(group.Field).Created.Content < items[j].GetValue(group.Field).Created.Content
			})
		} else if av.KeyTypeUpdated == groupKey.Type {
			sort.SliceStable(items, func(i, j int) bool {
				return items[i].GetValue(group.Field).Updated.Content < items[j].GetValue(group.Field).Updated.Content
			})
		} else if av.KeyTypeDate == groupKey.Type {
			sort.SliceStable(items, func(i, j int) bool {
				return items[i].GetValue(group.Field).Date.Content < items[j].GetValue(group.Field).Date.Content
			})
		}
	}

	todayStart := time.Now()
	todayStart = time.Date(todayStart.Year(), todayStart.Month(), todayStart.Day(), 0, 0, 0, 0, time.Local)

	var relationDestAv *av.AttributeView
	if av.KeyTypeRelation == groupKey.Type && nil != groupKey.Relation {
		if attrView.ID == groupKey.Relation.AvID {
			relationDestAv = attrView
		} else {
			relationDestAv, _ = av.ParseAttributeView(groupKey.Relation.AvID)
		}
	}

	groupItemsMap := map[string][]av.Item{}
	for _, item := range items {
		value := item.GetValue(group.Field)
		if value.IsBlank() {
			groupItemsMap[groupValueDefault] = append(groupItemsMap[groupValueDefault], item)
			continue
		}

		var groupVal string
		switch group.Method {
		case av.GroupMethodValue:
			if av.KeyTypeSelect == groupKey.Type || av.KeyTypeMSelect == groupKey.Type {
				for _, s := range value.MSelect {
					groupItemsMap[s.Content] = append(groupItemsMap[s.Content], item)
				}
				continue
			} else if av.KeyTypeRelation == groupKey.Type {
				if nil == relationDestAv {
					continue
				}

				for _, bID := range value.Relation.BlockIDs {
					groupItemsMap[bID] = append(groupItemsMap[bID], item)
				}
				continue
			}

			groupVal = value.String(false)
		case av.GroupMethodRangeNum:
			if group.Range.NumStart > value.Number.Content || group.Range.NumEnd < value.Number.Content {
				groupVal = groupValueNotInRange
				break
			}

			for rangeEnd <= group.Range.NumEnd && rangeEnd <= value.Number.Content {
				rangeStart += group.Range.NumStep
				rangeEnd += group.Range.NumStep
			}

			if rangeStart <= value.Number.Content && rangeEnd > value.Number.Content {
				groupVal = fmt.Sprintf("%s - %s", strconv.FormatFloat(rangeStart, 'f', -1, 64), strconv.FormatFloat(rangeEnd, 'f', -1, 64))
			}
		case av.GroupMethodDateDay, av.GroupMethodDateWeek, av.GroupMethodDateMonth, av.GroupMethodDateYear, av.GroupMethodDateRelative:
			var contentTime time.Time
			switch value.Type {
			case av.KeyTypeDate:
				contentTime = time.UnixMilli(value.Date.Content)
			case av.KeyTypeCreated:
				contentTime = time.UnixMilli(value.Created.Content)
			case av.KeyTypeUpdated:
				contentTime = time.UnixMilli(value.Updated.Content)
			}
			switch group.Method {
			case av.GroupMethodDateDay:
				groupVal = contentTime.Format("2006-01-02")
			case av.GroupMethodDateWeek:
				year, week := contentTime.ISOWeek()
				groupVal = fmt.Sprintf("%d-W%02d", year, week)
			case av.GroupMethodDateMonth:
				groupVal = contentTime.Format("2006-01")
			case av.GroupMethodDateYear:
				groupVal = contentTime.Format("2006")
			case av.GroupMethodDateRelative:
				// 过去 30 天之前的按月分组
				// 过去 30 天、过去 7 天、昨天、今天、明天、未来 7 天、未来 30 天
				// 未来 30 天之后的按月分组
				if contentTime.Before(todayStart.AddDate(0, 0, -30)) {
					groupVal = contentTime.Format("2006-01") // 开头的数字用于排序
				} else if contentTime.Before(todayStart.AddDate(0, 0, -7)) {
					groupVal = groupValueLast30Days
				} else if contentTime.Before(todayStart.AddDate(0, 0, -1)) {
					groupVal = groupValueLast7Days
				} else if contentTime.Before(todayStart) {
					groupVal = groupValueYesterday
				} else if (contentTime.After(todayStart) || contentTime.Equal(todayStart)) && contentTime.Before(todayStart.AddDate(0, 0, 1)) {
					groupVal = groupValueToday
				} else if contentTime.After(todayStart.AddDate(0, 0, 30)) {
					groupVal = contentTime.Format("2006-01")
				} else if contentTime.After(todayStart.AddDate(0, 0, 7)) {
					groupVal = groupValueNext30Days
				} else if contentTime.Equal(todayStart.AddDate(0, 0, 2)) || contentTime.After(todayStart.AddDate(0, 0, 2)) {
					groupVal = groupValueNext7Days
				} else {
					groupVal = groupValueTomorrow
				}
			}
		}

		groupItemsMap[groupVal] = append(groupItemsMap[groupVal], item)
	}

	if av.KeyTypeSelect == groupKey.Type || av.KeyTypeMSelect == groupKey.Type {
		for _, o := range groupKey.Options {
			if _, ok := groupItemsMap[o.Name]; !ok {
				groupItemsMap[o.Name] = []av.Item{}
			}
		}
	}

	if av.KeyTypeCheckbox != groupKey.Type {
		if 1 > len(groupItemsMap[groupValueDefault]) {
			// 始终保留默认分组 https://github.com/siyuan-note/siyuan/issues/15587
			groupItemsMap[groupValueDefault] = []av.Item{}
		}
	} else {
		// 对于复选框分组，空白分组表示未选中状态，始终保留 https://github.com/siyuan-note/siyuan/issues/15650
		if nil == groupItemsMap[""] {
			groupItemsMap[""] = []av.Item{}
		}
		if nil == groupItemsMap[av.CheckboxCheckedStr] {
			groupItemsMap[av.CheckboxCheckedStr] = []av.Item{}
		}
	}

	for groupValue, groupItems := range groupItemsMap {
		var v *av.View
		switch view.LayoutType {
		case av.LayoutTypeTable:
			v = av.NewTableView()
			v.Table = av.NewLayoutTable()
		case av.LayoutTypeGallery:
			v = av.NewGalleryView()
			v.Gallery = av.NewLayoutGallery()
		case av.LayoutTypeKanban:
			v = av.NewKanbanView()
			v.Kanban = av.NewLayoutKanban()
		default:
			logging.LogWarnf("unknown layout type [%s] for group view", view.LayoutType)
			return
		}

		v.GroupItemIDs = []string{}
		for _, item := range groupItems {
			v.GroupItemIDs = append(v.GroupItemIDs, item.GetID())
		}

		v.Name = ""       // 分组视图的名称在渲染时才填充
		v.GroupHidden = 1 // 默认隐藏空白分组
		v.GroupKey = groupKey
		v.GroupVal = &av.Value{Type: av.KeyTypeText, Text: &av.ValueText{Content: groupValue}}
		if av.KeyTypeSelect == groupKey.Type || av.KeyTypeMSelect == groupKey.Type {
			if opt := groupKey.GetOption(groupValue); nil != opt {
				v.GroupVal.Text = nil
				v.GroupVal.Type = av.KeyTypeSelect
				v.GroupVal.MSelect = []*av.ValueSelect{{Content: opt.Name, Color: opt.Color}}
			}
		} else if av.KeyTypeRelation == groupKey.Type {
			if relationDestAv != nil && groupValueDefault != groupValue {
				v.GroupVal.Text = nil
				v.GroupVal.Type = av.KeyTypeRelation
				v.GroupVal.Relation = &av.ValueRelation{BlockIDs: []string{groupValue}}

				if destBlock := relationDestAv.GetBlockValue(groupValue); nil != destBlock {
					v.GroupVal.Relation.Contents = []*av.Value{destBlock}
				}
			}
		} else if av.KeyTypeCheckbox == groupKey.Type {
			v.GroupVal.Text = nil
			v.GroupVal.Type = av.KeyTypeCheckbox
			v.GroupVal.Checkbox = &av.ValueCheckbox{}
			if "" != groupValue {
				v.GroupVal.Checkbox.Checked = true
			}
		}
		v.GroupSort = -1
		view.Groups = append(view.Groups, v)
	}

	view.GroupCreated = time.Now().UnixMilli()
	setAttrViewGroupStates(view, groupStates)
}

// GroupState 用于临时记录每个分组视图的状态，以便后面重新生成分组后可以恢复这些状态。
type GroupState struct {
	ID      string
	Folded  bool
	Hidden  int
	Sort    int
	ItemIDs []string
}

func getAttrViewGroupStates(view *av.View) (groupStates map[string]*GroupState) {
	groupStates = map[string]*GroupState{}
	if !view.IsGroupView() {
		return
	}

	for _, groupView := range view.Groups {
		if av.LayoutTypeKanban == groupView.LayoutType {
			// 看板视图的分组不能折叠
			groupView.GroupFolded = false
		}

		groupStates[groupView.GetGroupValue()] = &GroupState{
			ID:      groupView.ID,
			Folded:  groupView.GroupFolded,
			Hidden:  groupView.GroupHidden,
			Sort:    groupView.GroupSort,
			ItemIDs: groupView.GroupItemIDs,
		}
	}
	return
}

func setAttrViewGroupStates(view *av.View, groupStates map[string]*GroupState) {
	for _, groupView := range view.Groups {
		if state, ok := groupStates[groupView.GetGroupValue()]; ok {
			groupView.ID = state.ID
			groupView.GroupFolded = state.Folded
			groupView.GroupHidden = state.Hidden
			groupView.GroupSort = state.Sort

			itemIDsSort := map[string]int{}
			for i, itemID := range state.ItemIDs {
				itemIDsSort[itemID] = i
			}

			sort.SliceStable(groupView.GroupItemIDs, func(i, j int) bool {
				return itemIDsSort[groupView.GroupItemIDs[i]] < itemIDsSort[groupView.GroupItemIDs[j]]
			})
		}
	}

	defaultGroup := view.GetGroupByGroupValue(groupValueDefault)
	if nil != defaultGroup {
		if -1 == defaultGroup.GroupSort {
			view.RemoveGroupByID(defaultGroup.ID)
		} else {
			defaultGroup = nil
		}
	}

	for i, groupView := range view.Groups {
		if i != groupView.GroupSort && -1 == groupView.GroupSort {
			groupView.GroupSort = i
		}
	}

	if nil != defaultGroup {
		view.Groups = append(view.Groups, defaultGroup)
		defaultGroup.GroupSort = len(view.Groups) - 1
	}
}

func GetCurrentAttributeViewImages(avID, viewID, query string) (ret []string, err error) {
	var attrView *av.AttributeView
	attrView, err = av.ParseAttributeView(avID)
	if err != nil {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}
	var view *av.View

	if "" != viewID {
		view, _ = attrView.GetCurrentView(viewID)
	} else {
		view = attrView.GetView(attrView.ViewID)
	}

	cachedAttrViews := map[string]*av.AttributeView{}
	rollupFurtherCollections := sql.GetFurtherCollections(attrView, cachedAttrViews)
	table := getAttrViewTable(attrView, view, query)
	av.Filter(table, attrView, rollupFurtherCollections, cachedAttrViews)
	av.Sort(table, attrView)

	ids := map[string]bool{}
	for _, column := range table.Columns {
		ids[column.ID] = column.Hidden
	}

	for _, row := range table.Rows {
		for _, cell := range row.Cells {
			if nil != cell.Value && av.KeyTypeMAsset == cell.Value.Type && nil != cell.Value.MAsset && !ids[cell.Value.KeyID] {
				for _, a := range cell.Value.MAsset {
					if av.AssetTypeImage == a.Type {
						ret = append(ret, a.Content)
					}
				}
			}
		}
	}
	return
}

func (tx *Transaction) doSetAttrViewColDateFillCreated(operation *Operation) (ret *TxErr) {
	err := setAttributeViewColDateFillCreated(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttributeViewColDateFillCreated(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	keyID := operation.ID
	key, _ := attrView.GetKey(keyID)
	if nil == key || av.KeyTypeDate != key.Type {
		return
	}

	if nil == key.Date {
		key.Date = &av.Date{}
	}

	key.Date.AutoFillNow = operation.Data.(bool)
	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewColDateFillSpecificTime(operation *Operation) (ret *TxErr) {
	err := setAttrViewColDateFillSpecificTime(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttrViewColDateFillSpecificTime(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	keyID := operation.ID
	dateValues, _ := attrView.GetKeyValues(keyID)
	if nil == dateValues || av.KeyTypeDate != dateValues.Key.Type {
		return
	}

	if nil == dateValues.Key.Date {
		dateValues.Key.Date = &av.Date{}
	}

	dateValues.Key.Date.FillSpecificTime = operation.Data.(bool)
	for _, v := range dateValues.Values {
		if !v.IsEmpty() {
			continue
		}
		if nil == v.Date {
			v.Date = &av.ValueDate{}
		}
		v.Date.IsNotTime = !dateValues.Key.Date.FillSpecificTime
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewCreatedIncludeTime(operation *Operation) (ret *TxErr) {
	err := setAttrViewCreatedIncludeTime(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttrViewCreatedIncludeTime(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	key, _ := attrView.GetKey(operation.ID)
	if nil == key {
		return
	}

	if nil == key.Created {
		key.Created = &av.Created{}
	}

	key.Created.IncludeTime = operation.Data.(bool)
	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewUpdatedIncludeTime(operation *Operation) (ret *TxErr) {
	err := setAttrViewUpdatedIncludeTime(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttrViewUpdatedIncludeTime(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	key, _ := attrView.GetKey(operation.ID)
	if nil == key {
		return
	}

	if nil == key.Updated {
		key.Updated = &av.Updated{}
	}

	key.Updated.IncludeTime = operation.Data.(bool)
	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doHideAttrViewName(operation *Operation) (ret *TxErr) {
	err := hideAttrViewName(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func hideAttrViewName(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		logging.LogErrorf("parse attribute view [%s] failed: %s", operation.AvID, err)
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if nil == view {
		logging.LogErrorf("get view [%s] failed: %s", operation.BlockID, err)
		return
	}

	view.HideAttrViewName = operation.Data.(bool)
	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doUpdateAttrViewColRollup(operation *Operation) (ret *TxErr) {
	err := updateAttributeViewColRollup(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func updateAttributeViewColRollup(operation *Operation) (err error) {
	// operation.AvID 汇总字段所在 av
	// operation.ID 汇总字段 ID
	// operation.ParentID 汇总字段基于的关联字段 ID
	// operation.KeyID 目标字段 ID
	// operation.Data 计算方式

	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	rollUpKey, _ := attrView.GetKey(operation.ID)
	if nil == rollUpKey {
		return
	}

	rollUpKey.Rollup = &av.Rollup{
		RelationKeyID: operation.ParentID,
		KeyID:         operation.KeyID,
	}

	if nil == operation.Data {
		return
	}

	data := operation.Data.(map[string]any)
	if nil != data["calc"] {
		calcData, jsonErr := gulu.JSON.MarshalJSON(data["calc"])
		if nil != jsonErr {
			err = jsonErr
			return
		}
		if jsonErr = gulu.JSON.UnmarshalJSON(calcData, &rollUpKey.Rollup.Calc); nil != jsonErr {
			err = jsonErr
			return
		}
	}

	// 如果存在该汇总字段的过滤条件，则移除该过滤条件 https://github.com/siyuan-note/siyuan/issues/15660
	for _, view := range attrView.Views {
		view.Filters = av.RemoveFiltersByColumn(view.Filters, rollUpKey.ID)
		if 0 == len(view.Filters) {
			// 保持 spec 5 根组不变量：根组被裁空后补一个空 AND 根组
			view.Filters = []*av.ViewFilter{{Combination: av.FilterCombinationAnd}}
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doUpdateAttrViewColRelation(operation *Operation) (ret *TxErr) {
	err := updateAttributeViewColRelation(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func updateAttributeViewColRelation(operation *Operation) (err error) {
	// operation.AvID 源 avID
	// operation.ID 目标 avID
	// operation.KeyID 源 av 关联字段 ID
	// operation.IsTwoWay 是否双向关联
	// operation.BackRelationKeyID 双向关联的目标关联字段 ID
	// operation.Name 双向关联的目标关联字段名称
	// operation.Format 源 av 关联字段名称

	srcAv, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	destAv, err := av.ParseAttributeView(operation.ID)
	if err != nil {
		return
	}

	isSameAv := srcAv.ID == destAv.ID
	if isSameAv {
		destAv = srcAv
	}

	oldDestAvID := ""
	for _, keyValues := range srcAv.KeyValues {
		if keyValues.Key.ID != operation.KeyID {
			continue
		}

		srcRel := keyValues.Key.Relation
		// 已经设置过双向关联的话需要先断开双向关联
		if nil != srcRel {
			oldDestAvID = srcRel.AvID
			if srcRel.IsTwoWay {
				oldDestAv, _ := av.ParseAttributeView(srcRel.AvID)
				if nil != oldDestAv {
					isOldSameAv := oldDestAv.ID == destAv.ID
					if isOldSameAv {
						oldDestAv = destAv
					}

					oldDestKey, _ := oldDestAv.GetKey(srcRel.BackKeyID)
					if nil != oldDestKey && nil != oldDestKey.Relation && oldDestKey.Relation.AvID == srcAv.ID && oldDestKey.Relation.IsTwoWay {
						oldDestKey.Relation.IsTwoWay = false
						oldDestKey.Relation.BackKeyID = ""
					}

					if !isOldSameAv {
						err = av.SaveAttributeView(oldDestAv)
						if err != nil {
							return
						}
					}
				}
			}

			av.RemoveAvRel(srcAv.ID, srcRel.AvID)
		}

		srcRel = &av.Relation{
			AvID:     operation.ID,
			IsTwoWay: operation.IsTwoWay,
		}
		if operation.IsTwoWay {
			srcRel.BackKeyID = operation.BackRelationKeyID
		} else {
			srcRel.BackKeyID = ""
		}
		keyValues.Key.Relation = srcRel
		keyValues.Key.Name = operation.Format

		break
	}
	if oldDestAvID != operation.ID {
		srcAv.RemoveNewItemTemplateFieldValue(operation.KeyID)
	}

	destAdded := false
	backRelKey, _ := destAv.GetKey(operation.BackRelationKeyID)
	if nil != backRelKey {
		backRelKey.Relation = &av.Relation{
			AvID:      operation.AvID,
			IsTwoWay:  operation.IsTwoWay,
			BackKeyID: operation.KeyID,
		}
		destAdded = true
		if operation.IsTwoWay {
			name := strings.TrimSpace(operation.Name)
			if "" == name {
				name = srcAv.Name + " " + operation.Format
			}
			backRelKey.Name = strings.TrimSpace(name)
		} else {
			backRelKey.Relation.BackKeyID = ""
		}
	}

	if !destAdded && operation.IsTwoWay {
		// 新建双向关联目标字段
		name := strings.TrimSpace(operation.Name)
		if "" == name {
			name = srcAv.Name + " " + operation.Format
			name = strings.TrimSpace(name)
		}

		destKeyValues := &av.KeyValues{
			Key: &av.Key{
				ID:       operation.BackRelationKeyID,
				Name:     name,
				Type:     av.KeyTypeRelation,
				Relation: &av.Relation{AvID: operation.AvID, IsTwoWay: operation.IsTwoWay, BackKeyID: operation.KeyID},
			},
		}
		destAv.KeyValues = append(destAv.KeyValues, destKeyValues)

		for _, v := range destAv.Views {
			switch v.LayoutType {
			case av.LayoutTypeTable:
				v.Table.Columns = append(v.Table.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: operation.BackRelationKeyID}})
			case av.LayoutTypeGallery:
				v.Gallery.CardFields = append(v.Gallery.CardFields, &av.ViewGalleryCardField{BaseField: &av.BaseField{ID: operation.BackRelationKeyID}})
			case av.LayoutTypeKanban:
				v.Kanban.Fields = append(v.Kanban.Fields, &av.ViewKanbanField{BaseField: &av.BaseField{ID: operation.BackRelationKeyID}})
			}
		}

		now := time.Now().UnixMilli()
		// 和现有值进行关联
		for _, keyValues := range srcAv.KeyValues {
			if keyValues.Key.ID != operation.KeyID {
				continue
			}

			for _, srcVal := range keyValues.Values {
				for _, blockID := range srcVal.Relation.BlockIDs {
					destVal := destAv.GetValue(destKeyValues.Key.ID, blockID)
					if nil == destVal {
						destVal = &av.Value{ID: ast.NewNodeID(), KeyID: destKeyValues.Key.ID, BlockID: blockID, Type: keyValues.Key.Type, Relation: &av.ValueRelation{}, CreatedAt: now, UpdatedAt: now + 1000}
					} else {
						destVal.Type = keyValues.Key.Type
						if nil == destVal.Relation {
							destVal.Relation = &av.ValueRelation{}
						}
						destVal.UpdatedAt = now
						destVal.IsRenderAutoFill = false
					}
					destVal.Relation.BlockIDs = append(destVal.Relation.BlockIDs, srcVal.BlockID)
					destVal.Relation.BlockIDs = gulu.Str.RemoveDuplicatedElem(destVal.Relation.BlockIDs)
					destKeyValues.Values = append(destKeyValues.Values, destVal)
				}
			}
		}
	}

	regenAttrViewGroups(srcAv)
	err = av.SaveAttributeView(srcAv)
	if err != nil {
		return
	}
	if !isSameAv {
		regenAttrViewGroups(destAv)
		err = av.SaveAttributeView(destAv)
		ReloadAttrView(destAv.ID)
	}

	av.UpsertAvBackRel(srcAv.ID, destAv.ID)
	if operation.IsTwoWay && !isSameAv {
		av.UpsertAvBackRel(destAv.ID, srcAv.ID)
	}
	if "" != oldDestAvID && oldDestAvID != operation.ID && oldDestAvID != srcAv.ID {
		ReloadAttrView(oldDestAvID)
	}
	return
}

func (tx *Transaction) doSortAttrViewView(operation *Operation) (ret *TxErr) {
	avID := operation.AvID
	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		logging.LogErrorf("parse attribute view [%s] failed: %s", operation.AvID, err)
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}

	view := attrView.GetView(operation.ID)
	if nil == view {
		logging.LogErrorf("get view failed: %s", operation.BlockID)
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	viewID := view.ID
	previousViewID := operation.PreviousID
	if viewID == previousViewID {
		return
	}

	var index, previousIndex int
	for i, v := range attrView.Views {
		if v.ID == viewID {
			view = v
			index = i
			break
		}
	}

	attrView.Views = append(attrView.Views[:index], attrView.Views[index+1:]...)
	for i, v := range attrView.Views {
		if v.ID == previousViewID {
			previousIndex = i + 1
			break
		}
	}
	attrView.Views = util.InsertElem(attrView.Views, previousIndex, view)

	if err = av.SaveAttributeView(attrView); err != nil {
		logging.LogErrorf("save attribute view [%s] failed: %s", avID, err)
		return &TxErr{code: TxErrCodeWriteTree, msg: err.Error(), id: avID}
	}
	return
}

func (tx *Transaction) doRemoveAttrViewView(operation *Operation) (ret *TxErr) {
	var err error
	avID := operation.AvID
	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return &TxErr{code: TxErrCodeBlockNotFound, id: avID}
	}

	if 1 >= len(attrView.Views) {
		logging.LogWarnf("can't remove last view [%s] of attribute view [%s]", operation.AvID, avID)
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if nil == view {
		logging.LogWarnf("get view failed: %s", operation.BlockID)
		return
	}

	viewID := view.ID
	var index int
	for i, view := range attrView.Views {
		if viewID == view.ID {
			attrView.Views = append(attrView.Views[:i], attrView.Views[i+1:]...)
			index = i - 1
			break
		}
	}
	if 0 > index {
		index = 0
	}

	view = attrView.Views[index]
	attrView.ViewID = view.ID
	if err = av.SaveAttributeView(attrView); err != nil {
		logging.LogErrorf("save attribute view [%s] failed: %s", avID, err)
		return &TxErr{code: TxErrCodeWriteTree, msg: err.Error(), id: avID}
	}

	trees, nodes := getMirrorBlocksNodes(avID)
	for _, node := range nodes {
		attrs := parse.IAL2Map(node.KramdownIAL)
		blockViewID := attrs[av.NodeAttrView]
		if blockViewID == viewID {
			attrs[av.NodeAttrView] = attrView.ViewID
			node.AttributeViewType = string(view.LayoutType)
			// 镜像块节点未关联 tree，通过 blocktree 解析 boxID 以走加密笔记本守卫与 box-aware 缓存键
			boxID := ""
			if bt := treenode.GetBlockTree(node.ID); nil != bt {
				boxID = bt.BoxID
			}
			oldAttrs, e := setNodeAttrs0(node, attrs, boxID)
			if nil != e {
				logging.LogErrorf("set node attrs failed: %s", e)
				continue
			}

			cache.PutBlockIALInBox(node.ID, boxID, parse.IAL2Map(node.KramdownIAL))
			pushBlockAttrs(oldAttrs, node)
		}
	}

	for _, tree := range trees {
		if err = indexWriteTreeUpsertQueue(tree); err != nil {
			return
		}
	}

	operation.RetData = view.LayoutType
	return
}

func getMirrorBlocksNodes(avID string) (trees []*parse.Tree, nodes []*ast.Node) {
	mirrorBlockIDs := treenode.GetMirrorAttrViewBlockIDs(avID)
	mirrorBlockTrees := filesys.LoadTrees(mirrorBlockIDs)
	for id, tree := range mirrorBlockTrees {
		node := treenode.GetNodeInTree(tree, id)
		if nil == node {
			logging.LogErrorf("get node in tree by block ID [%s] failed", id)
			continue
		}
		nodes = append(nodes, node)
	}

	for _, tree := range mirrorBlockTrees {
		trees = append(trees, tree)
	}
	return
}

func (tx *Transaction) doDuplicateAttrViewRow(operation *Operation) (ret *TxErr) {
	srcRowID := ""
	if 0 < len(operation.SrcIDs) {
		srcRowID = operation.SrcIDs[0]
	}
	if "" == srcRowID {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: "source row id is empty"}
	}
	if err := DuplicateAttributeViewRow(tx, operation.AvID, operation.PreviousID, srcRowID, operation.ID); err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func (tx *Transaction) doDuplicateAttrViewView(operation *Operation) (ret *TxErr) {
	var err error
	avID := operation.AvID
	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return &TxErr{code: TxErrHandleAttributeView, id: avID}
	}

	masterView := attrView.GetView(operation.PreviousID)
	if nil == masterView {
		logging.LogErrorf("get master view failed: %s", avID)
		return &TxErr{code: TxErrHandleAttributeView, id: avID}
	}

	node, tree, _ := getNodeByBlockID(nil, operation.BlockID)
	if nil == node {
		logging.LogErrorf("get node by block ID [%s] failed", operation.BlockID)
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID}
	}

	attrs := parse.IAL2Map(node.KramdownIAL)
	attrs[av.NodeAttrView] = operation.ID
	node.AttributeViewType = string(masterView.LayoutType)
	err = setNodeAttrs(node, tree, attrs)
	if err != nil {
		logging.LogWarnf("set node [%s] attrs failed: %s", operation.BlockID, err)
		return
	}

	var view *av.View
	switch masterView.LayoutType {
	case av.LayoutTypeTable:
		view = av.NewTableView()
	case av.LayoutTypeGallery:
		view = av.NewGalleryView()
	case av.LayoutTypeKanban:
		view = av.NewKanbanView()
	}

	view.ID = operation.ID
	attrView.Views = append(attrView.Views, view)
	attrView.ViewID = view.ID

	view.Icon = masterView.Icon
	view.Name = util.GetDuplicateName(masterView.Name)
	view.HideAttrViewName = masterView.HideAttrViewName
	view.Desc = masterView.Desc
	view.LayoutType = masterView.LayoutType
	view.PageSize = masterView.PageSize

	view.Filters = av.CloneFilters(masterView.Filters)

	for _, s := range masterView.Sorts {
		view.Sorts = append(view.Sorts, &av.ViewSort{
			Column: s.Column,
			Order:  s.Order,
		})
	}

	switch masterView.LayoutType {
	case av.LayoutTypeTable:
		for _, col := range masterView.Table.Columns {
			view.Table.Columns = append(view.Table.Columns, &av.ViewTableColumn{
				BaseField: &av.BaseField{
					ID:     col.ID,
					Wrap:   col.Wrap,
					Hidden: col.Hidden,
					Desc:   col.Desc,
				},
				Pin:   col.Pin,
				Width: col.Width,
				Align: col.Align,
				Calc:  col.Calc,
			})
		}

		view.Table.ShowIcon = masterView.Table.ShowIcon
		view.Table.WrapField = masterView.Table.WrapField
	case av.LayoutTypeGallery:
		for _, field := range masterView.Gallery.CardFields {
			view.Gallery.CardFields = append(view.Gallery.CardFields, &av.ViewGalleryCardField{
				BaseField: &av.BaseField{
					ID:     field.ID,
					Wrap:   field.Wrap,
					Hidden: field.Hidden,
					Desc:   field.Desc,
				},
			})
		}

		view.Gallery.CoverFrom = masterView.Gallery.CoverFrom
		view.Gallery.CoverFromAssetKeyID = masterView.Gallery.CoverFromAssetKeyID
		view.Gallery.CardSize = masterView.Gallery.CardSize
		view.Gallery.FitImage = masterView.Gallery.FitImage
		view.Gallery.DisplayFieldName = masterView.Gallery.DisplayFieldName
		view.Gallery.ShowIcon = masterView.Gallery.ShowIcon
		view.Gallery.WrapField = masterView.Gallery.WrapField
	case av.LayoutTypeKanban:
		for _, field := range masterView.Kanban.Fields {
			view.Kanban.Fields = append(view.Kanban.Fields, &av.ViewKanbanField{
				BaseField: &av.BaseField{
					ID:     field.ID,
					Wrap:   field.Wrap,
					Hidden: field.Hidden,
					Desc:   field.Desc,
				},
			})
		}

		view.Kanban.CoverFrom = masterView.Kanban.CoverFrom
		view.Kanban.CoverFromAssetKeyID = masterView.Kanban.CoverFromAssetKeyID
		view.Kanban.CardSize = masterView.Kanban.CardSize
		view.Kanban.FitImage = masterView.Kanban.FitImage
		view.Kanban.DisplayFieldName = masterView.Kanban.DisplayFieldName
		view.Kanban.FillColBackgroundColor = masterView.Kanban.FillColBackgroundColor
		view.Kanban.ShowIcon = masterView.Kanban.ShowIcon
		view.Kanban.WrapField = masterView.Kanban.WrapField
	}

	view.ItemIDs = masterView.ItemIDs

	if nil != masterView.Group {
		view.Group = &av.ViewGroup{}
		if copyErr := copier.Copy(view.Group, masterView.Group); nil != copyErr {
			logging.LogErrorf("copy group failed: %s", copyErr)
			return &TxErr{code: TxErrHandleAttributeView, id: avID, msg: copyErr.Error()}
		}

		view.GroupItemIDs = masterView.GroupItemIDs
		regenAttrViewGroups(attrView)
	}

	if err = av.SaveAttributeView(attrView); err != nil {
		logging.LogErrorf("save attribute view [%s] failed: %s", avID, err)
		return &TxErr{code: TxErrHandleAttributeView, msg: err.Error(), id: avID}
	}
	return
}

func (tx *Transaction) doAddAttrViewView(operation *Operation) (ret *TxErr) {
	err := addAttrViewView(operation.AvID, operation.ID, operation.BlockID, operation.Layout)
	if nil != err {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func addAttrViewView(avID, viewID, blockID string, layout av.LayoutType) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}

	if 1 > len(attrView.Views) {
		logging.LogErrorf("no view in attribute view [%s]", avID)
		return
	}

	firstView := attrView.Views[0]
	if nil == firstView {
		logging.LogErrorf("get first view failed: %s", avID)
		return
	}

	if "" == layout {
		layout = av.LayoutTypeTable
	}

	var view *av.View
	switch layout {
	case av.LayoutTypeTable:
		view = av.NewTableView()
		switch firstView.LayoutType {
		case av.LayoutTypeTable:
			for _, col := range firstView.Table.Columns {
				view.Table.Columns = append(view.Table.Columns, &av.ViewTableColumn{
					BaseField: &av.BaseField{ID: col.ID}, Width: col.Width, Align: col.Align,
				})
			}
		case av.LayoutTypeGallery:
			for _, field := range firstView.Gallery.CardFields {
				view.Table.Columns = append(view.Table.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: field.ID}})
			}
		case av.LayoutTypeKanban:
			for _, field := range firstView.Kanban.Fields {
				view.Table.Columns = append(view.Table.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: field.ID}})
			}
		}
	case av.LayoutTypeGallery:
		view = av.NewGalleryView()
		switch firstView.LayoutType {
		case av.LayoutTypeTable:
			for _, col := range firstView.Table.Columns {
				view.Gallery.CardFields = append(view.Gallery.CardFields, &av.ViewGalleryCardField{BaseField: &av.BaseField{ID: col.ID}})
			}
		case av.LayoutTypeGallery:
			for _, field := range firstView.Gallery.CardFields {
				view.Gallery.CardFields = append(view.Gallery.CardFields, &av.ViewGalleryCardField{BaseField: &av.BaseField{ID: field.ID}})
			}
		case av.LayoutTypeKanban:
			for _, field := range firstView.Kanban.Fields {
				view.Gallery.CardFields = append(view.Gallery.CardFields, &av.ViewGalleryCardField{BaseField: &av.BaseField{ID: field.ID}})
			}
		}
	case av.LayoutTypeKanban:
		view = av.NewKanbanView()
		switch firstView.LayoutType {
		case av.LayoutTypeTable:
			for _, col := range firstView.Table.Columns {
				view.Kanban.Fields = append(view.Kanban.Fields, &av.ViewKanbanField{BaseField: &av.BaseField{ID: col.ID}})
			}
		case av.LayoutTypeGallery:
			for _, field := range firstView.Gallery.CardFields {
				view.Kanban.Fields = append(view.Kanban.Fields, &av.ViewKanbanField{BaseField: &av.BaseField{ID: field.ID}})
			}
		case av.LayoutTypeKanban:
			for _, field := range firstView.Kanban.Fields {
				view.Kanban.Fields = append(view.Kanban.Fields, &av.ViewKanbanField{BaseField: &av.BaseField{ID: field.ID}})
			}
		}
	default:
		err = av.ErrWrongLayoutType
		logging.LogErrorf("wrong layout type [%s] for attribute view [%s]", layout, avID)
		return
	}

	view.ItemIDs = firstView.ItemIDs
	attrView.ViewID = viewID
	view.ID = viewID
	attrView.Views = append(attrView.Views, view)

	if av.LayoutTypeKanban == layout {
		preferredGroupKey := getKanbanPreferredGroupKey(attrView)
		group := &av.ViewGroup{Field: preferredGroupKey.ID}
		setAttributeViewGroup(attrView, view, group)
	}

	node, tree, _ := getNodeByBlockID(nil, blockID)
	if nil == node {
		logging.LogErrorf("get node by block ID [%s] failed", blockID)
		return
	}

	node.AttributeViewType = string(view.LayoutType)
	attrs := parse.IAL2Map(node.KramdownIAL)
	attrs[av.NodeAttrView] = viewID
	err = setNodeAttrs(node, tree, attrs)
	if err != nil {
		logging.LogWarnf("set node [%s] attrs failed: %s", blockID, err)
		return
	}

	if err = av.SaveAttributeView(attrView); err != nil {
		logging.LogErrorf("save attribute view [%s] failed: %s", avID, err)
		return
	}
	return
}

func getKanbanPreferredGroupKey(attrView *av.AttributeView) (ret *av.Key) {
	for _, kv := range attrView.KeyValues {
		if av.KeyTypeSelect == kv.Key.Type {
			ret = kv.Key
			break
		}
	}

	if nil == ret {
		name := av.GetAttributeViewI18n("select")
		ret = av.NewKey(ast.NewNodeID(), name, "", av.KeyTypeSelect)
		attrView.KeyValues = append(attrView.KeyValues, &av.KeyValues{Key: ret})
		for _, view := range attrView.Views {
			newField := &av.BaseField{ID: ret.ID}
			if nil != view.Table {
				newField.Wrap = view.Table.WrapField
				view.Table.Columns = append(view.Table.Columns, &av.ViewTableColumn{BaseField: newField})
			}

			if nil != view.Gallery {
				newField.Wrap = view.Gallery.WrapField
				view.Gallery.CardFields = append(view.Gallery.CardFields, &av.ViewGalleryCardField{BaseField: newField})
			}

			if nil != view.Kanban {
				newField.Wrap = view.Kanban.WrapField
				view.Kanban.Fields = append(view.Kanban.Fields, &av.ViewKanbanField{BaseField: newField})
			}
		}
	}
	return
}

func (tx *Transaction) doSetAttrViewViewName(operation *Operation) (ret *TxErr) {
	var err error
	avID := operation.AvID
	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return &TxErr{code: TxErrHandleAttributeView, id: avID}
	}

	viewID := operation.ID
	view := attrView.GetView(viewID)
	if nil == view {
		logging.LogErrorf("get view [%s] failed: %s", viewID, err)
		return &TxErr{code: TxErrHandleAttributeView, id: viewID}
	}

	view.Name = strings.TrimSpace(operation.Data.(string))
	if err = av.SaveAttributeView(attrView); err != nil {
		logging.LogErrorf("save attribute view [%s] failed: %s", avID, err)
		return &TxErr{code: TxErrHandleAttributeView, msg: err.Error(), id: avID}
	}
	return
}

func (tx *Transaction) doSetAttrViewViewIcon(operation *Operation) (ret *TxErr) {
	var err error
	avID := operation.AvID
	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return &TxErr{code: TxErrHandleAttributeView, id: avID}
	}

	viewID := operation.ID
	view := attrView.GetView(viewID)
	if nil == view {
		logging.LogErrorf("get view [%s] failed: %s", viewID, err)
		return &TxErr{code: TxErrHandleAttributeView, id: viewID}
	}

	view.Icon = operation.Data.(string)
	if err = av.SaveAttributeView(attrView); err != nil {
		logging.LogErrorf("save attribute view [%s] failed: %s", avID, err)
		return &TxErr{code: TxErrHandleAttributeView, msg: err.Error(), id: avID}
	}
	return
}

func (tx *Transaction) doSetAttrViewViewDesc(operation *Operation) (ret *TxErr) {
	var err error
	avID := operation.AvID
	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return &TxErr{code: TxErrHandleAttributeView, id: avID}
	}

	viewID := operation.ID
	view := attrView.GetView(viewID)
	if nil == view {
		logging.LogErrorf("get view [%s] failed: %s", viewID, err)
		return &TxErr{code: TxErrHandleAttributeView, id: viewID}
	}

	view.Desc = strings.TrimSpace(operation.Data.(string))
	if err = av.SaveAttributeView(attrView); err != nil {
		logging.LogErrorf("save attribute view [%s] failed: %s", avID, err)
		return &TxErr{code: TxErrHandleAttributeView, msg: err.Error(), id: avID}
	}
	return
}

func (tx *Transaction) doSetAttrViewName(operation *Operation) (ret *TxErr) {
	err := tx.setAttributeViewName(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func (tx *Transaction) doSetAttrViewNewItemTemplates(operation *Operation) (ret *TxErr) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}

	data, err := gulu.JSON.MarshalJSON(operation.Data)
	if nil != err {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	config := &av.NewItemTemplatesConfig{}
	if err = gulu.JSON.UnmarshalJSON(data, config); nil != err {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	if err = attrView.SetNewItemTemplates(config); nil != err {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	if err = av.SaveAttributeView(attrView); nil != err {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	ReloadAttrView(operation.AvID)
	return
}

const attrAvNameTpl = `<span data-av-id="${avID}" data-popover-url="/api/av/getMirrorDatabaseBlocks" class="popover__block">${avName}</span>`

func (tx *Transaction) setAttributeViewName(operation *Operation) (err error) {
	avID := operation.ID
	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		return
	}

	attrView.Name = strings.TrimSpace(operation.Data.(string))
	attrView.Name = strings.ReplaceAll(attrView.Name, "\n", " ")
	if 512 < utf8.RuneCountInString(attrView.Name) {
		attrView.Name = gulu.Str.SubStr(attrView.Name, 512)
	}
	err = av.SaveAttributeView(attrView)

	_, nodes := tx.getAttrViewBoundNodes(attrView)
	for _, node := range nodes {
		avNames := getAvNames(node.IALAttr(av.NodeAttrNameAvs))
		oldAttrs := parse.IAL2Map(node.KramdownIAL)
		node.SetIALAttr(av.NodeAttrViewNames, avNames)
		pushBlockAttrs(oldAttrs, node)
	}
	return
}

func getAvNames(avIDs string) (ret string) {
	if "" == avIDs {
		return
	}
	avNames := bytes.Buffer{}
	nodeAvIDs := strings.SplitSeq(avIDs, ",")
	for nodeAvID := range nodeAvIDs {
		nodeAvName, getErr := av.GetAttributeViewName(nodeAvID)
		if nil != getErr {
			continue
		}
		if "" == nodeAvName {
			nodeAvName = Conf.language(105)
		}

		tpl := strings.ReplaceAll(attrAvNameTpl, "${avID}", nodeAvID)
		tpl = strings.ReplaceAll(tpl, "${avName}", util.EscapeHTML(nodeAvName))
		avNames.WriteString(tpl)
		avNames.WriteString("&nbsp;")
	}
	if 0 < avNames.Len() {
		avNames.Truncate(avNames.Len() - 6)
		ret = avNames.String()
	}
	return
}

func (tx *Transaction) getAttrViewBoundNodes(attrView *av.AttributeView) (trees map[string]*parse.Tree, nodes []*ast.Node) {
	blockKeyValues := attrView.GetBlockKeyValues()
	if nil == blockKeyValues || nil == blockKeyValues.Values {
		return
	}

	trees = map[string]*parse.Tree{}
	for _, blockKeyValue := range blockKeyValues.Values {
		if blockKeyValue.IsDetached || nil == blockKeyValue.Block {
			continue
		}

		blockID := blockKeyValue.Block.ID
		if "" == blockID {
			continue
		}

		var tree *parse.Tree
		tree = trees[blockID]
		if nil == tree {
			if nil == tx {
				tree, _ = LoadTreeByBlockID(blockID)
			} else {
				tree, _ = tx.loadTree(blockID)
			}
		}
		if nil == tree {
			continue
		}
		trees[blockID] = tree

		node := treenode.GetNodeInTree(tree, blockID)
		if nil == node {
			continue
		}

		nodes = append(nodes, node)
	}
	return
}

func (tx *Transaction) doSetAttrViewFilters(operation *Operation) (ret *TxErr) {
	err := SetAttrViewFilters(operation.AvID, operation.BlockID, operation.Data.([]any))
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

// avParseView 根据 blockID 推导 box 上下文，使用 box-aware 或全局 AV 解析。
func avParseView(avID, blockID string) (*av.AttributeView, error) {
	boxID := deriveAVBoxID(blockID)
	if boxID != "" {
		return av.ParseAttributeViewInBox(avID, boxID)
	}
	return av.ParseAttributeView(avID)
}

// avSaveView 根据 blockID 推导 box 上下文，使用 box-aware 或全局 AV 保存。
func avSaveView(attrView *av.AttributeView, blockID string) error {
	boxID := deriveAVBoxID(blockID)
	if boxID != "" {
		_, parseErr := av.ParseAttributeViewInBox(attrView.ID, boxID)
		if parseErr == nil {
			return av.SaveAttributeView(attrView)
		}
	}
	return av.SaveAttributeView(attrView)
}

// deriveAVBoxID 通过 blockID 反查所在 box。blockID 为空或不是加密 box 时返回空串。
func deriveAVBoxID(blockID string) string {
	if blockID == "" {
		return ""
	}
	bt := treenode.GetBlockTree(blockID)
	if bt == nil {
		for _, encBoxID := range treenode.GetOpenedEncryptedBoxIDs() {
			if encBT := treenode.GetBlockTreeInBox(blockID, encBoxID); encBT != nil {
				bt = encBT
				break
			}
		}
	}
	if bt == nil || !IsEncryptedBox(bt.BoxID) {
		return ""
	}
	return bt.BoxID
}

// SetAttrViewFilters 用新的过滤规则数组整体替换指定视图的过滤规则，并持久化。
// data 为 JSON 反序列化前的 []any（通常是前端传来的过滤节点树）。
func SetAttrViewFilters(avID, blockID string, data []any) (err error) {
	attrView, err := avParseView(avID, blockID)
	if err != nil {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, blockID)
	if err != nil {
		return
	}

	jsonData, err := gulu.JSON.MarshalJSON(data)
	if err != nil {
		return
	}

	var newFilters []*av.ViewFilter
	if err = gulu.JSON.UnmarshalJSON(jsonData, &newFilters); err != nil {
		return
	}
	view.Filters = newFilters

	// 归一化为单一根组：spec 5 起顶层应为一个根组。
	// 兜底旧前端/异常数据发来的扁平叶子数组，在内存里包成 AND 根组后再持久化。
	if 1 != len(view.Filters) || nil == view.Filters[0] || !view.Filters[0].IsGroup() {
		view.Filters = []*av.ViewFilter{{Combination: av.FilterCombinationAnd, Filters: view.Filters}}
	}

	// 限制筛选嵌套深度，防止异常数据创建过深的嵌套分组。
	if err = av.ValidateFilterDepth(view.Filters); nil != err {
		return
	}

	err = avSaveView(attrView, blockID)
	return
}

func (tx *Transaction) doSetAttrViewSorts(operation *Operation) (ret *TxErr) {
	err := SetAttrViewSorts(operation.AvID, operation.BlockID, operation.Data.([]any))
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

// SetAttrViewSorts 用新的排序规则数组整体替换指定视图的排序规则，并持久化。
// data 为 JSON 反序列化前的 []any。
func SetAttrViewSorts(avID, blockID string, data []any) (err error) {
	attrView, err := avParseView(avID, blockID)
	if err != nil {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, blockID)
	if err != nil {
		return
	}

	jsonData, err := gulu.JSON.MarshalJSON(data)
	if err != nil {
		return
	}

	var newSorts []*av.ViewSort
	if err = gulu.JSON.UnmarshalJSON(jsonData, &newSorts); err != nil {
		return
	}
	view.Sorts = newSorts

	err = avSaveView(attrView, blockID)
	return
}

func (tx *Transaction) doSetAttrViewPageSize(operation *Operation) (ret *TxErr) {
	err := setAttributeViewPageSize(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttributeViewPageSize(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if err != nil {
		return
	}

	view.PageSize = int(operation.Data.(float64))

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewColCalc(operation *Operation) (ret *TxErr) {
	err := setAttributeViewColumnCalc(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttributeViewColumnCalc(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if err != nil {
		return
	}

	operationData := operation.Data.(any)
	data, err := gulu.JSON.MarshalJSON(operationData)
	if err != nil {
		return
	}

	calc := &av.FieldCalc{}
	switch view.LayoutType {
	case av.LayoutTypeTable:
		if err = gulu.JSON.UnmarshalJSON(data, calc); err != nil {
			return
		}

		for _, column := range view.Table.Columns {
			if column.ID == operation.ID {
				column.Calc = calc
				break
			}
		}
	case av.LayoutTypeGallery, av.LayoutTypeKanban:
		return
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doInsertAttrViewBlock(operation *Operation) (ret *TxErr) {
	err := AddAttributeViewBlock(tx, operation.Srcs, operation.AvID, operation.BlockID, operation.ViewID, operation.GroupID, operation.PreviousID, operation.IgnoreDefaultFill)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func AddAttributeViewBlock(tx *Transaction, srcs []map[string]any, avID, dbBlockID, viewID, groupID, previousItemID string, ignoreDefaultFill bool) (err error) {
	slices.Reverse(srcs) // https://github.com/siyuan-note/siyuan/issues/11286

	now := time.Now().UnixMilli()
	for _, src := range srcs {
		boundBlockID := ""
		srcItemID := ast.NewNodeID()
		if nil != src["itemID"] {
			srcItemID = src["itemID"].(string)
		}

		isDetached := src["isDetached"].(bool)
		var tree *parse.Tree
		if !isDetached {
			boundBlockID = src["id"].(string)
			if !ast.IsNodeIDPattern(boundBlockID) {
				continue
			}

			var loadErr error
			if nil != tx {
				tree, loadErr = tx.loadTree(boundBlockID)
			} else {
				tree, loadErr = LoadTreeByBlockID(boundBlockID)
			}
			if nil != loadErr {
				logging.LogErrorf("load tree [%s] failed: %s", boundBlockID, loadErr)
				return loadErr
			}
		}

		var srcContent string
		if nil != src["content"] {
			srcContent = src["content"].(string)
		}
		if avErr := addAttributeViewBlock(now, avID, dbBlockID, viewID, groupID, previousItemID, srcItemID, boundBlockID, srcContent, src, isDetached, ignoreDefaultFill, tree, tx); nil != avErr {
			return avErr
		}
	}
	return
}

func addAttributeViewBlock(now int64, avID, dbBlockID, viewID, groupID, previousItemID, addingItemID, addingBoundBlockID, addingBlockContent string, src map[string]any, isDetached, ignoreDefaultFill bool, tree *parse.Tree, tx *Transaction) (err error) {
	var node *ast.Node
	if !isDetached {
		node = treenode.GetNodeInTree(tree, addingBoundBlockID)
		if nil == node {
			err = ErrBlockNotFound
			return
		}
	} else {
		if "" == addingItemID {
			addingItemID = ast.NewNodeID()
			logging.LogWarnf("detached block id is empty, generate a new one [%s]", addingItemID)
		}
	}

	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		return
	}

	var blockIcon string
	if !isDetached {
		blockIcon, addingBlockContent = getNodeAvBlockText(node, "")
		addingBlockContent = util.UnescapeHTML(addingBlockContent)
	}

	// 检查是否重复添加相同的块
	blockValues := attrView.GetBlockKeyValues()
	for _, blockValue := range blockValues.Values {
		if "" != addingBoundBlockID && blockValue.Block.ID == addingBoundBlockID {
			if !isDetached {
				// 重复绑定一下，比如剪切数据库块、取消绑定块后再次添加的场景需要
				bindBlockAv0(tx, avID, node, tree)
				blockValue.IsDetached = isDetached
				blockValue.Block.Icon = blockIcon
				blockValue.Block.Content = addingBlockContent
				blockValue.UpdatedAt = now
				err = av.SaveAttributeView(attrView)
			}

			msg := fmt.Sprintf(Conf.language(269), util.EscapeHTML(getAttrViewName(attrView)))
			util.PushMsg(msg, 5000)
			src["itemID"] = blockValue.BlockID
			return
		}
	}

	blockValue := &av.Value{
		ID:         ast.NewNodeID(),
		KeyID:      blockValues.Key.ID,
		BlockID:    addingItemID,
		Type:       av.KeyTypeBlock,
		IsDetached: isDetached,
		CreatedAt:  now,
		UpdatedAt:  now,
		Block:      &av.ValueBlock{Icon: blockIcon, Content: addingBlockContent, Created: now, Updated: now}}
	if !isDetached {
		blockValue.Block.ID = addingBoundBlockID
	}

	blockValues.Values = append(blockValues.Values, blockValue)

	view, err := getAttrViewViewByBlockID(attrView, dbBlockID)
	if nil != err {
		logging.LogErrorf("get view by block ID [%s] failed: %s", dbBlockID, err)
		return
	}

	if "" != viewID {
		view = attrView.GetView(viewID)
		if nil == view {
			logging.LogErrorf("get view by view ID [%s] failed", viewID)
			return av.ErrViewNotFound
		}
	}

	groupView := view
	if "" != groupID {
		groupView = view.GetGroupByID(groupID)
	}

	if !ignoreDefaultFill {
		fillDefaultValue(attrView, view, groupView, previousItemID, addingItemID, true)
	}

	// 处理日期字段默认填充当前创建时间
	// The database date field supports filling the current time by default https://github.com/siyuan-note/siyuan/issues/10823
	for _, keyValues := range attrView.KeyValues {
		if av.KeyTypeDate == keyValues.Key.Type && nil != keyValues.Key.Date && keyValues.Key.Date.AutoFillNow {
			val := keyValues.GetValue(addingItemID)
			if nil == val { // 避免覆盖已有值（可能前面已经通过过滤或者分组条件填充了值）
				dateVal := &av.Value{
					ID: ast.NewNodeID(), KeyID: keyValues.Key.ID, BlockID: addingItemID, Type: av.KeyTypeDate, IsDetached: isDetached, CreatedAt: now, UpdatedAt: now + 1000,
					Date: &av.ValueDate{Content: now, IsNotEmpty: true, IsNotTime: !keyValues.Key.Date.FillSpecificTime},
				}
				keyValues.Values = append(keyValues.Values, dateVal)
			} else {
				if val.IsRenderAutoFill {
					val.CreatedAt, val.UpdatedAt = now, now+1000
					val.Date.Content, val.Date.IsNotEmpty, val.Date.IsNotTime = now, true, !keyValues.Key.Date.FillSpecificTime
					val.IsRenderAutoFill = false
				}
			}
		}
	}

	if !isDetached {
		bindBlockAv0(tx, avID, node, tree)
	}

	// 在所有视图上添加项目
	for _, v := range attrView.Views {
		if "" != previousItemID {
			changed := false
			for i, id := range v.ItemIDs {
				if id == previousItemID {
					v.ItemIDs = append(v.ItemIDs[:i+1], append([]string{addingItemID}, v.ItemIDs[i+1:]...)...)
					changed = true
					break
				}
			}
			if !changed {
				v.ItemIDs = append(v.ItemIDs, addingItemID)
			}
		} else {
			v.ItemIDs = append([]string{addingItemID}, v.ItemIDs...)
		}

		// 在所有分组视图中添加，目的是为了在重新分组的过程中保住排序状态 https://github.com/siyuan-note/siyuan/issues/15560
		for _, g := range v.Groups {
			if "" != previousItemID {
				changed := false
				for i, id := range g.GroupItemIDs {
					if id == previousItemID {
						g.GroupItemIDs = append(g.GroupItemIDs[:i+1], append([]string{addingItemID}, g.GroupItemIDs[i+1:]...)...)
						changed = true
						break
					}
				}
				if !changed {
					g.GroupItemIDs = append(g.GroupItemIDs, addingItemID)
				}
			} else {
				g.GroupItemIDs = append([]string{addingItemID}, g.GroupItemIDs...)
			}
		}
	}

	regenAttrViewGroups(attrView)
	err = av.SaveAttributeView(attrView)
	return
}

func fillDefaultValue(attrView *av.AttributeView, view, groupView *av.View, previousItemID, addingItemID string, isCreate bool) {
	defaultValues := getAttrViewAddingBlockDefaultValues(attrView, view, groupView, previousItemID, addingItemID, isCreate)
	for keyID, newValue := range defaultValues {
		newValue.BlockID = addingItemID
		keyValues, getErr := attrView.GetKeyValues(keyID)
		if nil != getErr {
			continue
		}

		if av.KeyTypeRollup == newValue.Type {
			// 汇总字段的值是渲染时计算的，不需要添加到数据存储中
			continue
		}

		if (av.KeyTypeSelect == newValue.Type || av.KeyTypeMSelect == newValue.Type) && 1 > len(newValue.MSelect) && groupValueDefault != groupView.GetGroupValue() {
			// 单选或多选类型的值可能需要从分组条件中获取默认值
			if opt := keyValues.Key.GetOption(groupView.GetGroupValue()); nil != opt {
				newValue.MSelect = append(newValue.MSelect, &av.ValueSelect{Content: opt.Name, Color: opt.Color})
			}
		}

		if av.KeyTypeRelation == newValue.Type && nil != keyValues.Key.Relation && keyValues.Key.Relation.IsTwoWay {
			// 双向关联需要同时更新目标字段的值
			updateTwoWayRelationDestAttrView(attrView, keyValues.Key, newValue, 1, []string{})
		}

		existingVal := keyValues.GetValue(addingItemID)
		if nil == existingVal {
			newValue.IsRenderAutoFill = false
			keyValues.Values = append(keyValues.Values, newValue)
		} else {
			newValueRaw := newValue.GetValByType(keyValues.Key.Type)
			if av.KeyTypeBlock != existingVal.Type || (av.KeyTypeBlock == existingVal.Type && existingVal.IsDetached) {
				// 非主键的值直接覆盖，主键的值只覆盖非绑定块
				existingVal.IsRenderAutoFill = false
				existingVal.SetValByType(keyValues.Key.Type, newValueRaw)
			}
		}
	}
}

func getNewValueByNearItem(nearItem av.Item, key *av.Key, addingBlockID string) (ret *av.Value) {
	if nil == nearItem {
		return
	}

	defaultVal := nearItem.GetValue(key.ID)
	ret = defaultVal.Clone()
	ret.ID = ast.NewNodeID()
	ret.KeyID = key.ID
	ret.BlockID = addingBlockID
	ret.CreatedAt = util.CurrentTimeMillis()
	ret.UpdatedAt = ret.CreatedAt + 1000
	return
}

func getNearItem(attrView *av.AttributeView, view, groupView *av.View, previousItemID string) (ret av.Item) {
	cachedAttrViews := map[string]*av.AttributeView{}
	rollupFurtherCollections := sql.GetFurtherCollections(attrView, cachedAttrViews)
	viewable := sql.RenderGroupView(attrView, view, groupView, "")
	av.Filter(viewable, attrView, rollupFurtherCollections, cachedAttrViews)
	av.Sort(viewable, attrView)
	items := viewable.(av.Collection).GetItems()
	if 0 < len(items) {
		if "" != previousItemID {
			for _, row := range items {
				if row.GetID() == previousItemID {
					ret = row
					return
				}
			}
		} else {
			if 0 < len(items) {
				ret = items[0]
				return
			}
		}
	}
	return
}

func (tx *Transaction) doRemoveAttrViewBlock(operation *Operation) (ret *TxErr) {
	err := removeAttributeViewBlock(operation.SrcIDs, operation.AvID, tx)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID}
	}
	return
}

func RemoveAttributeViewBlock(srcIDs []string, avID string) (err error) {
	err = removeAttributeViewBlock(srcIDs, avID, nil)
	return
}

func removeAttributeViewBlock(srcIDs []string, avID string, tx *Transaction) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		return
	}
	relationDestAvIDs := map[string]bool{}
	for _, keyValues := range attrView.KeyValues {
		if av.KeyTypeRelation != keyValues.Key.Type || nil == keyValues.Key.Relation {
			continue
		}
		for _, value := range keyValues.Values {
			if gulu.Str.Contains(value.BlockID, srcIDs) {
				relationDestAvIDs[keyValues.Key.Relation.AvID] = true
				break
			}
		}
	}

	trees := map[string]*parse.Tree{}
	for _, keyValues := range attrView.KeyValues {
		tmp := keyValues.Values[:0]
		for i, val := range keyValues.Values {
			if !gulu.Str.Contains(val.BlockID, srcIDs) {
				tmp = append(tmp, keyValues.Values[i])
			} else {
				// Remove av block also remove node attr https://github.com/siyuan-note/siyuan/issues/9091#issuecomment-1709824006
				if !val.IsDetached && nil != val.Block {
					bt := treenode.GetBlockTree(val.Block.ID)
					if nil == bt {
						for _, encBoxID := range treenode.GetOpenedEncryptedBoxIDs() {
							if encBT := treenode.GetBlockTreeInBox(val.Block.ID, encBoxID); nil != encBT {
								bt = encBT
								break
							}
						}
					}
					if nil != bt {
						tree := trees[bt.RootID]
						if nil == tree {
							tree, _ = LoadTreeByBlockID(val.Block.ID)
						}

						if nil != tree {
							trees[bt.RootID] = tree
							if node := treenode.GetNodeInTree(tree, val.Block.ID); nil != node {
								if err = removeNodeAvID(node, avID, tx, tree); err != nil {
									return
								}
							}
						}
					}
				}
			}
		}
		keyValues.Values = tmp
	}

	for _, view := range attrView.Views {
		for _, blockID := range srcIDs {
			view.ItemIDs = gulu.Str.RemoveElem(view.ItemIDs, blockID)
		}
	}
	attrView.RemoveNewItemTemplateRelationItems(avID, srcIDs)

	regenAttrViewGroups(attrView)

	err = av.SaveAttributeView(attrView)
	if nil != err {
		return
	}
	if err = removeRelatedNewItemTemplateRelationItems(avID, srcIDs); nil != err {
		return
	}

	refreshRelatedSrcAvs(avID, tx)
	for destAvID := range relationDestAvIDs {
		if "" != destAvID && destAvID != avID {
			ReloadAttrView(destAvID)
		}
	}

	historyDir, err := getHistoryDir(HistoryOpUpdate)
	if err != nil {
		logging.LogErrorf("get history dir failed: %s", err)
		return
	}
	blockIDs := treenode.GetMirrorAttrViewBlockIDs(avID)
	for _, blockID := range blockIDs {
		tree := trees[blockID]
		if nil == tree {
			tree, _ = LoadTreeByBlockID(blockID)
		}
		if nil == tree {
			continue
		}

		historyPath := filepath.Join(historyDir, tree.Box, tree.Path)
		absPath := filepath.Join(util.DataDir, tree.Box, tree.Path)
		if err = filelock.Copy(absPath, historyPath); err != nil {
			logging.LogErrorf("backup [path=%s] to history [%s] failed: %s", absPath, historyPath, err)
			return
		}
	}

	srcAvPath, _ := av.FindAttributeViewPath(avID)
	if srcAvPath == "" {
		return
	}
	destAvPath := filepath.Join(historyDir, "storage", "av", avID+".json")
	if copyErr := filelock.Copy(srcAvPath, destAvPath); nil != copyErr {
		logging.LogErrorf("copy av [%s] failed: %s", srcAvPath, copyErr)
	}

	indexHistoryDir(filepath.Base(historyDir), util.NewLute())
	return
}

func removeRelatedNewItemTemplateRelationItems(avID string, itemIDs []string) (err error) {
	for _, relatedAvID := range av.GetSrcAvIDs(avID) {
		if relatedAvID == avID {
			continue
		}
		relatedAv, parseErr := av.ParseAttributeView(relatedAvID)
		if nil != parseErr || nil == relatedAv {
			continue
		}
		if !relatedAv.RemoveNewItemTemplateRelationItems(avID, itemIDs) {
			continue
		}
		if err = av.SaveAttributeView(relatedAv); nil != err {
			return
		}
		ReloadAttrView(relatedAvID)
	}
	return
}

func removeNodeAvID(node *ast.Node, avID string, tx *Transaction, tree *parse.Tree) (err error) {
	attrs := parse.IAL2Map(node.KramdownIAL)
	if ast.NodeDocument == node.Type && !IsBoxDoc(tree.Box, tree.ID) {
		delete(attrs, DocHiddenAttr)
		node.RemoveIALAttr(DocHiddenAttr)
	}

	if avs := attrs[av.NodeAttrNameAvs]; "" != avs {
		avIDs := strings.Split(avs, ",")
		avIDs = gulu.Str.RemoveElem(avIDs, avID)
		var existAvIDs []string
		for _, attributeViewID := range avIDs {
			if av.IsAttributeViewExist(attributeViewID) {
				existAvIDs = append(existAvIDs, attributeViewID)
			}
		}
		avIDs = existAvIDs

		if 0 == len(avIDs) {
			attrs[av.NodeAttrNameAvs] = ""
		} else {
			attrs[av.NodeAttrNameAvs] = strings.Join(avIDs, ",")
			node.SetIALAttr(av.NodeAttrNameAvs, strings.Join(avIDs, ","))
			avNames := getAvNames(node.IALAttr(av.NodeAttrNameAvs))
			attrs[av.NodeAttrViewNames] = avNames
		}
	}

	if nil != tx {
		if err = setNodeAttrsWithTx(tx, node, tree, attrs); err != nil {
			return
		}
	} else {
		if err = setNodeAttrs(node, tree, attrs); err != nil {
			return
		}
	}
	return
}

func (tx *Transaction) doDuplicateAttrViewKey(operation *Operation) (ret *TxErr) {
	err := duplicateAttributeViewKey(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func duplicateAttributeViewKey(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	key, _ := attrView.GetKey(operation.KeyID)
	if nil == key {
		return
	}

	if av.KeyTypeBlock == key.Type || av.KeyTypeRelation == key.Type {
		return
	}

	copyKey := &av.Key{}
	if err = copier.Copy(copyKey, key); err != nil {
		logging.LogErrorf("clone key failed: %s", err)
	}
	copyKey.ID = operation.NextID
	copyKey.Name = util.GetDuplicateName(key.Name)

	attrView.KeyValues = append(attrView.KeyValues, &av.KeyValues{Key: copyKey})

	for _, view := range attrView.Views {
		switch view.LayoutType {
		case av.LayoutTypeTable:
			for i, column := range view.Table.Columns {
				if column.ID == key.ID {
					view.Table.Columns = append(view.Table.Columns[:i+1], append([]*av.ViewTableColumn{
						{
							BaseField: &av.BaseField{
								ID:     copyKey.ID,
								Wrap:   column.Wrap,
								Hidden: column.Hidden,
								Desc:   column.Desc,
							},
							Pin:   column.Pin,
							Width: column.Width,
							Align: column.Align,
						},
					}, view.Table.Columns[i+1:]...)...)
					break
				}
			}
		case av.LayoutTypeGallery:
			for i, field := range view.Gallery.CardFields {
				if field.ID == key.ID {
					view.Gallery.CardFields = append(view.Gallery.CardFields[:i+1], append([]*av.ViewGalleryCardField{
						{
							BaseField: &av.BaseField{
								ID:     copyKey.ID,
								Wrap:   field.Wrap,
								Hidden: field.Hidden,
								Desc:   field.Desc,
							},
						},
					}, view.Gallery.CardFields[i+1:]...)...)
					break
				}
			}
		case av.LayoutTypeKanban:
			for i, field := range view.Kanban.Fields {
				if field.ID == key.ID {
					view.Kanban.Fields = append(view.Kanban.Fields[:i+1], append([]*av.ViewKanbanField{
						{
							BaseField: &av.BaseField{
								ID:     copyKey.ID,
								Wrap:   field.Wrap,
								Hidden: field.Hidden,
								Desc:   field.Desc,
							},
						},
					}, view.Kanban.Fields[i+1:]...)...)
					break
				}
			}
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewColumnWidth(operation *Operation) (ret *TxErr) {
	err := setAttributeViewColWidth(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttributeViewColWidth(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if err != nil {
		return
	}

	switch view.LayoutType {
	case av.LayoutTypeTable:
		for _, column := range view.Table.Columns {
			if column.ID == operation.ID {
				column.Width = operation.Data.(string)
				break
			}
		}
	case av.LayoutTypeGallery, av.LayoutTypeKanban:
		return
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewColumnAlign(operation *Operation) (ret *TxErr) {
	err := setAttributeViewColAlign(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttributeViewColAlign(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if err != nil {
		return
	}

	if av.LayoutTypeTable != view.LayoutType {
		return
	}

	alignValue, ok := operation.Data.(string)
	align := av.TableColumnAlign(alignValue)
	if !ok || !align.IsValid() {
		return av.ErrInvalidColumnAlign
	}
	for _, column := range view.Table.Columns {
		if column.ID == operation.ID {
			column.Align = align
			break
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewColumnWrap(operation *Operation) (ret *TxErr) {
	err := setAttributeViewColWrap(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttributeViewColWrap(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if err != nil {
		return
	}

	newWrap := operation.Data.(bool)
	allFieldWrap := true
	switch view.LayoutType {
	case av.LayoutTypeTable:
		for _, column := range view.Table.Columns {
			if column.ID == operation.ID {
				column.Wrap = newWrap
			}
			allFieldWrap = allFieldWrap && column.Wrap
		}
		view.Table.WrapField = allFieldWrap
	case av.LayoutTypeGallery:
		for _, field := range view.Gallery.CardFields {
			if field.ID == operation.ID {
				field.Wrap = newWrap
			}
			allFieldWrap = allFieldWrap && field.Wrap
		}
		view.Gallery.WrapField = allFieldWrap
	case av.LayoutTypeKanban:
		for _, field := range view.Kanban.Fields {
			if field.ID == operation.ID {
				field.Wrap = newWrap
			}
			allFieldWrap = allFieldWrap && field.Wrap
		}
		view.Kanban.WrapField = allFieldWrap
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewColumnHidden(operation *Operation) (ret *TxErr) {
	err := setAttributeViewColHidden(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttributeViewColHidden(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if err != nil {
		return
	}

	switch view.LayoutType {
	case av.LayoutTypeTable:
		for _, column := range view.Table.Columns {
			if column.ID == operation.ID {
				column.Hidden = operation.Data.(bool)
				break
			}
		}
	case av.LayoutTypeGallery:
		for _, field := range view.Gallery.CardFields {
			if field.ID == operation.ID {
				field.Hidden = operation.Data.(bool)
				break
			}
		}
	case av.LayoutTypeKanban:
		for _, field := range view.Kanban.Fields {
			if field.ID == operation.ID {
				field.Hidden = operation.Data.(bool)
				break
			}
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewColumnPin(operation *Operation) (ret *TxErr) {
	err := setAttributeViewColPin(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttributeViewColPin(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if err != nil {
		return
	}

	switch view.LayoutType {
	case av.LayoutTypeTable:
		for _, column := range view.Table.Columns {
			if column.ID == operation.ID {
				column.Pin = operation.Data.(bool)
				break
			}
		}
	case av.LayoutTypeGallery, av.LayoutTypeKanban:
		return
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewColumnIcon(operation *Operation) (ret *TxErr) {
	err := setAttributeViewColIcon(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttributeViewColIcon(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	for _, keyValues := range attrView.KeyValues {
		if keyValues.Key.ID == operation.ID {
			keyValues.Key.Icon = operation.Data.(string)
			break
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewColumnDesc(operation *Operation) (ret *TxErr) {
	err := setAttributeViewColDesc(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttributeViewColDesc(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	for _, keyValues := range attrView.KeyValues {
		if keyValues.Key.ID == operation.ID {
			keyValues.Key.Desc = operation.Data.(string)
			break
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSortAttrViewRow(operation *Operation) (ret *TxErr) {
	err := sortAttributeViewRow(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func sortAttributeViewRow(operation *Operation) (err error) {
	if operation.ID == operation.PreviousID {
		// 拖拽到自己的下方，不做任何操作 https://github.com/siyuan-note/siyuan/issues/11048
		return
	}

	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if err != nil {
		return
	}

	var itemID string
	var idx, previousIndex int

	if nil != view.Group && "" != operation.GroupID {
		if groupView := view.GetGroupByID(operation.GroupID); nil != groupView {
			groupKey := view.GetGroupKey(attrView)
			isAcrossGroup := operation.GroupID != operation.TargetGroupID
			if isAcrossGroup && (av.KeyTypeTemplate == groupKey.Type || av.KeyTypeCreated == groupKey.Type || av.KeyTypeUpdated == groupKey.Type) {
				// 这些字段类型不支持跨分组移动，因为它们的值是自动计算生成的
				return
			}

			for i, id := range groupView.GroupItemIDs {
				if id == operation.ID {
					itemID = id
					idx = i
					break
				}
			}
			if "" == itemID {
				itemID = operation.ID
				groupView.GroupItemIDs = append(groupView.GroupItemIDs, itemID)
				idx = len(groupView.GroupItemIDs) - 1
			}
			groupView.GroupItemIDs = append(groupView.GroupItemIDs[:idx], groupView.GroupItemIDs[idx+1:]...)

			if isAcrossGroup {
				if targetGroupView := view.GetGroupByID(operation.TargetGroupID); nil != targetGroupView && !gulu.Str.Contains(itemID, targetGroupView.GroupItemIDs) {
					fillDefaultValue(attrView, view, targetGroupView, operation.PreviousID, itemID, false)

					if val := attrView.GetValue(groupKey.ID, itemID); nil != val {
						if av.MSelectExistOption(val.MSelect, groupView.GetGroupValue()) {
							// 移除旧分组的值
							val.MSelect = av.MSelectRemoveOption(val.MSelect, groupView.GetGroupValue())
						}

						now := time.Now().UnixMilli()
						val.SetUpdatedAt(now)
						if blockVal := attrView.GetBlockValue(itemID); nil != blockVal {
							blockVal.Block.Updated = now
							blockVal.SetUpdatedAt(now)
						}
					}

					for i, r := range targetGroupView.GroupItemIDs {
						if r == operation.PreviousID {
							previousIndex = i + 1
							break
						}
					}
					targetGroupView.GroupItemIDs = util.InsertElem(targetGroupView.GroupItemIDs, previousIndex, itemID)
				}

				regenAttrViewGroups(attrView)
			} else { // 同分组内排序
				for i, r := range groupView.GroupItemIDs {
					if r == operation.PreviousID {
						previousIndex = i + 1
						break
					}
				}
				groupView.GroupItemIDs = util.InsertElem(groupView.GroupItemIDs, previousIndex, itemID)
			}
		}
	} else {
		for i, id := range view.ItemIDs {
			if id == operation.ID {
				itemID = id
				idx = i
				break
			}
		}
		if "" == itemID {
			itemID = operation.ID
			view.ItemIDs = append(view.ItemIDs, itemID)
			idx = len(view.ItemIDs) - 1
		}

		view.ItemIDs = append(view.ItemIDs[:idx], view.ItemIDs[idx+1:]...)
		for i, r := range view.ItemIDs {
			if r == operation.PreviousID {
				previousIndex = i + 1
				break
			}
		}
		view.ItemIDs = util.InsertElem(view.ItemIDs, previousIndex, itemID)
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSortAttrViewColumn(operation *Operation) (ret *TxErr) {
	err := SortAttributeViewViewKey(operation.AvID, operation.BlockID, operation.ID, operation.PreviousID)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func SortAttributeViewViewKey(avID, blockID, keyID, previousKeyID string) (err error) {
	if keyID == previousKeyID {
		// 拖拽到自己的右侧，不做任何操作 https://github.com/siyuan-note/siyuan/issues/11048
		return
	}

	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, blockID)
	if err != nil {
		return
	}

	var curIndex, previousIndex int
	switch view.LayoutType {
	case av.LayoutTypeTable:
		var col *av.ViewTableColumn
		for i, column := range view.Table.Columns {
			if column.ID == keyID {
				col = column
				curIndex = i
				break
			}
		}
		if nil == col {
			return
		}

		view.Table.Columns = append(view.Table.Columns[:curIndex], view.Table.Columns[curIndex+1:]...)
		for i, column := range view.Table.Columns {
			if column.ID == previousKeyID {
				previousIndex = i + 1
				break
			}
		}
		view.Table.Columns = util.InsertElem(view.Table.Columns, previousIndex, col)
	case av.LayoutTypeGallery:
		var field *av.ViewGalleryCardField
		for i, cardField := range view.Gallery.CardFields {
			if cardField.ID == keyID {
				field = cardField
				curIndex = i
				break
			}
		}
		if nil == field {
			return
		}

		view.Gallery.CardFields = append(view.Gallery.CardFields[:curIndex], view.Gallery.CardFields[curIndex+1:]...)
		for i, cardField := range view.Gallery.CardFields {
			if cardField.ID == previousKeyID {
				previousIndex = i + 1
				break
			}
		}
		view.Gallery.CardFields = util.InsertElem(view.Gallery.CardFields, previousIndex, field)
	case av.LayoutTypeKanban:
		var field *av.ViewKanbanField
		for i, kanbanField := range view.Kanban.Fields {
			if kanbanField.ID == keyID {
				field = kanbanField
				curIndex = i
				break
			}
		}
		if nil == field {
			return
		}

		view.Kanban.Fields = append(view.Kanban.Fields[:curIndex], view.Kanban.Fields[curIndex+1:]...)
		for i, kanbanField := range view.Kanban.Fields {
			if kanbanField.ID == previousKeyID {
				previousIndex = i + 1
				break
			}
		}
		view.Kanban.Fields = util.InsertElem(view.Kanban.Fields, previousIndex, field)
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSortAttrViewKey(operation *Operation) (ret *TxErr) {
	err := SortAttributeViewKey(operation.AvID, operation.ID, operation.PreviousID)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func SortAttributeViewKey(avID, keyID, previousKeyID string) (err error) {
	if keyID == previousKeyID {
		return
	}

	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		return
	}

	refreshAttrViewKeyIDs(attrView, false)

	var currentKeyID string
	var idx, previousIndex int
	for i, k := range attrView.KeyIDs {
		if k == keyID {
			currentKeyID = k
			idx = i
			break
		}
	}
	if "" == currentKeyID {
		return
	}

	attrView.KeyIDs = append(attrView.KeyIDs[:idx], attrView.KeyIDs[idx+1:]...)

	for i, k := range attrView.KeyIDs {
		if k == previousKeyID {
			previousIndex = i + 1
			break
		}
	}
	attrView.KeyIDs = util.InsertElem(attrView.KeyIDs, previousIndex, currentKeyID)

	err = av.SaveAttributeView(attrView)
	return
}

func refreshAttrViewKeyIDs(attrView *av.AttributeView, needSave bool) {
	// 订正 keyIDs 数据

	existKeyIDs := map[string]bool{}
	for _, keyValues := range attrView.KeyValues {
		existKeyIDs[keyValues.Key.ID] = true
	}

	for k := range existKeyIDs {
		if !gulu.Str.Contains(k, attrView.KeyIDs) {
			attrView.KeyIDs = append(attrView.KeyIDs, k)
		}
	}

	var tmp []string
	for _, k := range attrView.KeyIDs {
		if ok := existKeyIDs[k]; ok {
			tmp = append(tmp, k)
		}
	}
	attrView.KeyIDs = tmp

	if needSave {
		av.SaveAttributeView(attrView)
	}
}

func (tx *Transaction) doAddAttrViewColumn(operation *Operation) (ret *TxErr) {
	var icon string
	if nil != operation.Data {
		icon = operation.Data.(string)
	}
	err := AddAttributeViewKey(operation.AvID, operation.ID, operation.Name, operation.Typ, icon, operation.PreviousID)

	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func AddAttributeViewKey(avID, keyID, keyName, keyType, keyIcon, previousKeyID string) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		return
	}

	currentView, err := attrView.GetCurrentView(attrView.ViewID)
	if nil != err {
		return
	}

	keyTyp := av.KeyType(keyType)
	switch keyTyp {
	case av.KeyTypeText, av.KeyTypeNumber, av.KeyTypeDate, av.KeyTypeSelect, av.KeyTypeMSelect, av.KeyTypeURL, av.KeyTypeEmail,
		av.KeyTypePhone, av.KeyTypeMAsset, av.KeyTypeTemplate, av.KeyTypeCreated, av.KeyTypeUpdated, av.KeyTypeCheckbox,
		av.KeyTypeRelation, av.KeyTypeRollup, av.KeyTypeLineNumber:

		key := av.NewKey(keyID, keyName, keyIcon, keyTyp)
		if av.KeyTypeRollup == keyTyp {
			key.Rollup = &av.Rollup{Calc: &av.RollupCalc{Operator: av.CalcOperatorNone}}
		}

		attrView.KeyValues = append(attrView.KeyValues, &av.KeyValues{Key: key})

		for _, view := range attrView.Views {
			newField := &av.BaseField{ID: key.ID}
			if nil != view.Table {
				newField.Wrap = view.Table.WrapField

				if "" == previousKeyID {
					if av.LayoutTypeGallery == currentView.LayoutType || av.LayoutTypeKanban == currentView.LayoutType {
						// 如果当前视图是卡片或看板视图则添加到最后
						view.Table.Columns = append(view.Table.Columns, &av.ViewTableColumn{BaseField: newField})
					} else {
						view.Table.Columns = append([]*av.ViewTableColumn{{BaseField: newField}}, view.Table.Columns...)
					}
				} else {
					added := false
					for i, column := range view.Table.Columns {
						if column.ID == previousKeyID {
							view.Table.Columns = append(view.Table.Columns[:i+1], append([]*av.ViewTableColumn{{BaseField: newField}}, view.Table.Columns[i+1:]...)...)
							added = true
							break
						}
					}
					if !added {
						view.Table.Columns = append(view.Table.Columns, &av.ViewTableColumn{BaseField: newField})
					}
				}
			}

			if nil != view.Gallery {
				newField.Wrap = view.Gallery.WrapField

				if "" == previousKeyID {
					view.Gallery.CardFields = append(view.Gallery.CardFields, &av.ViewGalleryCardField{BaseField: newField})
				} else {
					added := false
					for i, field := range view.Gallery.CardFields {
						if field.ID == previousKeyID {
							view.Gallery.CardFields = append(view.Gallery.CardFields[:i+1], append([]*av.ViewGalleryCardField{{BaseField: newField}}, view.Gallery.CardFields[i+1:]...)...)
							added = true
							break
						}
					}
					if !added {
						view.Gallery.CardFields = append(view.Gallery.CardFields, &av.ViewGalleryCardField{BaseField: newField})
					}
				}
			}

			if nil != view.Kanban {
				newField.Wrap = view.Kanban.WrapField

				if "" == previousKeyID {
					view.Kanban.Fields = append(view.Kanban.Fields, &av.ViewKanbanField{BaseField: newField})
				} else {
					added := false
					for i, field := range view.Kanban.Fields {
						if field.ID == previousKeyID {
							view.Kanban.Fields = append(view.Kanban.Fields[:i+1], append([]*av.ViewKanbanField{{BaseField: newField}}, view.Kanban.Fields[i+1:]...)...)
							added = true
							break
						}
					}
					if !added {
						view.Kanban.Fields = append(view.Kanban.Fields, &av.ViewKanbanField{BaseField: newField})
					}
				}
			}
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doUpdateAttrViewColTemplate(operation *Operation) (ret *TxErr) {
	err := updateAttributeViewColTemplate(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func updateAttributeViewColTemplate(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	colType := av.KeyType(operation.Typ)
	switch colType {
	case av.KeyTypeTemplate:
		for _, keyValues := range attrView.KeyValues {
			if keyValues.Key.ID == operation.ID && av.KeyTypeTemplate == keyValues.Key.Type {
				keyValues.Key.Template = operation.Data.(string)
				break
			}
		}
	}

	regenAttrViewGroups(attrView)
	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doUpdateAttrViewColNumberFormat(operation *Operation) (ret *TxErr) {
	err := updateAttributeViewColNumberFormat(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func updateAttributeViewColNumberFormat(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	colType := av.KeyType(operation.Typ)
	switch colType {
	case av.KeyTypeNumber:
		for _, keyValues := range attrView.KeyValues {
			if keyValues.Key.ID == operation.ID && av.KeyTypeNumber == keyValues.Key.Type {
				keyValues.Key.NumberFormat = av.NumberFormat(operation.Format)
				break
			}
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doUpdateAttrViewColumn(operation *Operation) (ret *TxErr) {
	err := updateAttributeViewColumn(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func updateAttributeViewColumn(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	colType := av.KeyType(operation.Typ)
	changeType := false
	switch colType {
	case av.KeyTypeBlock, av.KeyTypeText, av.KeyTypeNumber, av.KeyTypeDate, av.KeyTypeSelect, av.KeyTypeMSelect, av.KeyTypeURL, av.KeyTypeEmail,
		av.KeyTypePhone, av.KeyTypeMAsset, av.KeyTypeTemplate, av.KeyTypeCreated, av.KeyTypeUpdated, av.KeyTypeCheckbox,
		av.KeyTypeRelation, av.KeyTypeRollup, av.KeyTypeLineNumber:
		for _, keyValues := range attrView.KeyValues {
			if keyValues.Key.ID == operation.ID {
				isPrimaryKey := av.KeyTypeBlock == keyValues.Key.Type
				if isPrimaryKey != (av.KeyTypeBlock == colType) {
					if isPrimaryKey {
						err = errors.New("cannot change type of primary key field")
					} else {
						err = errors.New("cannot change field type to primary key")
					}
					return
				}

				keyValues.Key.Name = strings.TrimSpace(operation.Name)

				changeType = keyValues.Key.Type != colType
				keyValues.Key.Type = colType

				for _, value := range keyValues.Values {
					value.Type = colType
				}

				break
			}
		}
	}

	if changeType {
		attrView.RemoveNewItemTemplateFieldValue(operation.ID)
		for _, view := range attrView.Views {
			if nil != view.Group {
				if groupKey := view.GetGroupKey(attrView); nil != groupKey && groupKey.ID == operation.ID {
					removeAttributeViewGroup0(view)
				}
			}
		}
	}

	if err = av.SaveAttributeView(attrView); nil != err {
		return
	}

	if changeType {
		relatedAvIDs := av.GetSrcAvIDs(attrView.ID)
		for _, relatedAvID := range relatedAvIDs {
			destAv, _ := av.ParseAttributeView(relatedAvID)
			if nil == destAv {
				continue
			}

			for _, keyValues := range destAv.KeyValues {
				if av.KeyTypeRollup == keyValues.Key.Type && keyValues.Key.Rollup.KeyID == operation.ID {
					// 置空关联过来的汇总
					for _, val := range keyValues.Values {
						val.Rollup.Contents = nil
					}
					keyValues.Key.Rollup.Calc = &av.RollupCalc{Operator: av.CalcOperatorNone}
				}
			}

			regenAttrViewGroups(destAv)
			av.SaveAttributeView(destAv)
			ReloadAttrView(destAv.ID)
		}
	}
	return
}

func (tx *Transaction) doRemoveAttrViewColumn(operation *Operation) (ret *TxErr) {
	err := RemoveAttributeViewKey(operation.AvID, operation.ID, operation.RemoveDest)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func RemoveAttributeViewKey(avID, keyID string, removeRelationDest bool) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		return
	}

	key, keyErr := attrView.GetKey(keyID)
	if nil != keyErr {
		err = keyErr
		return
	}
	if av.KeyTypeBlock == key.Type {
		err = errors.New("cannot remove primary key field")
		return
	}

	var removedKey *av.Key
	for i, keyValues := range attrView.KeyValues {
		if keyValues.Key.ID == keyID {
			attrView.KeyValues = append(attrView.KeyValues[:i], attrView.KeyValues[i+1:]...)
			removedKey = keyValues.Key
			attrView.RemoveNewItemTemplateFieldValue(keyID)
			break
		}
	}
	if nil != removedKey && av.KeyTypeRelation == removedKey.Type && nil != removedKey.Relation {
		if removedKey.Relation.IsTwoWay {
			var destAv *av.AttributeView
			if avID == removedKey.Relation.AvID {
				destAv = attrView
			} else {
				destAv, _ = av.ParseAttributeView(removedKey.Relation.AvID)
			}

			if nil != destAv {
				oldDestKey, _ := destAv.GetKey(removedKey.Relation.BackKeyID)
				if nil != oldDestKey && nil != oldDestKey.Relation && oldDestKey.Relation.AvID == attrView.ID && oldDestKey.Relation.IsTwoWay {
					oldDestKey.Relation.IsTwoWay = false
					oldDestKey.Relation.BackKeyID = ""
				}

				destAvRelSrcAv := false
				for i, keyValues := range destAv.KeyValues {
					if keyValues.Key.ID == removedKey.Relation.BackKeyID {
						if removeRelationDest { // 删除双向关联的目标字段
							destAv.KeyValues = append(destAv.KeyValues[:i], destAv.KeyValues[i+1:]...)
							destAv.RemoveNewItemTemplateFieldValue(removedKey.Relation.BackKeyID)
						}
						continue
					}

					if av.KeyTypeRelation == keyValues.Key.Type && keyValues.Key.Relation.AvID == attrView.ID {
						destAvRelSrcAv = true
					}
				}

				if removeRelationDest {
					for _, view := range destAv.Views {
						switch view.LayoutType {
						case av.LayoutTypeTable:
							for i, column := range view.Table.Columns {
								if column.ID == removedKey.Relation.BackKeyID {
									view.Table.Columns = append(view.Table.Columns[:i], view.Table.Columns[i+1:]...)
									break
								}
							}
						case av.LayoutTypeGallery:
							for i, field := range view.Gallery.CardFields {
								if field.ID == removedKey.Relation.BackKeyID {
									view.Gallery.CardFields = append(view.Gallery.CardFields[:i], view.Gallery.CardFields[i+1:]...)
									break
								}
							}
						case av.LayoutTypeKanban:
							for i, field := range view.Kanban.Fields {
								if field.ID == removedKey.Relation.BackKeyID {
									view.Kanban.Fields = append(view.Kanban.Fields[:i], view.Kanban.Fields[i+1:]...)
									break
								}
							}
						}
					}
				}

				if destAv != attrView {
					av.SaveAttributeView(destAv)
					ReloadAttrView(destAv.ID)
				}

				if !destAvRelSrcAv {
					av.RemoveAvRel(destAv.ID, attrView.ID)
				}
			}

			srcAvRelDestAv := false
			for _, keyValues := range attrView.KeyValues {
				if av.KeyTypeRelation == keyValues.Key.Type && nil != keyValues.Key.Relation && keyValues.Key.Relation.AvID == removedKey.Relation.AvID {
					srcAvRelDestAv = true
				}
			}
			if !srcAvRelDestAv {
				av.RemoveAvRel(attrView.ID, removedKey.Relation.AvID)
			}
		}
	}

	for _, view := range attrView.Views {
		if nil != view.Table {
			for i, column := range view.Table.Columns {
				if column.ID == keyID {
					view.Table.Columns = append(view.Table.Columns[:i], view.Table.Columns[i+1:]...)
					break
				}
			}
		}

		if nil != view.Gallery {
			for i, field := range view.Gallery.CardFields {
				if field.ID == keyID {
					view.Gallery.CardFields = append(view.Gallery.CardFields[:i], view.Gallery.CardFields[i+1:]...)
					break
				}
			}
		}

		if nil != view.Kanban {
			for i, field := range view.Kanban.Fields {
				if field.ID == keyID {
					view.Kanban.Fields = append(view.Kanban.Fields[:i], view.Kanban.Fields[i+1:]...)
					break
				}
			}
		}
	}

	for _, view := range attrView.Views {
		if nil != view.Group {
			if groupKey := view.GetGroupKey(attrView); nil != groupKey && groupKey.ID == keyID {
				removeAttributeViewGroup0(view)
			}
		}
	}

	if err = av.SaveAttributeView(attrView); nil != err {
		return
	}
	if nil != removedKey && av.KeyTypeRelation == removedKey.Type && nil != removedKey.Relation &&
		"" != removedKey.Relation.AvID && removedKey.Relation.AvID != avID {
		ReloadAttrView(removedKey.Relation.AvID)
	}

	relatedAvIDs := av.GetSrcAvIDs(avID)
	for _, relatedAvID := range relatedAvIDs {
		destAv, _ := av.ParseAttributeView(relatedAvID)
		if nil == destAv {
			continue
		}

		for _, keyValues := range destAv.KeyValues {
			if av.KeyTypeRollup == keyValues.Key.Type && keyValues.Key.Rollup.KeyID == keyID {
				// 置空关联过来的汇总
				for _, val := range keyValues.Values {
					val.Rollup.Contents = nil
				}
			}
		}

		regenAttrViewGroups(destAv)
		av.SaveAttributeView(destAv)
		ReloadAttrView(destAv.ID)
	}
	return
}

func (tx *Transaction) doReplaceAttrViewBlock(operation *Operation) (ret *TxErr) {
	targetItemID, duplicate, err := replaceAttributeViewBlock(operation.AvID, operation.PreviousID, operation.NextID, operation.IsDetached, tx)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID}
	}
	operation.RetData = map[string]any{"targetItemID": targetItemID, "duplicate": duplicate}
	return
}

func replaceAttributeViewBlock(avID, oldBlockID, newBlockID string, isDetached bool, tx *Transaction) (targetItemID string, duplicate bool, err error) {
	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		return
	}

	if targetItemID, duplicate, err = replaceAttributeViewBlock0(attrView, oldBlockID, newBlockID, isDetached, tx); nil != err {
		return
	}

	if err = av.SaveAttributeView(attrView); nil != err {
		return
	}
	return
}

func replaceAttributeViewBlock0(attrView *av.AttributeView, oldBlockID, newNodeID string, isDetached bool, tx *Transaction) (targetItemID string, duplicate bool, err error) {
	avID := attrView.ID
	targetItemID = oldBlockID
	var tree *parse.Tree
	var node *ast.Node
	if !isDetached {
		node, tree, _ = getNodeByBlockID(tx, newNodeID)
	}

	now := util.CurrentTimeMillis()
	// 检查是否已经存在绑定块，如果存在的话则重新绑定
	for _, blockVal := range attrView.GetBlockKeyValues().Values {
		if !isDetached && blockVal.Block.ID == newNodeID && nil != node && nil != tree {
			bindBlockAv0(tx, avID, node, tree)
			blockVal.IsDetached = false
			icon, content := getNodeAvBlockText(node, "")
			content = util.UnescapeHTML(content)
			blockVal.Block.Icon, blockVal.Block.Content = icon, content
			blockVal.UpdatedAt = now
			regenAttrViewGroups(attrView)
			targetItemID = blockVal.BlockID
			duplicate = blockVal.BlockID != oldBlockID
			return
		}
	}

	for _, blockVal := range attrView.GetBlockKeyValues().Values {
		if blockVal.BlockID != oldBlockID {
			continue
		}

		if av.KeyTypeBlock == blockVal.Type {
			blockVal.IsDetached = isDetached
			if !isDetached {
				if "" != blockVal.Block.ID && blockVal.Block.ID != newNodeID {
					unbindBlockAv(tx, avID, blockVal.Block.ID)
				}
				bindBlockAv(tx, avID, newNodeID)

				blockVal.Block.ID = newNodeID
				icon, content := getNodeAvBlockText(node, "")
				content = util.UnescapeHTML(content)
				blockVal.Block.Icon, blockVal.Block.Content = icon, content

				refreshRelatedSrcAvs(avID, tx)
			} else {
				blockVal.Block.ID = ""
			}
		}
	}

	regenAttrViewGroups(attrView)
	return
}

func BatchReplaceAttributeViewBlocks(avID string, isDetached bool, oldNew []map[string]string) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		return
	}

	for _, oldNewMap := range oldNew {
		for oldBlockID, newNodeID := range oldNewMap {
			if _, _, err = replaceAttributeViewBlock0(attrView, oldBlockID, newNodeID, isDetached, nil); nil != err {
				return
			}
		}
	}

	if err = av.SaveAttributeView(attrView); nil != err {
		return
	}
	return
}

func (tx *Transaction) doUpdateAttrViewCell(operation *Operation) (ret *TxErr) {
	_, err := UpdateAttributeViewCell(tx, operation.AvID, operation.KeyID, operation.RowID, operation.Data)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func BatchUpdateAttributeViewCells(tx *Transaction, avID string, values []any) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		return
	}

	for _, value := range values {
		v := value.(map[string]any)
		keyID := v["keyID"].(string)
		var itemID string
		if _, ok := v["itemID"]; ok {
			itemID = v["itemID"].(string)
		} else if _, ok := v["rowID"]; ok {
			// TODO 该参数将于 2026 年 12 月 1 日后删除
			itemID = v["rowID"].(string)
			msg := fmt.Sprintf("[%s] parameter [%s] is deprecated, visit [https://github.com/siyuan-note/siyuan/issues/15727] for details",
				"/api/av/batchSetAttributeViewBlockAttrs", "rowID")
			logging.LogWarn(msg)
			err = errors.New(msg)
			return
		}
		valueData := v["value"]
		_, err = updateAttributeViewValue(tx, attrView, keyID, itemID, valueData)
		if err != nil {
			return
		}
	}
	return
}

func UpdateAttributeViewCell(tx *Transaction, avID, keyID, itemID string, valueData any) (val *av.Value, err error) {
	attrView, err := av.ParseAttributeView(avID)
	if err != nil {
		return
	}

	val, err = updateAttributeViewValue(tx, attrView, keyID, itemID, valueData)
	if nil != err {
		return
	}
	return
}

func updateAttributeViewValue(tx *Transaction, attrView *av.AttributeView, keyID, itemID string, valueData any) (val *av.Value, err error) {
	avID := attrView.ID
	var blockVal *av.Value
	for _, kv := range attrView.KeyValues {
		if av.KeyTypeBlock == kv.Key.Type {
			for _, v := range kv.Values {
				if itemID == v.BlockID {
					blockVal = v
					break
				}
			}
			break
		}
	}

	now := time.Now().UnixMilli()
	oldIsDetached := true
	var oldBoundBlockID string
	if nil != blockVal {
		oldIsDetached = blockVal.IsDetached
		oldBoundBlockID = blockVal.Block.ID
	}
	for _, keyValues := range attrView.KeyValues {
		if keyID != keyValues.Key.ID {
			continue
		}

		for _, value := range keyValues.Values {
			if itemID == value.BlockID {
				val = value
				val.Type = keyValues.Key.Type
				break
			}
		}

		if nil == val {
			val = &av.Value{ID: ast.NewNodeID(), KeyID: keyID, BlockID: itemID, Type: keyValues.Key.Type, CreatedAt: now, UpdatedAt: now}
			keyValues.Values = append(keyValues.Values, val)
		}
		break
	}

	isUpdatingBlockKey := av.KeyTypeBlock == val.Type
	var oldRelationBlockIDs []string
	if av.KeyTypeRelation == val.Type {
		if nil != val.Relation {
			for _, bID := range val.Relation.BlockIDs {
				oldRelationBlockIDs = append(oldRelationBlockIDs, bID)
			}
		}
	}
	data, err := gulu.JSON.MarshalJSON(valueData)
	if err != nil {
		logging.LogErrorf("marshal value [%+v] failed: %s", valueData, err)
		return
	}
	if err = gulu.JSON.UnmarshalJSON(data, &val); err != nil {
		logging.LogErrorf("unmarshal data [%s] failed: %s", data, err)
		return
	}

	key, _ := attrView.GetKey(keyID)

	if av.KeyTypeNumber == val.Type {
		if nil != val.Number {
			if !val.Number.IsNotEmpty {
				val.Number.Content = 0
				val.Number.FormattedContent = ""
			} else {
				val.Number.FormatNumber()
			}
		}
	} else if av.KeyTypeDate == val.Type {
		if nil != val.Date && !val.Date.IsNotEmpty {
			val.Date.Content = 0
			val.Date.FormattedContent = ""
		}
	} else if av.KeyTypeSelect == val.Type || av.KeyTypeMSelect == val.Type {
		if nil != key && 0 < len(val.MSelect) {
			var tmp []*av.ValueSelect
			// 移除空选项 https://github.com/siyuan-note/siyuan/issues/15533
			for _, v := range val.MSelect {
				if "" != v.Content {
					tmp = append(tmp, v)
				}
			}
			val.MSelect = tmp

			if 1 > len(val.MSelect) {
				return
			}

			// The selection options are inconsistent after pasting data into the database https://github.com/siyuan-note/siyuan/issues/11409
			for _, valOpt := range val.MSelect {
				if opt := key.GetOption(valOpt.Content); nil == opt {
					// 不存在的选项新建保存
					color := valOpt.Color
					if "" == color {
						color = fmt.Sprintf("%d", 1+rand.Intn(14))
					}
					opt = &av.SelectOption{Name: valOpt.Content, Color: color}
					key.Options = append(key.Options, opt)
				} else {
					// 已经存在的选项颜色需要保持不变
					valOpt.Color = opt.Color
				}
			}
		}
	}

	relationChangeMode := 0 // 0：不变（仅排序），1：增加，2：减少
	if av.KeyTypeRelation == val.Type {
		// 关联字段得 content 是自动渲染的，所以不需要保存
		val.Relation.Contents = nil
		val.Relation.BlockIDs = gulu.Str.RemoveDuplicatedElem(val.Relation.BlockIDs)

		// 计算关联变更模式
		if !slices.Equal(oldRelationBlockIDs, val.Relation.BlockIDs) {
			if len(oldRelationBlockIDs) > len(val.Relation.BlockIDs) {
				relationChangeMode = 2
			} else {
				relationChangeMode = 1
			}
		}
	}

	// val.IsDetached 只有更新主键的时候才会传入，所以下面需要结合 isUpdatingBlockKey 来判断

	if isUpdatingBlockKey {
		if oldIsDetached {
			// 之前是非绑定块

			if !val.IsDetached { // 现在绑定了块
				bindBlockAv(tx, avID, val.Block.ID)
			}
		} else {
			// 之前绑定了块

			if val.IsDetached { // 现在是非绑定块
				unbindBlockAv(tx, avID, val.Block.ID)
				val.Block.ID = ""
			} else {
				// 现在也绑定了块

				if oldBoundBlockID != val.Block.ID { // 之前绑定的块和现在绑定的块不一样
					// 换绑块
					unbindBlockAv(tx, avID, oldBoundBlockID)
					bindBlockAv(tx, avID, val.Block.ID)
					val.Block.Content = util.UnescapeHTML(val.Block.Content)
				} else { // 之前绑定的块和现在绑定的块一样
					content := strings.TrimSpace(val.Block.Content)
					node, tree, _ := getNodeByBlockID(tx, val.Block.ID)
					_, blockText := getNodeAvBlockText(node, "")
					if "" == content {
						// 使用动态锚文本
						val.Block.Content = util.UnescapeHTML(blockText)
						updateBlockValueStaticText(tx, node, tree, avID, "")
					} else {
						val.Block.Content = content
						updateBlockValueStaticText(tx, node, tree, avID, content)
					}
				}
			}
		}
	}

	if nil != blockVal {
		blockVal.Block.Updated = now
		blockVal.SetUpdatedAt(now)
		if isUpdatingBlockKey {
			blockVal.IsDetached = val.IsDetached
		}
	}
	val.SetUpdatedAt(now)

	if nil != key && av.KeyTypeRelation == key.Type && nil != key.Relation && key.Relation.IsTwoWay {
		// 双向关联需要同时更新目标字段的值
		updateTwoWayRelationDestAttrView(attrView, key, val, relationChangeMode, oldRelationBlockIDs)
	}

	regenAttrViewGroups(attrView)
	if err = av.SaveAttributeView(attrView); nil != err {
		return
	}
	if 0 != relationChangeMode && nil != key && nil != key.Relation && "" != key.Relation.AvID && key.Relation.AvID != avID {
		ReloadAttrView(key.Relation.AvID)
	}

	refreshRelatedSrcAvs(avID, tx)
	return
}

func refreshRelatedSrcAvs(destAvID string, tx *Transaction) {
	relatedAvIDs := av.GetSrcAvIDs(destAvID)

	var tmp []string
	for _, relatedAvID := range relatedAvIDs {
		if relatedAvID == destAvID {
			// 目标和源相同则跳过
			continue
		}

		tmp = append(tmp, relatedAvID)
	}
	relatedAvIDs = tmp

	if nil != tx {
		tx.relatedAvIDs = append(tx.relatedAvIDs, relatedAvIDs...)
	} else {
		for _, relatedAvID := range relatedAvIDs {
			destAv, _ := av.ParseAttributeView(relatedAvID)
			if nil == destAv {
				continue
			}

			regenAttrViewGroups(destAv)
			av.SaveAttributeView(destAv)
			ReloadAttrView(relatedAvID)
		}
	}
}

// relationChangeMode
// 0：关联字段值不变（仅排序），不影响目标值
// 1：关联字段值增加，增加目标值
// 2：关联字段值减少，减少目标值
func updateTwoWayRelationDestAttrView(attrView *av.AttributeView, relKey *av.Key, val *av.Value, relationChangeMode int, oldRelationBlockIDs []string) {
	var destAv *av.AttributeView
	if attrView.ID == relKey.Relation.AvID {
		destAv = attrView
	} else {
		destAv, _ = av.ParseAttributeView(relKey.Relation.AvID)
	}

	if nil == destAv {
		return
	}

	now := util.CurrentTimeMillis()
	if 1 == relationChangeMode {
		addBlockIDs := val.Relation.BlockIDs
		for _, bID := range oldRelationBlockIDs {
			addBlockIDs = gulu.Str.RemoveElem(addBlockIDs, bID)
		}

		for _, blockID := range addBlockIDs {
			for _, keyValues := range destAv.KeyValues {
				if keyValues.Key.ID != relKey.Relation.BackKeyID {
					continue
				}

				destVal := keyValues.GetValue(blockID)
				if nil == destVal {
					destVal = &av.Value{ID: ast.NewNodeID(), KeyID: keyValues.Key.ID, BlockID: blockID, Type: keyValues.Key.Type, Relation: &av.ValueRelation{}, CreatedAt: now, UpdatedAt: now + 1000}
					keyValues.Values = append(keyValues.Values, destVal)
				}

				destVal.Relation.BlockIDs = append(destVal.Relation.BlockIDs, val.BlockID)
				destVal.Relation.BlockIDs = gulu.Str.RemoveDuplicatedElem(destVal.Relation.BlockIDs)
				break
			}
		}
	} else if 2 == relationChangeMode {
		removeBlockIDs := oldRelationBlockIDs
		for _, bID := range val.Relation.BlockIDs {
			removeBlockIDs = gulu.Str.RemoveElem(removeBlockIDs, bID)
		}

		for _, blockID := range removeBlockIDs {
			for _, keyValues := range destAv.KeyValues {
				if keyValues.Key.ID != relKey.Relation.BackKeyID {
					continue
				}

				for _, value := range keyValues.Values {
					if value.BlockID == blockID {
						value.Relation.BlockIDs = gulu.Str.RemoveElem(value.Relation.BlockIDs, val.BlockID)
						value.SetUpdatedAt(now)
						break
					}
				}
			}
		}
	}

	if destAv != attrView {
		regenAttrViewGroups(destAv)
		av.SaveAttributeView(destAv)
	}
}

// regenAttrViewGroups 重新生成分组视图。
func regenAttrViewGroups(attrView *av.AttributeView) {
	for _, view := range attrView.Views {
		groupKey := view.GetGroupKey(attrView)
		if nil == groupKey {
			continue
		}

		genAttrViewGroups(view, attrView)
	}
}

func unbindBlockAv(tx *Transaction, avID, nodeID string) {
	node, tree, err := getNodeByBlockID(tx, nodeID)
	if err != nil {
		return
	}

	attrs := parse.IAL2Map(node.KramdownIAL)
	if "" == attrs[av.NodeAttrNameAvs] {
		return
	}

	avIDs := strings.Split(attrs[av.NodeAttrNameAvs], ",")
	avIDs = gulu.Str.RemoveElem(avIDs, avID)
	if 0 == len(avIDs) {
		attrs[av.NodeAttrNameAvs] = ""
	} else {
		attrs[av.NodeAttrNameAvs] = strings.Join(avIDs, ",")
	}

	avNames := getAvNames(attrs[av.NodeAttrNameAvs])
	if "" != avNames {
		attrs[av.NodeAttrViewNames] = avNames
	}

	if nil != tx {
		err = setNodeAttrsWithTx(tx, node, tree, attrs)
	} else {
		err = setNodeAttrs(node, tree, attrs)
	}
	if err != nil {
		logging.LogWarnf("set node [%s] attrs failed: %s", nodeID, err)
		return
	}
	return
}

func bindBlockAv(tx *Transaction, avID, blockID string) {
	node, tree, err := getNodeByBlockID(tx, blockID)
	if err != nil {
		return
	}

	bindBlockAv0(tx, avID, node, tree)
	return
}

func bindBlockAv0(tx *Transaction, avID string, node *ast.Node, tree *parse.Tree) {
	attrs := parse.IAL2Map(node.KramdownIAL)
	if "" == attrs[av.NodeAttrNameAvs] {
		attrs[av.NodeAttrNameAvs] = avID
	} else {
		avIDs := strings.Split(attrs[av.NodeAttrNameAvs], ",")
		avIDs = append(avIDs, avID)
		avIDs = gulu.Str.RemoveDuplicatedElem(avIDs)
		attrs[av.NodeAttrNameAvs] = strings.Join(avIDs, ",")
	}

	avNames := getAvNames(attrs[av.NodeAttrNameAvs])
	if "" != avNames {
		attrs[av.NodeAttrViewNames] = avNames
	}

	var err error
	if nil != tx {
		err = setNodeAttrsWithTx(tx, node, tree, attrs)
	} else {
		err = setNodeAttrs(node, tree, attrs)
	}
	if err != nil {
		logging.LogWarnf("set node [%s] attrs failed: %s", node.ID, err)
		return
	}
	return
}

func updateBlockValueStaticText(tx *Transaction, node *ast.Node, tree *parse.Tree, avID, text string) {
	// 设置静态锚文本 Database-bound block primary key supports setting static anchor text https://github.com/siyuan-note/siyuan/issues/10049

	if nil == node {
		return
	}

	attrs := parse.IAL2Map(node.KramdownIAL)
	attrs[av.NodeAttrViewStaticText+"-"+avID] = text
	var err error
	if nil != tx {
		err = setNodeAttrsWithTx(tx, node, tree, attrs)
	} else {
		err = setNodeAttrs(node, tree, attrs)
	}
	if err != nil {
		logging.LogWarnf("set node [%s] attrs failed: %s", node.ID, err)
		return
	}
}

func getNodeByBlockID(tx *Transaction, blockID string) (node *ast.Node, tree *parse.Tree, err error) {
	if nil != tx {
		tree, err = tx.loadTree(blockID)
	} else {
		tree, err = LoadTreeByBlockID(blockID)
	}
	if err != nil {
		return
	}
	node = treenode.GetNodeInTree(tree, blockID)
	if nil == node {
		logging.LogWarnf("node [%s] not found in tree [%s]", blockID, tree.ID)
		return
	}
	return
}

func (tx *Transaction) doUpdateAttrViewColOptions(operation *Operation) (ret *TxErr) {
	err := updateAttributeViewColumnOptions(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func updateAttributeViewColumnOptions(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	jsonData, err := gulu.JSON.MarshalJSON(operation.Data)
	if err != nil {
		return
	}

	options := []*av.SelectOption{}
	if err = gulu.JSON.UnmarshalJSON(jsonData, &options); err != nil {
		return
	}

	// 移除空选项 https://github.com/siyuan-note/siyuan/issues/15533
	var tmp []*av.SelectOption
	for _, opt := range options {
		if "" != opt.Name {
			tmp = append(tmp, opt)
		}
	}
	options = tmp
	if 1 > len(options) {
		return
	}

	optionSorts := map[string]int{}
	for i, opt := range options {
		optionSorts[opt.Name] = i
	}

	addNew := false
	selectKey, _ := attrView.GetKey(operation.ID)
	if nil == selectKey {
		return
	}
	existingOptions := map[string]*av.SelectOption{}
	for _, opt := range selectKey.Options {
		existingOptions[opt.Name] = opt
	}
	for _, opt := range options {
		if existingOpt, exists := existingOptions[opt.Name]; exists {
			// 如果选项已经存在则更新颜色和描述
			existingOpt.Color = opt.Color
			existingOpt.Desc = opt.Desc
		} else {
			// 如果选项不存在则添加新选项
			selectKey.Options = append(selectKey.Options, &av.SelectOption{
				Name:  opt.Name,
				Color: opt.Color,
				Desc:  opt.Desc,
			})
			addNew = true
		}
	}

	if !addNew {
		sort.SliceStable(selectKey.Options, func(i, j int) bool {
			return optionSorts[selectKey.Options[i].Name] < optionSorts[selectKey.Options[j].Name]
		})
	}

	regenAttrViewGroups(attrView)
	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doRemoveAttrViewColOption(operation *Operation) (ret *TxErr) {
	err := removeAttributeViewColumnOption(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func removeAttributeViewColumnOption(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	optName := operation.Data.(string)

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

	regenAttrViewGroups(attrView)
	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doUpdateAttrViewColOption(operation *Operation) (ret *TxErr) {
	err := updateAttributeViewColumnOption(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func updateAttributeViewColumnOption(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	key, err := attrView.GetKey(operation.ID)
	if err != nil {
		return
	}

	data := operation.Data.(map[string]any)

	rename := false
	oldName := strings.TrimSpace(data["oldName"].(string))
	newName := strings.TrimSpace(data["newName"].(string))
	newDesc := strings.TrimSpace(data["newDesc"].(string))
	newColor := data["newColor"].(string)

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
	// Database select field filters follow option editing changes https://github.com/siyuan-note/siyuan/issues/10881
	for _, view := range attrView.Views {
		av.RenameSelectOptionInFilters(view.Filters, key.ID, oldName, newName, newColor)
	}

	regenAttrViewGroups(attrView)
	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewColOptionDesc(operation *Operation) (ret *TxErr) {
	err := setAttributeViewColumnOptionDesc(operation)
	if err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttributeViewColumnOptionDesc(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return
	}

	key, err := attrView.GetKey(operation.ID)
	if err != nil {
		return
	}

	data := operation.Data.(map[string]any)
	name := data["name"].(string)
	desc := data["desc"].(string)

	for i, opt := range key.Options {
		if name == opt.Name {
			key.Options[i].Desc = desc
			break
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func getAttrViewViewByBlockID(attrView *av.AttributeView, blockID string) (ret *av.View, err error) {
	var viewID string
	var node *ast.Node
	if "" != blockID {
		node, _, _ = getNodeByBlockID(nil, blockID)
	}
	if nil != node {
		viewID = node.IALAttr(av.NodeAttrView)
	}
	return attrView.GetCurrentView(viewID)
}

func getAttrViewName(attrView *av.AttributeView) string {
	ret := strings.TrimSpace(attrView.Name)
	if "" == ret {
		ret = Conf.language(105)
	}
	return ret
}

func updateBoundBlockAvsAttribute(avIDs []string) {
	// 更新指定 avIDs 中绑定块的 avs 属性

	cachedTrees, saveTrees := map[string]*parse.Tree{}, map[string]*parse.Tree{}
	luteEngine := util.NewLute()
	for _, avID := range avIDs {
		attrView, _ := av.ParseAttributeView(avID)
		if nil == attrView {
			continue
		}

		blockKeyValues := attrView.GetBlockKeyValues()
		if nil == blockKeyValues || nil == blockKeyValues.Values {
			continue
		}

		for _, blockValue := range blockKeyValues.Values {
			if blockValue.IsDetached || nil == blockValue.Block {
				continue
			}

			boundBlockID := blockValue.Block.ID
			if "" == boundBlockID {
				continue
			}

			bt := treenode.GetBlockTree(boundBlockID)
			if nil == bt {
				for _, encBoxID := range treenode.GetOpenedEncryptedBoxIDs() {
					if encBT := treenode.GetBlockTreeInBox(boundBlockID, encBoxID); nil != encBT {
						bt = encBT
						break
					}
				}
			}
			if nil == bt {
				continue
			}

			tree := cachedTrees[bt.RootID]
			if nil == tree {
				tree, _ = filesys.LoadTree(bt.BoxID, bt.Path, luteEngine)
				if nil == tree {
					continue
				}
				cachedTrees[bt.RootID] = tree
			}

			node := treenode.GetNodeInTree(tree, boundBlockID)
			if nil == node {
				continue
			}

			attrs := parse.IAL2Map(node.KramdownIAL)
			if "" == attrs[av.NodeAttrNameAvs] {
				attrs[av.NodeAttrNameAvs] = avID
			} else {
				nodeAvIDs := strings.Split(attrs[av.NodeAttrNameAvs], ",")
				nodeAvIDs = append(nodeAvIDs, avID)
				nodeAvIDs = gulu.Str.RemoveDuplicatedElem(nodeAvIDs)
				attrs[av.NodeAttrNameAvs] = strings.Join(nodeAvIDs, ",")
				saveTrees[bt.RootID] = tree
			}

			avNames := getAvNames(attrs[av.NodeAttrNameAvs])
			if "" != avNames {
				attrs[av.NodeAttrViewNames] = avNames
			}

			oldAttrs, setErr := setNodeAttrs0(node, attrs, bt.BoxID)
			if nil != setErr {
				continue
			}
			cache.PutBlockIALInBox(node.ID, bt.BoxID, parse.IAL2Map(node.KramdownIAL))
			pushBlockAttrs(oldAttrs, node)
			if "" != avNames {
				node.RemoveIALAttr(av.NodeAttrViewNames)
			}
		}
	}

	for _, saveTree := range saveTrees {
		if treeErr := indexWriteTreeUpsertQueue(saveTree); nil != treeErr {
			logging.LogErrorf("index write tree upsert queue failed: %s", treeErr)
		}

		avNodes := saveTree.Root.ChildrenByType(ast.NodeAttributeView)
		av.BatchUpsertBlockRel(avNodes)
	}
}
