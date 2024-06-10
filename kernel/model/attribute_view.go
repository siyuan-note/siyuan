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
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/jinzhu/copier"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/xrash/smetrics"
)

func AppendAttributeViewDetachedBlocksWithValues(avID string, blocksValues [][]*av.Value) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}

	now := util.CurrentTimeMillis()
	var blockIDs []string
	for _, blockValues := range blocksValues {
		blockID := ast.NewNodeID()
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
				v.Block.ID = blockID
				v.Block.Created = now
				v.Block.Updated = now
			}
			v.IsDetached = true
			v.CreatedAt = now
			v.UpdatedAt = now

			keyValues.Values = append(keyValues.Values, v)
		}
	}

	for _, v := range attrView.Views {
		switch v.LayoutType {
		case av.LayoutTypeTable:
			for _, addingBlockID := range blockIDs {
				v.Table.RowIDs = append(v.Table.RowIDs, addingBlockID)
			}
		}
	}

	if err = av.SaveAttributeView(attrView); nil != err {
		logging.LogErrorf("save attribute view [%s] failed: %s", avID, err)
		return
	}

	util.PushReloadAttrView(avID)
	return
}

func DuplicateDatabaseBlock(avID string) (newAvID, newBlockID string, err error) {
	storageAvDir := filepath.Join(util.DataDir, "storage", "av")
	oldAvPath := filepath.Join(storageAvDir, avID+".json")
	newAvID, newBlockID = ast.NewNodeID(), ast.NewNodeID()

	oldAv, err := av.ParseAttributeView(avID)
	if nil != err {
		return
	}

	data, err := filelock.ReadFile(oldAvPath)
	if nil != err {
		logging.LogErrorf("read attribute view [%s] failed: %s", avID, err)
		return
	}

	data = bytes.ReplaceAll(data, []byte(avID), []byte(newAvID))
	av.UpsertBlockRel(newAvID, newBlockID)

	newAv := &av.AttributeView{}
	if err = gulu.JSON.UnmarshalJSON(data, newAv); nil != err {
		logging.LogErrorf("unmarshal attribute view [%s] failed: %s", newAvID, err)
		return
	}

	newAv.Name = oldAv.Name + " (Duplicated " + time.Now().Format("2006-01-02 15:04:05") + ")"

	for _, keyValues := range newAv.KeyValues {
		if nil != keyValues.Key.Relation && keyValues.Key.Relation.IsTwoWay {
			// 断开双向关联
			keyValues.Key.Relation.IsTwoWay = false
			keyValues.Key.Relation.BackKeyID = ""
		}
	}

	data, err = gulu.JSON.MarshalJSON(newAv)
	if nil != err {
		logging.LogErrorf("marshal attribute view [%s] failed: %s", newAvID, err)
		return
	}

	newAvPath := filepath.Join(storageAvDir, newAvID+".json")
	if err = filelock.WriteFile(newAvPath, data); nil != err {
		logging.LogErrorf("write attribute view [%s] failed: %s", newAvID, err)
		return
	}

	updateBoundBlockAvsAttribute([]string{newAvID})
	return
}

func GetAttributeViewKeysByAvID(avID string) (ret []*av.Key) {
	ret = []*av.Key{}

	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}

	for _, keyValues := range attrView.KeyValues {
		key := keyValues.Key
		ret = append(ret, key)
	}
	return ret
}

func SetDatabaseBlockView(blockID, viewID string) (err error) {
	node, tree, err := getNodeByBlockID(nil, blockID)
	if nil != err {
		return
	}

	attrs := parse.IAL2Map(node.KramdownIAL)
	attrs[av.NodeAttrView] = viewID
	err = setNodeAttrs(node, tree, attrs)
	if nil != err {
		logging.LogWarnf("set node [%s] attrs failed: %s", blockID, err)
		return
	}
	return
}

func GetAttributeViewPrimaryKeyValues(avID, keyword string, page, pageSize int) (attributeViewName string, databaseBlockIDs []string, keyValues *av.KeyValues, err error) {
	waitForSyncingStorages()

	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}
	attributeViewName = getAttrViewName(attrView)

	databaseBlockIDs = treenode.GetMirrorAttrViewBlockIDs(avID)

	keyValues = attrView.GetBlockKeyValues()
	// 过滤掉不在视图中的值
	tmp := map[string]*av.Value{}
	for _, kv := range keyValues.Values {
		for _, view := range attrView.Views {
			switch view.LayoutType {
			case av.LayoutTypeTable:
				if !kv.IsDetached {
					if nil == treenode.GetBlockTree(kv.BlockID) {
						break
					}
				}

				tmp[kv.Block.ID] = kv
			}
		}
	}
	keyValues.Values = []*av.Value{}
	for _, v := range tmp {
		if strings.Contains(strings.ToLower(v.String(true)), strings.ToLower(keyword)) {
			keyValues.Values = append(keyValues.Values, v)
		}
	}

	if 1 > pageSize {
		pageSize = 16
	}
	start := (page - 1) * pageSize
	end := start + pageSize
	if len(keyValues.Values) < end {
		end = len(keyValues.Values)
	}
	keyValues.Values = keyValues.Values[start:end]

	sort.Slice(keyValues.Values, func(i, j int) bool {
		return keyValues.Values[i].Block.Updated > keyValues.Values[j].Block.Updated
	})
	return
}

func GetAttributeViewFilterSort(avID, blockID string) (filters []*av.ViewFilter, sorts []*av.ViewSort) {
	waitForSyncingStorages()

	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, blockID)
	if nil == view {
		view, err = attrView.GetCurrentView(attrView.ViewID)
		if nil != err {
			logging.LogErrorf("get current view failed: %s", err)
			return
		}
	}

	filters = []*av.ViewFilter{}
	sorts = []*av.ViewSort{}
	switch view.LayoutType {
	case av.LayoutTypeTable:
		filters = view.Table.Filters
		sorts = view.Table.Sorts
	}
	return
}

func SearchAttributeViewNonRelationKey(avID, keyword string) (ret []*av.Key) {
	waitForSyncingStorages()

	ret = []*av.Key{}
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}

	for _, keyValues := range attrView.KeyValues {
		if av.KeyTypeRelation != keyValues.Key.Type && av.KeyTypeRollup != keyValues.Key.Type && av.KeyTypeTemplate != keyValues.Key.Type && av.KeyTypeCreated != keyValues.Key.Type && av.KeyTypeUpdated != keyValues.Key.Type && av.KeyTypeLineNumber != keyValues.Key.Type {
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
	if nil != err {
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

type SearchAttributeViewResult struct {
	AvID    string `json:"avID"`
	AvName  string `json:"avName"`
	BlockID string `json:"blockID"`
	HPath   string `json:"hPath"`
}

func SearchAttributeView(keyword string, excludeAvIDs []string) (ret []*SearchAttributeViewResult) {
	waitForSyncingStorages()

	ret = []*SearchAttributeViewResult{}
	keyword = strings.TrimSpace(keyword)
	keywords := strings.Fields(keyword)

	type result struct {
		AvID      string
		AvName    string
		AvUpdated int64
		Score     float64
	}
	var avs []*result
	avDir := filepath.Join(util.DataDir, "storage", "av")
	entries, err := os.ReadDir(avDir)
	if nil != err {
		logging.LogErrorf("read directory [%s] failed: %s", avDir, err)
		return
	}
	avBlockRels := av.GetBlockRels()
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		id := strings.TrimSuffix(entry.Name(), ".json")
		if !ast.IsNodeIDPattern(id) {
			continue
		}

		if nil == avBlockRels[id] {
			continue
		}

		name, _ := av.GetAttributeViewNameByPath(filepath.Join(avDir, entry.Name()))
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
				a := &result{AvID: id, AvName: name, Score: score}
				if nil != info && !info.ModTime().IsZero() {
					a.AvUpdated = info.ModTime().UnixMilli()
				}
				avs = append(avs, a)
			}
		} else {
			a := &result{AvID: id, AvName: name}
			if nil != info && !info.ModTime().IsZero() {
				a.AvUpdated = info.ModTime().UnixMilli()
			}
			avs = append(avs, a)
		}
	}

	if "" == keyword {
		sort.Slice(avs, func(i, j int) bool { return avs[i].AvUpdated > avs[j].AvUpdated })
	} else {
		sort.SliceStable(avs, func(i, j int) bool {
			if avs[i].Score == avs[j].Score {
				return avs[i].AvUpdated > avs[j].AvUpdated
			}
			return avs[i].Score > avs[j].Score
		})
	}
	if 12 <= len(avs) {
		avs = avs[:12]
	}
	var avIDs []string
	for _, a := range avs {
		avIDs = append(avIDs, a.AvID)
	}

	avBlocks := treenode.BatchGetMirrorAttrViewBlocks(avIDs)
	var blockIDs []string
	for _, avBlock := range avBlocks {
		blockIDs = append(blockIDs, avBlock.BlockIDs...)
	}
	blockIDs = gulu.Str.RemoveDuplicatedElem(blockIDs)

	trees := map[string]*parse.Tree{}
	for _, blockID := range blockIDs {
		bt := treenode.GetBlockTree(blockID)
		if nil == bt {
			continue
		}

		tree := trees[bt.RootID]
		if nil == tree {
			tree, _ = LoadTreeByBlockID(blockID)
			if nil != tree {
				trees[bt.RootID] = tree
			}
		}
		if nil == tree {
			continue
		}

		node := treenode.GetNodeInTree(tree, blockID)
		if nil == node {
			continue
		}

		if "" == node.AttributeViewID {
			continue
		}

		avID := node.AttributeViewID
		var existAv *result
		for _, av := range avs {
			if av.AvID == avID {
				existAv = av
				break
			}
		}
		if nil == existAv {
			continue
		}

		exist := false
		for _, result := range ret {
			if result.AvID == avID {
				exist = true
				break
			}
		}
		if exist {
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

		if !gulu.Str.Contains(avID, excludeAvIDs) {
			ret = append(ret, &SearchAttributeViewResult{
				AvID:    avID,
				AvName:  existAv.AvName,
				BlockID: blockID,
				HPath:   hPath,
			})
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

func GetBlockAttributeViewKeys(blockID string) (ret []*BlockAttributeViewKeys) {
	waitForSyncingStorages()

	ret = []*BlockAttributeViewKeys{}
	attrs := GetBlockAttrsWithoutWaitWriting(blockID)
	avs := attrs[av.NodeAttrNameAvs]
	if "" == avs {
		return
	}

	avIDs := strings.Split(avs, ",")
	for _, avID := range avIDs {
		attrView, err := av.ParseAttributeView(avID)
		if nil != err {
			logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
			unbindBlockAv(nil, avID, blockID)
			return
		}

		if 1 > len(attrView.Views) {
			err = av.ErrViewNotFound
			unbindBlockAv(nil, avID, blockID)
			return
		}

		if !attrView.ExistBlock(blockID) {
			// 比如剪切后粘贴，块 ID 会变，但是属性还在块上，这里做一次数据订正
			// Auto verify the database name when clicking the block superscript icon https://github.com/siyuan-note/siyuan/issues/10861
			unbindBlockAv(nil, avID, blockID)
			return
		}

		var keyValues []*av.KeyValues
		for _, kv := range attrView.KeyValues {
			if av.KeyTypeLineNumber == kv.Key.Type {
				// 属性面板中不显示行号字段
				// The line number field no longer appears in the database attribute panel https://github.com/siyuan-note/siyuan/issues/11319
				continue
			}

			kValues := &av.KeyValues{Key: kv.Key}
			for _, v := range kv.Values {
				if v.BlockID == blockID {
					kValues.Values = append(kValues.Values, v)
				}
			}

			switch kValues.Key.Type {
			case av.KeyTypeRollup:
				kValues.Values = append(kValues.Values, &av.Value{ID: ast.NewNodeID(), KeyID: kValues.Key.ID, BlockID: blockID, Type: av.KeyTypeRollup, Rollup: &av.ValueRollup{Contents: []*av.Value{}}})
			case av.KeyTypeTemplate:
				kValues.Values = append(kValues.Values, &av.Value{ID: ast.NewNodeID(), KeyID: kValues.Key.ID, BlockID: blockID, Type: av.KeyTypeTemplate, Template: &av.ValueTemplate{Content: ""}})
			case av.KeyTypeCreated:
				kValues.Values = append(kValues.Values, &av.Value{ID: ast.NewNodeID(), KeyID: kValues.Key.ID, BlockID: blockID, Type: av.KeyTypeCreated})
			case av.KeyTypeUpdated:
				kValues.Values = append(kValues.Values, &av.Value{ID: ast.NewNodeID(), KeyID: kValues.Key.ID, BlockID: blockID, Type: av.KeyTypeUpdated})
			}

			if 0 < len(kValues.Values) {
				keyValues = append(keyValues, kValues)
			} else {
				// 如果没有值，那么就补一个默认值
				kValues.Values = append(kValues.Values, av.GetAttributeViewDefaultValue(ast.NewNodeID(), kv.Key.ID, blockID, kv.Key.Type))
				keyValues = append(keyValues, kValues)
			}
		}

		// 渲染自动生成的列值，比如模板列、关联列、汇总列、创建时间列和更新时间列
		// 先处理关联列、汇总列、创建时间列和更新时间列
		for _, kv := range keyValues {
			switch kv.Key.Type {
			case av.KeyTypeRollup:
				if nil == kv.Key.Rollup {
					break
				}

				relKey, _ := attrView.GetKey(kv.Key.Rollup.RelationKeyID)
				if nil == relKey {
					break
				}

				relVal := attrView.GetValue(kv.Key.Rollup.RelationKeyID, kv.Values[0].BlockID)
				if nil != relVal && nil != relVal.Relation {
					destAv, _ := av.ParseAttributeView(relKey.Relation.AvID)
					destKey, _ := destAv.GetKey(kv.Key.Rollup.KeyID)
					if nil != destAv && nil != destKey {
						for _, bID := range relVal.Relation.BlockIDs {
							destVal := destAv.GetValue(kv.Key.Rollup.KeyID, bID)
							if nil == destVal {
								if destAv.ExistBlock(bID) { // 数据库中存在行但是列值不存在是数据未初始化，这里补一个默认值
									destVal = av.GetAttributeViewDefaultValue(ast.NewNodeID(), kv.Key.Rollup.KeyID, bID, destKey.Type)
								}
								if nil == destVal {
									continue
								}
							}
							if av.KeyTypeNumber == destKey.Type {
								destVal.Number.Format = destKey.NumberFormat
								destVal.Number.FormatNumber()
							}

							kv.Values[0].Rollup.Contents = append(kv.Values[0].Rollup.Contents, destVal.Clone())
						}
						kv.Values[0].Rollup.RenderContents(kv.Key.Rollup.Calc, destKey)
					}
				}
			case av.KeyTypeRelation:
				if nil == kv.Key.Relation {
					break
				}

				destAv, _ := av.ParseAttributeView(kv.Key.Relation.AvID)
				if nil == destAv {
					break
				}

				blocks := map[string]*av.Value{}
				for _, blockValue := range destAv.GetBlockKeyValues().Values {
					blocks[blockValue.BlockID] = blockValue
				}
				kv.Values[0].Relation.Contents = nil // 先清空 https://github.com/siyuan-note/siyuan/issues/10670
				for _, bID := range kv.Values[0].Relation.BlockIDs {
					kv.Values[0].Relation.Contents = append(kv.Values[0].Relation.Contents, blocks[bID])
				}
			case av.KeyTypeCreated:
				createdStr := blockID[:len("20060102150405")]
				created, parseErr := time.ParseInLocation("20060102150405", createdStr, time.Local)
				if nil == parseErr {
					kv.Values[0].Created = av.NewFormattedValueCreated(created.UnixMilli(), 0, av.CreatedFormatNone)
					kv.Values[0].Created.IsNotEmpty = true
				} else {
					logging.LogWarnf("parse created [%s] failed: %s", createdStr, parseErr)
					kv.Values[0].Created = av.NewFormattedValueCreated(time.Now().UnixMilli(), 0, av.CreatedFormatNone)
				}
			case av.KeyTypeUpdated:
				ial := GetBlockAttrsWithoutWaitWriting(blockID)
				updatedStr := ial["updated"]
				updated, parseErr := time.ParseInLocation("20060102150405", updatedStr, time.Local)
				if nil == parseErr {
					kv.Values[0].Updated = av.NewFormattedValueUpdated(updated.UnixMilli(), 0, av.UpdatedFormatNone)
					kv.Values[0].Updated.IsNotEmpty = true
				} else {
					logging.LogWarnf("parse updated [%s] failed: %s", updatedStr, parseErr)
					kv.Values[0].Updated = av.NewFormattedValueUpdated(time.Now().UnixMilli(), 0, av.UpdatedFormatNone)
				}
			}
		}

		// 再处理模板列

		// 渲染模板
		var renderTemplateErr error
		for _, kv := range keyValues {
			switch kv.Key.Type {
			case av.KeyTypeTemplate:
				if 0 < len(kv.Values) {
					ial := map[string]string{}
					block := av.GetKeyBlockValue(keyValues)
					if nil != block && !block.IsDetached {
						ial = GetBlockAttrsWithoutWaitWriting(block.BlockID)
					}

					if nil == kv.Values[0].Template {
						kv.Values[0] = av.GetAttributeViewDefaultValue(kv.Values[0].ID, kv.Key.ID, blockID, kv.Key.Type)
					}

					var renderErr error
					kv.Values[0].Template.Content, renderErr = sql.RenderTemplateCol(ial, keyValues, kv.Key.Template)
					if nil != renderErr {
						renderTemplateErr = fmt.Errorf("database [%s] template field [%s] rendering failed: %s", getAttrViewName(attrView), kv.Key.Name, renderErr)
					}
				}
			}
		}
		if nil != renderTemplateErr {
			util.PushErrMsg(fmt.Sprintf(Conf.Language(44), util.EscapeHTML(renderTemplateErr.Error())), 30000)
		}

		// 字段排序
		refreshAttrViewKeyIDs(attrView)
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
				tree, _ := LoadTreeByBlockID(blockID)
				if nil != tree {
					node := treenode.GetNodeInTree(tree, blockID)
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

func RenderRepoSnapshotAttributeView(indexID, avID string) (viewable av.Viewable, attrView *av.AttributeView, err error) {
	repo, err := newRepository()
	if nil != err {
		return
	}

	index, err := repo.GetIndex(indexID)
	if nil != err {
		return
	}

	files, err := repo.GetFiles(index)
	if nil != err {
		return
	}
	var avFile *entity.File
	for _, f := range files {
		if "/storage/av/"+avID+".json" == f.Path {
			avFile = f
			break
		}
	}

	if nil == avFile {
		attrView = av.NewAttributeView(avID)
	} else {
		data, readErr := repo.OpenFile(avFile)
		if nil != readErr {
			logging.LogErrorf("read attribute view [%s] failed: %s", avID, readErr)
			return
		}

		attrView = &av.AttributeView{}
		if err = gulu.JSON.UnmarshalJSON(data, attrView); nil != err {
			logging.LogErrorf("unmarshal attribute view [%s] failed: %s", avID, err)
			return
		}
	}

	viewable, err = renderAttributeView(attrView, "", "", 1, -1)
	return
}

func RenderHistoryAttributeView(avID, created string) (viewable av.Viewable, attrView *av.AttributeView, err error) {
	createdUnix, parseErr := strconv.ParseInt(created, 10, 64)
	if nil != parseErr {
		logging.LogErrorf("parse created [%s] failed: %s", created, parseErr)
		return
	}

	dirPrefix := time.Unix(createdUnix, 0).Format("2006-01-02-150405")
	globPath := filepath.Join(util.HistoryDir, dirPrefix+"*")
	matches, err := filepath.Glob(globPath)
	if nil != err {
		logging.LogErrorf("glob [%s] failed: %s", globPath, err)
		return
	}
	if 1 > len(matches) {
		return
	}

	historyDir := matches[0]
	avJSONPath := filepath.Join(historyDir, "storage", "av", avID+".json")
	if !gulu.File.IsExist(avJSONPath) {
		avJSONPath = filepath.Join(util.DataDir, "storage", "av", avID+".json")
	}
	if !gulu.File.IsExist(avJSONPath) {
		attrView = av.NewAttributeView(avID)
	} else {
		data, readErr := os.ReadFile(avJSONPath)
		if nil != readErr {
			logging.LogErrorf("read attribute view [%s] failed: %s", avID, readErr)
			return
		}

		attrView = &av.AttributeView{}
		if err = gulu.JSON.UnmarshalJSON(data, attrView); nil != err {
			logging.LogErrorf("unmarshal attribute view [%s] failed: %s", avID, err)
			return
		}
	}

	viewable, err = renderAttributeView(attrView, "", "", 1, -1)
	return
}

func RenderAttributeView(avID, viewID, query string, page, pageSize int) (viewable av.Viewable, attrView *av.AttributeView, err error) {
	waitForSyncingStorages()

	if avJSONPath := av.GetAttributeViewDataPath(avID); !filelock.IsExist(avJSONPath) {
		attrView = av.NewAttributeView(avID)
		if err = av.SaveAttributeView(attrView); nil != err {
			logging.LogErrorf("save attribute view [%s] failed: %s", avID, err)
			return
		}
	}

	attrView, err = av.ParseAttributeView(avID)
	if nil != err {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}

	viewable, err = renderAttributeView(attrView, viewID, query, page, pageSize)
	return
}

func renderAttributeView(attrView *av.AttributeView, viewID, query string, page, pageSize int) (viewable av.Viewable, err error) {
	if 1 > len(attrView.Views) {
		view, _, _ := av.NewTableViewWithBlockKey(ast.NewNodeID())
		attrView.Views = append(attrView.Views, view)
		attrView.ViewID = view.ID
		if err = av.SaveAttributeView(attrView); nil != err {
			logging.LogErrorf("save attribute view [%s] failed: %s", attrView.ID, err)
			return
		}
	}

	var view *av.View
	if "" != viewID {
		view, _ = attrView.GetCurrentView(viewID)
		if nil != view && view.ID != attrView.ViewID {
			attrView.ViewID = view.ID
			if err = av.SaveAttributeView(attrView); nil != err {
				logging.LogErrorf("save attribute view [%s] failed: %s", attrView.ID, err)
				return
			}
		}
	} else {
		view = attrView.GetView(attrView.ViewID)
	}

	if nil == view {
		view = attrView.Views[0]
	}

	// 做一些数据兼容和订正处理，保存的时候也会做 av.SaveAttributeView()
	currentTimeMillis := util.CurrentTimeMillis()
	for _, kv := range attrView.KeyValues {
		switch kv.Key.Type {
		case av.KeyTypeBlock: // 补全 block 的创建时间和更新时间
			for _, v := range kv.Values {
				if 0 == v.Block.Created {
					if "" == v.Block.ID {
						v.Block.ID = v.BlockID
						if "" == v.Block.ID {
							v.Block.ID = ast.NewNodeID()
							v.BlockID = v.Block.ID
						}
					}

					createdStr := v.Block.ID[:len("20060102150405")]
					created, parseErr := time.ParseInLocation("20060102150405", createdStr, time.Local)
					if nil == parseErr {
						v.Block.Created = created.UnixMilli()
					} else {
						v.Block.Created = currentTimeMillis
					}
				}
				if 0 == v.Block.Updated {
					v.Block.Updated = v.Block.Created
				}
			}
		}

		for _, v := range kv.Values {
			// 校验日期 IsNotEmpty
			if av.KeyTypeDate == kv.Key.Type {
				if nil != v.Date && 0 != v.Date.Content && !v.Date.IsNotEmpty {
					v.Date.IsNotEmpty = true
				}
			}

			// 校验数字 IsNotEmpty
			if av.KeyTypeNumber == kv.Key.Type {
				if nil != v.Number && 0 != v.Number.Content && !v.Number.IsNotEmpty {
					v.Number.IsNotEmpty = true
				}
			}

			// 补全值的创建时间和更新时间
			if "" == v.ID {
				v.ID = ast.NewNodeID()
			}

			if 0 == v.CreatedAt {
				createdStr := v.ID[:len("20060102150405")]
				created, parseErr := time.ParseInLocation("20060102150405", createdStr, time.Local)
				if nil == parseErr {
					v.CreatedAt = created.UnixMilli()
				} else {
					v.CreatedAt = currentTimeMillis
				}
			}

			if 0 == v.UpdatedAt {
				v.UpdatedAt = v.CreatedAt
			}
		}
	}

	// 补全过滤器 Value
	if nil != view.Table {
		for _, f := range view.Table.Filters {
			if nil != f.Value {
				continue
			}

			if k, _ := attrView.GetKey(f.Column); nil != k {
				f.Value = &av.Value{Type: k.Type}
			}
		}
	}

	switch view.LayoutType {
	case av.LayoutTypeTable:
		// 列删除以后需要删除设置的过滤和排序
		tmpFilters := []*av.ViewFilter{}
		for _, f := range view.Table.Filters {
			if k, _ := attrView.GetKey(f.Column); nil != k {
				tmpFilters = append(tmpFilters, f)
			}
		}
		view.Table.Filters = tmpFilters

		tmpSorts := []*av.ViewSort{}
		for _, s := range view.Table.Sorts {
			if k, _ := attrView.GetKey(s.Column); nil != k {
				tmpSorts = append(tmpSorts, s)
			}
		}
		view.Table.Sorts = tmpSorts

		viewable = sql.RenderAttributeViewTable(attrView, view, query, GetBlockAttrsWithoutWaitWriting)
	}

	viewable.FilterRows(attrView)
	viewable.SortRows(attrView)
	viewable.CalcCols()

	// 分页
	switch viewable.GetType() {
	case av.LayoutTypeTable:
		table := viewable.(*av.Table)
		table.RowCount = len(table.Rows)
		if 1 > view.Table.PageSize {
			view.Table.PageSize = 50
		}
		table.PageSize = view.Table.PageSize
		if 1 > pageSize {
			pageSize = table.PageSize
		}

		start := (page - 1) * pageSize
		end := start + pageSize
		if len(table.Rows) < end {
			end = len(table.Rows)
		}
		table.Rows = table.Rows[start:end]
	}
	return
}

func (tx *Transaction) doUnbindAttrViewBlock(operation *Operation) (ret *TxErr) {
	err := unbindAttributeViewBlock(operation, tx)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID}
	}
	return
}

func unbindAttributeViewBlock(operation *Operation, tx *Transaction) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	node, _, _ := getNodeByBlockID(tx, operation.ID)
	if nil == node {
		return
	}

	for _, keyValues := range attrView.KeyValues {
		for _, value := range keyValues.Values {
			if value.BlockID != operation.ID {
				continue
			}

			if av.KeyTypeBlock == value.Type {
				unbindBlockAv(tx, operation.AvID, value.BlockID)
			}
			value.BlockID = operation.NextID
			value.IsDetached = true
			if nil != value.Block {
				value.Block.ID = operation.NextID
			}

			replaceRelationAvValues(operation.AvID, operation.ID, operation.NextID)
		}
	}

	replacedRowID := false
	for _, v := range attrView.Views {
		switch v.LayoutType {
		case av.LayoutTypeTable:
			for i, rowID := range v.Table.RowIDs {
				if rowID == operation.ID {
					v.Table.RowIDs[i] = operation.NextID
					replacedRowID = true
					break
				}
			}

			if !replacedRowID {
				v.Table.RowIDs = append(v.Table.RowIDs, operation.NextID)
			}
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewColDate(operation *Operation) (ret *TxErr) {
	err := setAttributeViewColDate(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttributeViewColDate(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
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

func (tx *Transaction) doHideAttrViewName(operation *Operation) (ret *TxErr) {
	err := hideAttrViewName(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func hideAttrViewName(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
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
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func updateAttributeViewColRollup(operation *Operation) (err error) {
	// operation.AvID 汇总列所在 av
	// operation.ID 汇总列 ID
	// operation.ParentID 汇总列基于的关联列 ID
	// operation.KeyID 目标列 ID
	// operation.Data 计算方式

	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
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

	if nil != operation.Data {
		data := operation.Data.(map[string]interface{})
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
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doUpdateAttrViewColRelation(operation *Operation) (ret *TxErr) {
	err := updateAttributeViewColRelation(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func updateAttributeViewColRelation(operation *Operation) (err error) {
	// operation.AvID 源 avID
	// operation.ID 目标 avID
	// operation.KeyID 源 av 关联列 ID
	// operation.IsTwoWay 是否双向关联
	// operation.BackRelationKeyID 双向关联的目标关联列 ID
	// operation.Name 双向关联的目标关联列名称
	// operation.Format 源 av 关联列名称

	srcAv, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	destAv, err := av.ParseAttributeView(operation.ID)
	if nil != err {
		return
	}

	isSameAv := srcAv.ID == destAv.ID
	if isSameAv {
		destAv = srcAv
	}

	for _, keyValues := range srcAv.KeyValues {
		if keyValues.Key.ID != operation.KeyID {
			continue
		}

		srcRel := keyValues.Key.Relation
		// 已经设置过双向关联的话需要先断开双向关联
		if nil != srcRel {
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
						if nil != err {
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
				v.Table.Columns = append(v.Table.Columns, &av.ViewTableColumn{ID: operation.BackRelationKeyID})
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
					}
					destVal.Relation.BlockIDs = append(destVal.Relation.BlockIDs, srcVal.BlockID)
					destVal.Relation.BlockIDs = gulu.Str.RemoveDuplicatedElem(destVal.Relation.BlockIDs)
					destKeyValues.Values = append(destKeyValues.Values, destVal)
				}
			}
		}
	}

	err = av.SaveAttributeView(srcAv)
	if nil != err {
		return
	}
	if !isSameAv {
		err = av.SaveAttributeView(destAv)
		util.PushReloadAttrView(destAv.ID)
	}

	av.UpsertAvBackRel(srcAv.ID, destAv.ID)
	if operation.IsTwoWay && !isSameAv {
		av.UpsertAvBackRel(destAv.ID, srcAv.ID)
	}
	return
}

func (tx *Transaction) doSortAttrViewView(operation *Operation) (ret *TxErr) {
	avID := operation.AvID
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		logging.LogErrorf("parse attribute view [%s] failed: %s", operation.AvID, err)
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}

	view := attrView.GetView(operation.ID)
	if nil == view {
		logging.LogErrorf("get view failed: %s", operation.BlockID)
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
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
	if nil == view {
		return
	}

	attrView.Views = append(attrView.Views[:index], attrView.Views[index+1:]...)
	for i, v := range attrView.Views {
		if v.ID == previousViewID {
			previousIndex = i + 1
			break
		}
	}
	attrView.Views = util.InsertElem(attrView.Views, previousIndex, view)

	if err = av.SaveAttributeView(attrView); nil != err {
		logging.LogErrorf("save attribute view [%s] failed: %s", avID, err)
		return &TxErr{code: TxErrCodeWriteTree, msg: err.Error(), id: avID}
	}
	return
}

func (tx *Transaction) doRemoveAttrViewView(operation *Operation) (ret *TxErr) {
	var err error
	avID := operation.AvID
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
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

	attrView.ViewID = attrView.Views[index].ID
	if err = av.SaveAttributeView(attrView); nil != err {
		logging.LogErrorf("save attribute view [%s] failed: %s", avID, err)
		return &TxErr{code: TxErrCodeWriteTree, msg: err.Error(), id: avID}
	}

	trees, nodes := getMirrorBlocksNodes(avID)
	for _, node := range nodes {
		attrs := parse.IAL2Map(node.KramdownIAL)
		blockViewID := attrs[av.NodeAttrView]
		if blockViewID == viewID {
			attrs[av.NodeAttrView] = attrView.ViewID
			oldAttrs, e := setNodeAttrs0(node, attrs)
			if nil != e {
				logging.LogErrorf("set node attrs failed: %s", e)
				continue
			}

			cache.PutBlockIAL(node.ID, parse.IAL2Map(node.KramdownIAL))
			pushBroadcastAttrTransactions(oldAttrs, node)
		}
	}

	for _, tree := range trees {
		if err = indexWriteTreeUpsertQueue(tree); nil != err {
			return
		}
	}
	return
}

func getMirrorBlocksNodes(avID string) (trees []*parse.Tree, nodes []*ast.Node) {
	mirrorBlocks := treenode.GetMirrorAttrViewBlockIDs(avID)
	mirrorBlockTree := map[string]*parse.Tree{}
	treeMap := map[string]*parse.Tree{}
	for _, mirrorBlock := range mirrorBlocks {
		bt := treenode.GetBlockTree(mirrorBlock)
		if nil == bt {
			logging.LogErrorf("get block tree by block ID [%s] failed", mirrorBlock)
			continue
		}

		tree := mirrorBlockTree[mirrorBlock]
		if nil == tree {
			tree, _ = LoadTreeByBlockID(mirrorBlock)
			if nil == tree {
				logging.LogErrorf("load tree by block ID [%s] failed", mirrorBlock)
				continue
			}
			treeMap[tree.ID] = tree
			mirrorBlockTree[mirrorBlock] = tree
		}
	}

	for _, mirrorBlock := range mirrorBlocks {
		tree := mirrorBlockTree[mirrorBlock]
		node := treenode.GetNodeInTree(tree, mirrorBlock)
		if nil == node {
			logging.LogErrorf("get node in tree by block ID [%s] failed", mirrorBlock)
			continue
		}
		nodes = append(nodes, node)
	}

	for _, tree := range treeMap {
		trees = append(trees, tree)
	}
	return
}

func (tx *Transaction) doDuplicateAttrViewView(operation *Operation) (ret *TxErr) {
	var err error
	avID := operation.AvID
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return &TxErr{code: TxErrWriteAttributeView, id: avID}
	}

	masterView := attrView.GetView(operation.PreviousID)
	if nil == masterView {
		logging.LogErrorf("get master view failed: %s", avID)
		return &TxErr{code: TxErrWriteAttributeView, id: avID}
	}

	node, tree, _ := getNodeByBlockID(nil, operation.BlockID)
	if nil == node {
		logging.LogErrorf("get node by block ID [%s] failed", operation.BlockID)
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID}
	}

	attrs := parse.IAL2Map(node.KramdownIAL)
	attrs[av.NodeAttrView] = operation.ID
	err = setNodeAttrs(node, tree, attrs)
	if nil != err {
		logging.LogWarnf("set node [%s] attrs failed: %s", operation.BlockID, err)
		return
	}

	view := av.NewTableView()
	view.ID = operation.ID
	attrView.Views = append(attrView.Views, view)
	attrView.ViewID = view.ID

	view.Icon = masterView.Icon
	view.Name = util.GetDuplicateName(masterView.Name)
	view.LayoutType = masterView.LayoutType
	view.HideAttrViewName = masterView.HideAttrViewName

	for _, col := range masterView.Table.Columns {
		view.Table.Columns = append(view.Table.Columns, &av.ViewTableColumn{
			ID:     col.ID,
			Wrap:   col.Wrap,
			Hidden: col.Hidden,
			Pin:    col.Pin,
			Width:  col.Width,
			Calc:   col.Calc,
		})
	}

	for _, filter := range masterView.Table.Filters {
		view.Table.Filters = append(view.Table.Filters, &av.ViewFilter{
			Column:        filter.Column,
			Operator:      filter.Operator,
			Value:         filter.Value,
			RelativeDate:  filter.RelativeDate,
			RelativeDate2: filter.RelativeDate2,
		})
	}

	for _, s := range masterView.Table.Sorts {
		view.Table.Sorts = append(view.Table.Sorts, &av.ViewSort{
			Column: s.Column,
			Order:  s.Order,
		})
	}

	view.Table.PageSize = masterView.Table.PageSize
	view.Table.RowIDs = masterView.Table.RowIDs

	if err = av.SaveAttributeView(attrView); nil != err {
		logging.LogErrorf("save attribute view [%s] failed: %s", avID, err)
		return &TxErr{code: TxErrWriteAttributeView, msg: err.Error(), id: avID}
	}
	return
}

func (tx *Transaction) doAddAttrViewView(operation *Operation) (ret *TxErr) {
	var err error
	avID := operation.AvID
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return &TxErr{code: TxErrWriteAttributeView, id: avID}
	}

	if 1 > len(attrView.Views) {
		logging.LogErrorf("no view in attribute view [%s]", avID)
		return &TxErr{code: TxErrWriteAttributeView, id: avID}
	}

	firstView := attrView.Views[0]
	if nil == firstView {
		logging.LogErrorf("get first view failed: %s", avID)
		return &TxErr{code: TxErrWriteAttributeView, id: avID}
	}

	node, tree, _ := getNodeByBlockID(nil, operation.BlockID)
	if nil == node {
		logging.LogErrorf("get node by block ID [%s] failed", operation.BlockID)
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID}
	}

	attrs := parse.IAL2Map(node.KramdownIAL)
	attrs[av.NodeAttrView] = operation.ID
	err = setNodeAttrs(node, tree, attrs)
	if nil != err {
		logging.LogWarnf("set node [%s] attrs failed: %s", operation.BlockID, err)
		return
	}

	view := av.NewTableView()
	view.ID = operation.ID
	attrView.Views = append(attrView.Views, view)
	attrView.ViewID = view.ID

	for _, col := range firstView.Table.Columns {
		view.Table.Columns = append(view.Table.Columns, &av.ViewTableColumn{ID: col.ID})
	}

	view.Table.RowIDs = firstView.Table.RowIDs

	if err = av.SaveAttributeView(attrView); nil != err {
		logging.LogErrorf("save attribute view [%s] failed: %s", avID, err)
		return &TxErr{code: TxErrWriteAttributeView, msg: err.Error(), id: avID}
	}
	return
}

func (tx *Transaction) doSetAttrViewViewName(operation *Operation) (ret *TxErr) {
	var err error
	avID := operation.AvID
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return &TxErr{code: TxErrWriteAttributeView, id: avID}
	}

	viewID := operation.ID
	view := attrView.GetView(viewID)
	if nil == view {
		logging.LogErrorf("get view [%s] failed: %s", viewID, err)
		return &TxErr{code: TxErrWriteAttributeView, id: viewID}
	}

	view.Name = strings.TrimSpace(operation.Data.(string))
	if err = av.SaveAttributeView(attrView); nil != err {
		logging.LogErrorf("save attribute view [%s] failed: %s", avID, err)
		return &TxErr{code: TxErrWriteAttributeView, msg: err.Error(), id: avID}
	}
	return
}

func (tx *Transaction) doSetAttrViewViewIcon(operation *Operation) (ret *TxErr) {
	var err error
	avID := operation.AvID
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return &TxErr{code: TxErrWriteAttributeView, id: avID}
	}

	viewID := operation.ID
	view := attrView.GetView(viewID)
	if nil == view {
		logging.LogErrorf("get view [%s] failed: %s", viewID, err)
		return &TxErr{code: TxErrWriteAttributeView, id: viewID}
	}

	view.Icon = operation.Data.(string)
	if err = av.SaveAttributeView(attrView); nil != err {
		logging.LogErrorf("save attribute view [%s] failed: %s", avID, err)
		return &TxErr{code: TxErrWriteAttributeView, msg: err.Error(), id: avID}
	}
	return
}

func (tx *Transaction) doSetAttrViewName(operation *Operation) (ret *TxErr) {
	err := setAttributeViewName(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

const attrAvNameTpl = `<span data-av-id="${avID}" data-popover-url="/api/av/getMirrorDatabaseBlocks" class="popover__block">${avName}</span>`

func setAttributeViewName(operation *Operation) (err error) {
	avID := operation.ID
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		return
	}

	attrView.Name = strings.TrimSpace(operation.Data.(string))
	err = av.SaveAttributeView(attrView)

	nodes := getAttrViewBoundNodes(attrView)
	for _, node := range nodes {
		avNames := getAvNames(node.IALAttr(av.NodeAttrNameAvs))
		oldAttrs := parse.IAL2Map(node.KramdownIAL)
		node.SetIALAttr(av.NodeAttrViewNames, avNames)
		pushBroadcastAttrTransactions(oldAttrs, node)
	}
	return
}

func getAvNames(avIDs string) (ret string) {
	if "" == avIDs {
		return
	}
	avNames := bytes.Buffer{}
	nodeAvIDs := strings.Split(avIDs, ",")
	for _, nodeAvID := range nodeAvIDs {
		nodeAvName, getErr := av.GetAttributeViewName(nodeAvID)
		if nil != getErr {
			continue
		}
		if "" == nodeAvName {
			nodeAvName = Conf.language(105)
		}

		tpl := strings.ReplaceAll(attrAvNameTpl, "${avID}", nodeAvID)
		tpl = strings.ReplaceAll(tpl, "${avName}", nodeAvName)
		avNames.WriteString(tpl)
		avNames.WriteString("&nbsp;")
	}
	if 0 < avNames.Len() {
		avNames.Truncate(avNames.Len() - 6)
		ret = avNames.String()
	}
	return
}

func getAttrViewBoundNodes(attrView *av.AttributeView) (ret []*ast.Node) {
	blockKeyValues := attrView.GetBlockKeyValues()
	treeMap := map[string]*parse.Tree{}
	for _, blockKeyValue := range blockKeyValues.Values {
		if blockKeyValue.IsDetached {
			continue
		}

		var tree *parse.Tree
		tree = treeMap[blockKeyValue.BlockID]
		if nil == tree {
			tree, _ = LoadTreeByBlockID(blockKeyValue.BlockID)
		}
		if nil == tree {
			continue
		}
		treeMap[blockKeyValue.BlockID] = tree

		node := treenode.GetNodeInTree(tree, blockKeyValue.BlockID)
		if nil == node {
			continue
		}

		ret = append(ret, node)
	}
	return
}

func (tx *Transaction) doSetAttrViewFilters(operation *Operation) (ret *TxErr) {
	err := setAttributeViewFilters(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttributeViewFilters(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if nil != err {
		return
	}

	operationData := operation.Data.([]interface{})
	data, err := gulu.JSON.MarshalJSON(operationData)
	if nil != err {
		return
	}

	switch view.LayoutType {
	case av.LayoutTypeTable:
		if err = gulu.JSON.UnmarshalJSON(data, &view.Table.Filters); nil != err {
			return
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewSorts(operation *Operation) (ret *TxErr) {
	err := setAttributeViewSorts(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttributeViewSorts(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if nil != err {
		return
	}

	operationData := operation.Data.([]interface{})
	data, err := gulu.JSON.MarshalJSON(operationData)
	if nil != err {
		return
	}

	switch view.LayoutType {
	case av.LayoutTypeTable:
		if err = gulu.JSON.UnmarshalJSON(data, &view.Table.Sorts); nil != err {
			return
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewPageSize(operation *Operation) (ret *TxErr) {
	err := setAttributeViewPageSize(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttributeViewPageSize(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if nil != err {
		return
	}

	switch view.LayoutType {
	case av.LayoutTypeTable:
		view.Table.PageSize = int(operation.Data.(float64))
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewColCalc(operation *Operation) (ret *TxErr) {
	err := setAttributeViewColumnCalc(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttributeViewColumnCalc(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if nil != err {
		return
	}

	operationData := operation.Data.(interface{})
	data, err := gulu.JSON.MarshalJSON(operationData)
	if nil != err {
		return
	}

	calc := &av.ColumnCalc{}
	switch view.LayoutType {
	case av.LayoutTypeTable:
		if err = gulu.JSON.UnmarshalJSON(data, calc); nil != err {
			return
		}

		for _, column := range view.Table.Columns {
			if column.ID == operation.ID {
				column.Calc = calc
				break
			}
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doInsertAttrViewBlock(operation *Operation) (ret *TxErr) {
	err := AddAttributeViewBlock(tx, operation.Srcs, operation.AvID, operation.BlockID, operation.PreviousID, operation.IgnoreFillFilterVal)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func AddAttributeViewBlock(tx *Transaction, srcs []map[string]interface{}, avID, blockID, previousBlockID string, ignoreFillFilter bool) (err error) {
	slices.Reverse(srcs) // https://github.com/siyuan-note/siyuan/issues/11286

	now := time.Now().UnixMilli()
	for _, src := range srcs {
		srcID := src["id"].(string)
		isDetached := src["isDetached"].(bool)
		var tree *parse.Tree
		if !isDetached {
			var loadErr error
			if nil != tx {
				tree, loadErr = tx.loadTree(srcID)
			} else {
				tree, loadErr = LoadTreeByBlockID(srcID)
			}
			if nil != loadErr {
				logging.LogErrorf("load tree [%s] failed: %s", srcID, loadErr)
				return loadErr
			}
		}

		var srcContent string
		if nil != src["content"] {
			srcContent = src["content"].(string)
		}
		if avErr := addAttributeViewBlock(now, avID, blockID, previousBlockID, srcID, srcContent, isDetached, ignoreFillFilter, tree, tx); nil != avErr {
			return avErr
		}
	}
	return
}

func addAttributeViewBlock(now int64, avID, blockID, previousBlockID, addingBlockID, addingBlockContent string, isDetached, ignoreFillFilter bool, tree *parse.Tree, tx *Transaction) (err error) {
	var node *ast.Node
	if !isDetached {
		node = treenode.GetNodeInTree(tree, addingBlockID)
		if nil == node {
			err = ErrBlockNotFound
			return
		}
	} else {
		if "" == addingBlockID {
			addingBlockID = ast.NewNodeID()
			logging.LogWarnf("detached block id is empty, generate a new one [%s]", addingBlockID)
		}
	}

	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		return
	}

	if !isDetached {
		addingBlockContent = getNodeRefText(node)
	}

	// 检查是否重复添加相同的块
	blockValues := attrView.GetBlockKeyValues()
	for _, blockValue := range blockValues.Values {
		if blockValue.Block.ID == addingBlockID {
			if !isDetached {
				// 重复绑定一下，比如剪切数据库块、取消绑定块后再次添加的场景需要
				bindBlockAv0(tx, avID, node, tree)
				blockValue.IsDetached = isDetached
				blockValue.Block.Content = addingBlockContent
				blockValue.UpdatedAt = now
				err = av.SaveAttributeView(attrView)
			}
			return
		}
	}

	blockValue := &av.Value{
		ID:         ast.NewNodeID(),
		KeyID:      blockValues.Key.ID,
		BlockID:    addingBlockID,
		Type:       av.KeyTypeBlock,
		IsDetached: isDetached,
		CreatedAt:  now,
		UpdatedAt:  now,
		Block:      &av.ValueBlock{ID: addingBlockID, Content: addingBlockContent, Created: now, Updated: now}}
	blockValues.Values = append(blockValues.Values, blockValue)

	// 如果存在过滤条件，则将过滤条件应用到新添加的块上
	view, _ := getAttrViewViewByBlockID(attrView, blockID)
	if nil != view && 0 < len(view.Table.Filters) && !ignoreFillFilter {
		viewable := sql.RenderAttributeViewTable(attrView, view, "", GetBlockAttrsWithoutWaitWriting)
		viewable.FilterRows(attrView)
		viewable.SortRows(attrView)

		var nearRow *av.TableRow
		if 0 < len(viewable.Rows) {
			if "" != previousBlockID {
				for _, row := range viewable.Rows {
					if row.ID == previousBlockID {
						nearRow = row
						break
					}
				}
			} else {
				if 0 < len(viewable.Rows) {
					nearRow = viewable.Rows[0]
				}
			}
		}

		sameKeyFilterSort := false // 是否在同一个字段上同时存在过滤和排序
		if 0 < len(viewable.Sorts) {
			filterKeys, sortKeys := map[string]bool{}, map[string]bool{}
			for _, f := range view.Table.Filters {
				filterKeys[f.Column] = true
			}
			for _, s := range view.Table.Sorts {
				sortKeys[s.Column] = true
			}

			for key := range filterKeys {
				if sortKeys[key] {
					sameKeyFilterSort = true
					break
				}
			}
		}

		if !sameKeyFilterSort {
			// 如果在同一个字段上仅存在过滤条件，则将过滤条件应用到新添加的块上
			for _, filter := range view.Table.Filters {
				for _, keyValues := range attrView.KeyValues {
					if keyValues.Key.ID == filter.Column {
						var defaultVal *av.Value
						if nil != nearRow {
							defaultVal = nearRow.GetValue(filter.Column)
						}

						newValue := filter.GetAffectValue(keyValues.Key, defaultVal)
						if nil == newValue {
							continue
						}

						if av.KeyTypeBlock == newValue.Type {
							// 如果是主键的话前面已经添加过了，这里仅修改内容
							blockValue.Block.Content = newValue.Block.Content
							break
						}

						newValue.ID = ast.NewNodeID()
						newValue.KeyID = keyValues.Key.ID
						newValue.BlockID = addingBlockID
						newValue.IsDetached = isDetached
						keyValues.Values = append(keyValues.Values, newValue)
						break
					}
				}
			}
		}
	}

	// 处理日期字段默认填充当前创建时间
	// The database date field supports filling the current time by default https://github.com/siyuan-note/siyuan/issues/10823
	for _, keyValues := range attrView.KeyValues {
		if av.KeyTypeDate == keyValues.Key.Type && nil != keyValues.Key.Date && keyValues.Key.Date.AutoFillNow {
			dateVal := &av.Value{
				ID: ast.NewNodeID(), KeyID: keyValues.Key.ID, BlockID: addingBlockID, Type: av.KeyTypeDate, IsDetached: isDetached, CreatedAt: now, UpdatedAt: now + 1000,
				Date: &av.ValueDate{Content: now, IsNotEmpty: true},
			}
			keyValues.Values = append(keyValues.Values, dateVal)
		}
	}

	if !isDetached {
		bindBlockAv0(tx, avID, node, tree)
	}

	for _, v := range attrView.Views {
		switch v.LayoutType {
		case av.LayoutTypeTable:
			if "" != previousBlockID {
				changed := false
				for i, id := range v.Table.RowIDs {
					if id == previousBlockID {
						v.Table.RowIDs = append(v.Table.RowIDs[:i+1], append([]string{addingBlockID}, v.Table.RowIDs[i+1:]...)...)
						changed = true
						break
					}
				}
				if !changed {
					v.Table.RowIDs = append(v.Table.RowIDs, addingBlockID)
				}
			} else {
				v.Table.RowIDs = append([]string{addingBlockID}, v.Table.RowIDs...)
			}
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doRemoveAttrViewBlock(operation *Operation) (ret *TxErr) {
	err := removeAttributeViewBlock(operation.SrcIDs, operation.AvID, tx)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID}
	}
	return
}

func RemoveAttributeViewBlock(srcIDs []string, avID string) (err error) {
	err = removeAttributeViewBlock(srcIDs, avID, nil)
	return
}

func removeAttributeViewBlock(srcIDs []string, avID string, tx *Transaction) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		return
	}

	trees := map[string]*parse.Tree{}
	for _, keyValues := range attrView.KeyValues {
		tmp := keyValues.Values[:0]
		for i, values := range keyValues.Values {
			if !gulu.Str.Contains(values.BlockID, srcIDs) {
				tmp = append(tmp, keyValues.Values[i])
			} else {
				// Remove av block also remove node attr https://github.com/siyuan-note/siyuan/issues/9091#issuecomment-1709824006
				if bt := treenode.GetBlockTree(values.BlockID); nil != bt {
					tree := trees[bt.RootID]
					if nil == tree {
						tree, _ = LoadTreeByBlockID(values.BlockID)
					}

					if nil != tree {
						trees[bt.RootID] = tree
						if node := treenode.GetNodeInTree(tree, values.BlockID); nil != node {
							if err = removeNodeAvID(node, avID, tx, tree); nil != err {
								return
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
			view.Table.RowIDs = gulu.Str.RemoveElem(view.Table.RowIDs, blockID)
		}
	}

	relatedAvIDs := av.GetSrcAvIDs(avID)
	for _, relatedAvID := range relatedAvIDs {
		util.PushReloadAttrView(relatedAvID)
	}

	err = av.SaveAttributeView(attrView)
	return
}

func removeNodeAvID(node *ast.Node, avID string, tx *Transaction, tree *parse.Tree) (err error) {
	attrs := parse.IAL2Map(node.KramdownIAL)
	if ast.NodeDocument == node.Type {
		delete(attrs, "custom-hidden")
		node.RemoveIALAttr("custom-hidden")
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
		if err = setNodeAttrsWithTx(tx, node, tree, attrs); nil != err {
			return
		}
	} else {
		if err = setNodeAttrs(node, tree, attrs); nil != err {
			return
		}
	}
	return
}

func (tx *Transaction) doDuplicateAttrViewKey(operation *Operation) (ret *TxErr) {
	err := duplicateAttributeViewKey(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func duplicateAttributeViewKey(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	key, _ := attrView.GetKey(operation.KeyID)
	if nil == key {
		return
	}

	if av.KeyTypeBlock == key.Type || av.KeyTypeRelation == key.Type || av.KeyTypeRollup == key.Type {
		return
	}

	copyKey := &av.Key{}
	if err = copier.Copy(copyKey, key); nil != err {
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
							ID:     copyKey.ID,
							Wrap:   column.Wrap,
							Hidden: column.Hidden,
							Pin:    column.Pin,
							Width:  column.Width,
						},
					}, view.Table.Columns[i+1:]...)...)
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
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttributeViewColWidth(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if nil != err {
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
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewColumnWrap(operation *Operation) (ret *TxErr) {
	err := setAttributeViewColWrap(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttributeViewColWrap(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if nil != err {
		return
	}

	switch view.LayoutType {
	case av.LayoutTypeTable:
		for _, column := range view.Table.Columns {
			if column.ID == operation.ID {
				column.Wrap = operation.Data.(bool)
				break
			}
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewColumnHidden(operation *Operation) (ret *TxErr) {
	err := setAttributeViewColHidden(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttributeViewColHidden(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if nil != err {
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
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewColumnPin(operation *Operation) (ret *TxErr) {
	err := setAttributeViewColPin(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttributeViewColPin(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if nil != err {
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
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSetAttrViewColumnIcon(operation *Operation) (ret *TxErr) {
	err := setAttributeViewColIcon(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func setAttributeViewColIcon(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
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

func (tx *Transaction) doSortAttrViewRow(operation *Operation) (ret *TxErr) {
	err := sortAttributeViewRow(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func sortAttributeViewRow(operation *Operation) (err error) {
	if operation.ID == operation.PreviousID {
		// 拖拽到自己的下方，不做任何操作 https://github.com/siyuan-note/siyuan/issues/11048
		return
	}

	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if nil != err {
		return
	}

	var rowID string
	var idx, previousIndex int
	for i, r := range view.Table.RowIDs {
		if r == operation.ID {
			rowID = r
			idx = i
			break
		}
	}
	if "" == rowID {
		rowID = operation.ID
		view.Table.RowIDs = append(view.Table.RowIDs, rowID)
		idx = len(view.Table.RowIDs) - 1
	}

	switch view.LayoutType {
	case av.LayoutTypeTable:
		view.Table.RowIDs = append(view.Table.RowIDs[:idx], view.Table.RowIDs[idx+1:]...)
		for i, r := range view.Table.RowIDs {
			if r == operation.PreviousID {
				previousIndex = i + 1
				break
			}
		}
		view.Table.RowIDs = util.InsertElem(view.Table.RowIDs, previousIndex, rowID)
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSortAttrViewColumn(operation *Operation) (ret *TxErr) {
	err := SortAttributeViewViewKey(operation.AvID, operation.BlockID, operation.ID, operation.PreviousID)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func SortAttributeViewViewKey(avID, blockID, keyID, previousKeyID string) (err error) {
	if keyID == previousKeyID {
		// 拖拽到自己的右侧，不做任何操作 https://github.com/siyuan-note/siyuan/issues/11048
		return
	}

	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, blockID)
	if nil != err {
		return
	}

	switch view.LayoutType {
	case av.LayoutTypeTable:
		var col *av.ViewTableColumn
		var index, previousIndex int
		for i, column := range view.Table.Columns {
			if column.ID == keyID {
				col = column
				index = i
				break
			}
		}
		if nil == col {
			return
		}

		view.Table.Columns = append(view.Table.Columns[:index], view.Table.Columns[index+1:]...)
		for i, column := range view.Table.Columns {
			if column.ID == previousKeyID {
				previousIndex = i + 1
				break
			}
		}
		view.Table.Columns = util.InsertElem(view.Table.Columns, previousIndex, col)
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doSortAttrViewKey(operation *Operation) (ret *TxErr) {
	err := SortAttributeViewKey(operation.AvID, operation.ID, operation.PreviousID)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func SortAttributeViewKey(avID, keyID, previousKeyID string) (err error) {
	if keyID == previousKeyID {
		return
	}

	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		return
	}

	refreshAttrViewKeyIDs(attrView)

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

func refreshAttrViewKeyIDs(attrView *av.AttributeView) {
	// 订正 keyIDs 数据

	existKeyIDs := map[string]bool{}
	for _, keyValues := range attrView.KeyValues {
		existKeyIDs[keyValues.Key.ID] = true
	}

	for k, _ := range existKeyIDs {
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
}

func (tx *Transaction) doAddAttrViewColumn(operation *Operation) (ret *TxErr) {
	var icon string
	if nil != operation.Data {
		icon = operation.Data.(string)
	}
	err := AddAttributeViewKey(operation.AvID, operation.ID, operation.Name, operation.Typ, icon, operation.PreviousID)

	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func AddAttributeViewKey(avID, keyID, keyName, keyType, keyIcon, previousKeyID string) (err error) {
	attrView, err := av.ParseAttributeView(avID)
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
			switch view.LayoutType {
			case av.LayoutTypeTable:
				if "" == previousKeyID {
					view.Table.Columns = append([]*av.ViewTableColumn{{ID: key.ID}}, view.Table.Columns...)
					break
				}

				added := false
				for i, column := range view.Table.Columns {
					if column.ID == previousKeyID {
						view.Table.Columns = append(view.Table.Columns[:i+1], append([]*av.ViewTableColumn{{ID: key.ID}}, view.Table.Columns[i+1:]...)...)
						added = true
						break
					}
				}
				if !added {
					view.Table.Columns = append(view.Table.Columns, &av.ViewTableColumn{ID: key.ID})
				}
			}
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doUpdateAttrViewColTemplate(operation *Operation) (ret *TxErr) {
	err := updateAttributeViewColTemplate(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func updateAttributeViewColTemplate(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
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

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doUpdateAttrViewColNumberFormat(operation *Operation) (ret *TxErr) {
	err := updateAttributeViewColNumberFormat(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func updateAttributeViewColNumberFormat(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
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
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func updateAttributeViewColumn(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	colType := av.KeyType(operation.Typ)
	switch colType {
	case av.KeyTypeBlock, av.KeyTypeText, av.KeyTypeNumber, av.KeyTypeDate, av.KeyTypeSelect, av.KeyTypeMSelect, av.KeyTypeURL, av.KeyTypeEmail,
		av.KeyTypePhone, av.KeyTypeMAsset, av.KeyTypeTemplate, av.KeyTypeCreated, av.KeyTypeUpdated, av.KeyTypeCheckbox,
		av.KeyTypeRelation, av.KeyTypeRollup, av.KeyTypeLineNumber:
		for _, keyValues := range attrView.KeyValues {
			if keyValues.Key.ID == operation.ID {
				keyValues.Key.Name = strings.TrimSpace(operation.Name)
				keyValues.Key.Type = colType

				for _, value := range keyValues.Values {
					value.Type = colType
				}

				break
			}
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doRemoveAttrViewColumn(operation *Operation) (ret *TxErr) {
	err := RemoveAttributeViewKey(operation.AvID, operation.ID)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func RemoveAttributeViewKey(avID, keyID string) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		return
	}

	var removedKey *av.Key
	for i, keyValues := range attrView.KeyValues {
		if keyValues.Key.ID == keyID {
			attrView.KeyValues = append(attrView.KeyValues[:i], attrView.KeyValues[i+1:]...)
			removedKey = keyValues.Key
			break
		}
	}

	if nil != removedKey && av.KeyTypeRelation == removedKey.Type && nil != removedKey.Relation {
		if removedKey.Relation.IsTwoWay {
			// 删除双向关联的目标列

			var destAv *av.AttributeView
			if avID == removedKey.Relation.AvID {
				destAv = attrView
			} else {
				destAv, _ = av.ParseAttributeView(removedKey.Relation.AvID)
			}

			if nil != destAv {
				destAvRelSrcAv := false
				for i, keyValues := range destAv.KeyValues {
					if keyValues.Key.ID == removedKey.Relation.BackKeyID {
						destAv.KeyValues = append(destAv.KeyValues[:i], destAv.KeyValues[i+1:]...)
						continue
					}

					if av.KeyTypeRelation == keyValues.Key.Type && keyValues.Key.Relation.AvID == attrView.ID {
						destAvRelSrcAv = true
					}
				}

				for _, view := range destAv.Views {
					switch view.LayoutType {
					case av.LayoutTypeTable:
						for i, column := range view.Table.Columns {
							if column.ID == removedKey.Relation.BackKeyID {
								view.Table.Columns = append(view.Table.Columns[:i], view.Table.Columns[i+1:]...)
								break
							}
						}
					}
				}

				if destAv != attrView {
					av.SaveAttributeView(destAv)
					util.PushReloadAttrView(destAv.ID)
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
		switch view.LayoutType {
		case av.LayoutTypeTable:
			for i, column := range view.Table.Columns {
				if column.ID == keyID {
					view.Table.Columns = append(view.Table.Columns[:i], view.Table.Columns[i+1:]...)
					break
				}
			}
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doReplaceAttrViewBlock(operation *Operation) (ret *TxErr) {
	err := replaceAttributeViewBlock(operation, tx)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID}
	}
	return
}

func replaceAttributeViewBlock(operation *Operation, tx *Transaction) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	var node *ast.Node
	if !operation.IsDetached {
		node, _, _ = getNodeByBlockID(tx, operation.NextID)
	}

	// 检查是否已经存在绑定块
	// Improve database primary key binding block https://github.com/siyuan-note/siyuan/issues/10945
	for _, keyValues := range attrView.KeyValues {
		for _, value := range keyValues.Values {
			if value.BlockID == operation.NextID {
				util.PushMsg(Conf.language(242), 3000)
				return
			}
		}
	}

	for _, keyValues := range attrView.KeyValues {
		for _, value := range keyValues.Values {
			if value.BlockID != operation.PreviousID {
				continue
			}

			if av.KeyTypeBlock == value.Type && value.BlockID != operation.NextID {
				// 换绑
				unbindBlockAv(tx, operation.AvID, value.BlockID)
			}

			value.BlockID = operation.NextID
			if av.KeyTypeBlock == value.Type && nil != value.Block {
				value.Block.ID = operation.NextID
				value.IsDetached = operation.IsDetached
				if !operation.IsDetached {
					value.Block.Content = getNodeRefText(node)
				}
			}

			if av.KeyTypeBlock == value.Type && !operation.IsDetached {
				bindBlockAv(tx, operation.AvID, operation.NextID)

				replaceRelationAvValues(operation.AvID, operation.PreviousID, operation.NextID)
			}
		}
	}

	replacedRowID := false
	for _, v := range attrView.Views {
		switch v.LayoutType {
		case av.LayoutTypeTable:
			for i, rowID := range v.Table.RowIDs {
				if rowID == operation.PreviousID {
					v.Table.RowIDs[i] = operation.NextID
					replacedRowID = true
					break
				}
			}

			if !replacedRowID {
				v.Table.RowIDs = append(v.Table.RowIDs, operation.NextID)
			}
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doUpdateAttrViewCell(operation *Operation) (ret *TxErr) {
	err := updateAttributeViewCell(operation, tx)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func updateAttributeViewCell(operation *Operation, tx *Transaction) (err error) {
	err = UpdateAttributeViewCell(tx, operation.AvID, operation.KeyID, operation.RowID, operation.ID, operation.Data)
	return
}

func UpdateAttributeViewCell(tx *Transaction, avID, keyID, rowID, cellID string, valueData interface{}) (err error) {
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		return
	}

	var blockVal *av.Value
	for _, kv := range attrView.KeyValues {
		if av.KeyTypeBlock == kv.Key.Type {
			for _, v := range kv.Values {
				if rowID == v.Block.ID {
					blockVal = v
					break
				}
			}
			break
		}
	}

	now := time.Now().UnixMilli()
	var val *av.Value
	oldIsDetached := true
	if nil != blockVal {
		oldIsDetached = blockVal.IsDetached
	}
	for _, keyValues := range attrView.KeyValues {
		if keyID != keyValues.Key.ID {
			continue
		}

		for _, value := range keyValues.Values {
			if cellID == value.ID || rowID == value.BlockID {
				val = value
				val.Type = keyValues.Key.Type
				break
			}
		}

		if nil == val {
			val = &av.Value{ID: cellID, KeyID: keyID, BlockID: rowID, Type: keyValues.Key.Type, CreatedAt: now, UpdatedAt: now}
			keyValues.Values = append(keyValues.Values, val)
		}
		break
	}

	isUpdatingBlockKey := av.KeyTypeBlock == val.Type
	oldBoundBlockID := val.BlockID
	var oldRelationBlockIDs []string
	if av.KeyTypeRelation == val.Type {
		if nil != val.Relation {
			for _, bID := range val.Relation.BlockIDs {
				oldRelationBlockIDs = append(oldRelationBlockIDs, bID)
			}
		}
	}
	data, err := gulu.JSON.MarshalJSON(valueData)
	if nil != err {
		return
	}
	if err = gulu.JSON.UnmarshalJSON(data, &val); nil != err {
		return
	}

	key, _ := attrView.GetKey(keyID)

	if av.KeyTypeNumber == val.Type {
		if nil != val.Number && !val.Number.IsNotEmpty {
			val.Number.Content = 0
			val.Number.FormattedContent = ""
		}
	} else if av.KeyTypeDate == val.Type {
		if nil != val.Date && !val.Date.IsNotEmpty {
			val.Date.Content = 0
			val.Date.FormattedContent = ""
		}
	} else if av.KeyTypeSelect == val.Type || av.KeyTypeMSelect == val.Type {
		if nil != key && 0 < len(val.MSelect) {
			// The selection options are inconsistent after pasting data into the database https://github.com/siyuan-note/siyuan/issues/11409
			for _, valOpt := range val.MSelect {
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

	relationChangeMode := 0 // 0：不变（仅排序），1：增加，2：减少
	if av.KeyTypeRelation == val.Type {
		// 关联列得 content 是自动渲染的，所以不需要保存
		val.Relation.Contents = nil

		// 去重
		val.Relation.BlockIDs = gulu.Str.RemoveDuplicatedElem(val.Relation.BlockIDs)

		// 计算关联变更模式
		if len(oldRelationBlockIDs) == len(val.Relation.BlockIDs) {
			relationChangeMode = 0
		} else {
			if len(oldRelationBlockIDs) > len(val.Relation.BlockIDs) {
				relationChangeMode = 2
			} else {
				relationChangeMode = 1
			}
		}
	}

	// val.IsDetached 只有更新主键的时候才会传入，所以下面需要结合 isUpdatingBlockKey 来判断

	if oldIsDetached {
		// 之前是游离行

		if !val.IsDetached { // 现在绑定了块
			// 将游离行绑定到新建的块上
			bindBlockAv(tx, avID, rowID)
		}
	} else {
		// 之前绑定了块

		if isUpdatingBlockKey { // 正在更新主键
			if val.IsDetached { // 现在是游离行
				// 将绑定的块从属性视图中移除
				unbindBlockAv(tx, avID, rowID)
			} else {
				// 现在绑定了块

				if oldBoundBlockID != val.BlockID { // 之前绑定的块和现在绑定的块不一样
					// 换绑块
					unbindBlockAv(tx, avID, oldBoundBlockID)
					bindBlockAv(tx, avID, val.BlockID)
				} else { // 之前绑定的块和现在绑定的块一样
					// 直接返回，因为锚文本不允许更改
					return
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

		var destAv *av.AttributeView
		if avID == key.Relation.AvID {
			destAv = attrView
		} else {
			destAv, _ = av.ParseAttributeView(key.Relation.AvID)
		}

		if nil != destAv {
			// relationChangeMode
			// 0：关联列值不变（仅排序），不影响目标值
			// 1：关联列值增加，增加目标值
			// 2：关联列值减少，减少目标值

			if 1 == relationChangeMode {
				addBlockIDs := val.Relation.BlockIDs
				for _, bID := range oldRelationBlockIDs {
					addBlockIDs = gulu.Str.RemoveElem(addBlockIDs, bID)
				}

				for _, blockID := range addBlockIDs {
					for _, keyValues := range destAv.KeyValues {
						if keyValues.Key.ID != key.Relation.BackKeyID {
							continue
						}

						destVal := keyValues.GetValue(blockID)
						if nil == destVal {
							destVal = &av.Value{ID: ast.NewNodeID(), KeyID: keyValues.Key.ID, BlockID: blockID, Type: keyValues.Key.Type, Relation: &av.ValueRelation{}, CreatedAt: now, UpdatedAt: now + 1000}
							keyValues.Values = append(keyValues.Values, destVal)
						}

						destVal.Relation.BlockIDs = append(destVal.Relation.BlockIDs, rowID)
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
						if keyValues.Key.ID != key.Relation.BackKeyID {
							continue
						}

						for _, value := range keyValues.Values {
							if value.BlockID == blockID {
								value.Relation.BlockIDs = gulu.Str.RemoveElem(value.Relation.BlockIDs, rowID)
								value.SetUpdatedAt(now)
								break
							}
						}
					}
				}
			}

			if destAv != attrView {
				av.SaveAttributeView(destAv)
			}
		}
	}

	relatedAvIDs := av.GetSrcAvIDs(avID)
	for _, relatedAvID := range relatedAvIDs {
		util.PushReloadAttrView(relatedAvID)
	}

	if err = av.SaveAttributeView(attrView); nil != err {
		return
	}
	return
}

func unbindBlockAv(tx *Transaction, avID, blockID string) {
	node, tree, err := getNodeByBlockID(tx, blockID)
	if nil != err {
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
	if nil != err {
		logging.LogWarnf("set node [%s] attrs failed: %s", blockID, err)
		return
	}
	return
}

func bindBlockAv(tx *Transaction, avID, blockID string) {
	node, tree, err := getNodeByBlockID(tx, blockID)
	if nil != err {
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
	if nil != err {
		logging.LogWarnf("set node [%s] attrs failed: %s", node.ID, err)
		return
	}
	return
}

func getNodeByBlockID(tx *Transaction, blockID string) (node *ast.Node, tree *parse.Tree, err error) {
	if nil != tx {
		tree, err = tx.loadTree(blockID)
	} else {
		tree, err = LoadTreeByBlockID(blockID)
	}
	if nil != err {
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
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func updateAttributeViewColumnOptions(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	jsonData, err := gulu.JSON.MarshalJSON(operation.Data)
	if nil != err {
		return
	}

	options := []*av.SelectOption{}
	if err = gulu.JSON.UnmarshalJSON(jsonData, &options); nil != err {
		return
	}

	for _, keyValues := range attrView.KeyValues {
		if keyValues.Key.ID == operation.ID {
			keyValues.Key.Options = options
			err = av.SaveAttributeView(attrView)
			return
		}
	}
	return
}

func (tx *Transaction) doRemoveAttrViewColOption(operation *Operation) (ret *TxErr) {
	err := removeAttributeViewColumnOption(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func removeAttributeViewColumnOption(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	optName := operation.Data.(string)

	key, err := attrView.GetKey(operation.ID)
	if nil != err {
		return
	}

	for i, opt := range key.Options {
		if optName == opt.Name {
			key.Options = append(key.Options[:i], key.Options[i+1:]...)
			break
		}
	}

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

	err = av.SaveAttributeView(attrView)
	return
}

func (tx *Transaction) doUpdateAttrViewColOption(operation *Operation) (ret *TxErr) {
	err := updateAttributeViewColumnOption(operation)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func updateAttributeViewColumnOption(operation *Operation) (err error) {
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	key, err := attrView.GetKey(operation.ID)
	if nil != err {
		return
	}

	data := operation.Data.(map[string]interface{})

	oldName := data["oldName"].(string)
	newName := data["newName"].(string)
	newColor := data["newColor"].(string)

	for i, opt := range key.Options {
		if oldName == opt.Name {
			key.Options[i].Name = newName
			key.Options[i].Color = newColor
			break
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

			for i, opt := range value.MSelect {
				if oldName == opt.Content {
					value.MSelect[i].Content = newName
					value.MSelect[i].Color = newColor
					break
				}
			}
		}
		break
	}

	// 如果存在选项对应的过滤器，需要更新过滤器中设置的选项值
	// Database select field filters follow option editing changes https://github.com/siyuan-note/siyuan/issues/10881
	for _, view := range attrView.Views {
		switch view.LayoutType {
		case av.LayoutTypeTable:
			table := view.Table
			for _, filter := range table.Filters {
				if filter.Column != key.ID {
					continue
				}

				if nil != filter.Value && (av.KeyTypeSelect == filter.Value.Type || av.KeyTypeMSelect == filter.Value.Type) {
					for i, opt := range filter.Value.MSelect {
						if oldName == opt.Content {
							filter.Value.MSelect[i].Content = newName
							filter.Value.MSelect[i].Color = newColor
							break
						}
					}
				}
			}
		}
	}

	err = av.SaveAttributeView(attrView)
	return
}

func getAttrViewViewByBlockID(attrView *av.AttributeView, blockID string) (ret *av.View, err error) {
	node, _, _ := getNodeByBlockID(nil, blockID)
	var viewID string
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

func replaceRelationAvValues(avID, previousID, nextID string) {
	// The database relation fields follow the change after the primary key field is changed https://github.com/siyuan-note/siyuan/issues/11117

	srcAvIDs := av.GetSrcAvIDs(avID)
	for _, srcAvID := range srcAvIDs {
		srcAv, parseErr := av.ParseAttributeView(srcAvID)
		changed := false
		if nil != parseErr {
			continue
		}

		for _, srcKeyValues := range srcAv.KeyValues {
			if av.KeyTypeRelation != srcKeyValues.Key.Type {
				continue
			}

			if nil == srcKeyValues.Key.Relation || avID != srcKeyValues.Key.Relation.AvID {
				continue
			}

			for _, srcValue := range srcKeyValues.Values {
				if nil == srcValue.Relation {
					continue
				}

				srcAvChanged := false
				srcValue.Relation.BlockIDs, srcAvChanged = util.ReplaceStr(srcValue.Relation.BlockIDs, previousID, nextID)
				if srcAvChanged {
					changed = true
				}
			}
		}

		if changed {
			av.SaveAttributeView(srcAv)
			util.PushReloadAttrView(srcAvID)
		}
	}
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
		for _, blockValue := range blockKeyValues.Values {
			if blockValue.IsDetached {
				continue
			}
			bt := treenode.GetBlockTree(blockValue.BlockID)
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

			node := treenode.GetNodeInTree(tree, blockValue.BlockID)
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

			oldAttrs, setErr := setNodeAttrs0(node, attrs)
			if nil != setErr {
				continue
			}
			cache.PutBlockIAL(node.ID, parse.IAL2Map(node.KramdownIAL))
			pushBroadcastAttrTransactions(oldAttrs, node)
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
