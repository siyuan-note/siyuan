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
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"text/template"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

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

func GetAttributeViewPrimaryKeyValues(avID, keyword string, page, pageSize int) (attributeViewName string, keyValues *av.KeyValues, err error) {
	waitForSyncingStorages()

	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}
	attributeViewName = attrView.Name

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

				if gulu.Str.Contains(kv.Block.ID, view.Table.RowIDs) {
					tmp[kv.Block.ID] = kv
				}
			}
		}
	}
	keyValues.Values = []*av.Value{}
	for _, v := range tmp {
		if strings.Contains(strings.ToLower(v.String()), strings.ToLower(keyword)) {
			keyValues.Values = append(keyValues.Values, v)
		}
	}

	if 1 > pageSize {
		pageSize = 32
	}
	start := (page - 1) * pageSize
	end := start + pageSize
	if len(keyValues.Values) < end {
		end = len(keyValues.Values)
	}
	keyValues.Values = keyValues.Values[start:end]
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
		if av.KeyTypeRelation != keyValues.Key.Type && av.KeyTypeRollup != keyValues.Key.Type && av.KeyTypeTemplate != keyValues.Key.Type && av.KeyTypeCreated != keyValues.Key.Type && av.KeyTypeUpdated != keyValues.Key.Type {
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

func SearchAttributeView(keyword string, page int, pageSize int) (ret []*SearchAttributeViewResult, pageCount int) {
	waitForSyncingStorages()
	ret = []*SearchAttributeViewResult{}

	var blocks []*Block
	keyword = strings.TrimSpace(keyword)
	if "" == keyword {
		sqlBlocks := sql.SelectBlocksRawStmt("SELECT * FROM blocks WHERE type = 'av' ORDER BY updated DESC LIMIT 10", page, pageSize)
		blocks = fromSQLBlocks(&sqlBlocks, "", 36)
		pageCount = 1
	} else {
		var matchedBlockCount int
		blocks, matchedBlockCount, _ = fullTextSearchByKeyword(keyword, "", "", "('av')", "", 36, page, pageSize)
		pageCount = (matchedBlockCount + pageSize - 1) / pageSize
	}

	trees := map[string]*parse.Tree{}
	for _, block := range blocks {
		tree := trees[block.RootID]
		if nil == tree {
			tree, _ = LoadTreeByBlockID(block.ID)
			if nil != tree {
				trees[block.RootID] = tree
			}
		}
		if nil == tree {
			continue
		}

		node := treenode.GetNodeInTree(tree, block.ID)
		if nil == node {
			continue
		}

		if "" == node.AttributeViewID {
			continue
		}

		avID := node.AttributeViewID
		attrView, _ := av.ParseAttributeView(avID)
		if nil == attrView {
			continue
		}

		exist := false
		for _, result := range ret {
			if result.AvID == avID {
				exist = true
				break
			}
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

		if !exist {
			ret = append(ret, &SearchAttributeViewResult{
				AvID:    avID,
				AvName:  attrView.Name,
				BlockID: block.ID,
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
			return
		}

		if 1 > len(attrView.Views) {
			err = av.ErrViewNotFound
			return
		}

		var keyValues []*av.KeyValues
		for _, kv := range attrView.KeyValues {
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
				kValues.Values = append(kValues.Values, treenode.GetAttributeViewDefaultValue(ast.NewNodeID(), kv.Key.ID, blockID, kv.Key.Type))
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
								destVal = treenode.GetAttributeViewDefaultValue(ast.NewNodeID(), kv.Key.Rollup.KeyID, blockID, destKey.Type)
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
		// 获取闪卡信息
		// TODO 目前看来使用场景不多，暂时不实现了 https://github.com/siyuan-note/siyuan/issues/10502#issuecomment-1986703280
		var flashcard *Flashcard
		//deck := Decks[builtinDeckID]
		//if nil != deck {
		//	blockIDs := []string{blockID}
		//	cards := deck.GetCardsByBlockIDs(blockIDs)
		//	now := time.Now()
		//	if 0 < len(cards) {
		//		flashcard = newFlashcard(cards[0], builtinDeckID, now)
		//	}
		//}

		// 渲染模板
		for _, kv := range keyValues {
			switch kv.Key.Type {
			case av.KeyTypeTemplate:
				if 0 < len(kv.Values) {
					ial := map[string]string{}
					block := getRowBlockValue(keyValues)
					if nil != block && !block.IsDetached {
						ial = GetBlockAttrsWithoutWaitWriting(block.ID)
					}

					kv.Values[0].Template.Content = renderTemplateCol(ial, flashcard, keyValues, kv.Key.Template)
				}
			}
		}

		// Attribute Panel - Database sort attributes by view column order https://github.com/siyuan-note/siyuan/issues/9319
		viewID := attrs[av.NodeAttrView]
		view, _ := attrView.GetCurrentView(viewID)
		if nil != view {
			sorts := map[string]int{}
			for i, col := range view.Table.Columns {
				sorts[col.ID] = i
			}

			sort.Slice(keyValues, func(i, j int) bool {
				return sorts[keyValues[i].Key.ID] < sorts[keyValues[j].Key.ID]
			})
		}

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
			AvName:    attrView.Name,
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
		view, _ := av.NewTableViewWithBlockKey(ast.NewNodeID())
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

		viewable, err = renderAttributeViewTable(attrView, view, query)
	}

	viewable.FilterRows(attrView)
	viewable.SortRows()
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

func renderTemplateCol(ial map[string]string, flashcard *Flashcard, rowValues []*av.KeyValues, tplContent string) string {
	if "" == ial["id"] {
		block := getRowBlockValue(rowValues)
		if nil != block && nil != block.Block {
			ial["id"] = block.Block.ID
		}
	}
	if "" == ial["updated"] {
		block := getRowBlockValue(rowValues)
		if nil != block && nil != block.Block {
			ial["updated"] = time.UnixMilli(block.Block.Updated).Format("20060102150405")
		}
	}

	goTpl := template.New("").Delims(".action{", "}")
	tplFuncMap := util.BuiltInTemplateFuncs()
	SQLTemplateFuncs(&tplFuncMap)
	goTpl = goTpl.Funcs(tplFuncMap)
	tpl, tplErr := goTpl.Parse(tplContent)
	if nil != tplErr {
		logging.LogWarnf("parse template [%s] failed: %s", tplContent, tplErr)
		return ""
	}

	buf := &bytes.Buffer{}
	dataModel := map[string]interface{}{} // 复制一份 IAL 以避免修改原始数据
	for k, v := range ial {
		dataModel[k] = v

		// Database template column supports `created` and `updated` built-in variables https://github.com/siyuan-note/siyuan/issues/9364
		createdStr := ial["id"]
		if "" != createdStr {
			createdStr = createdStr[:len("20060102150405")]
		}
		created, parseErr := time.ParseInLocation("20060102150405", createdStr, time.Local)
		if nil == parseErr {
			dataModel["created"] = created
		} else {
			logging.LogWarnf("parse created [%s] failed: %s", createdStr, parseErr)
			dataModel["created"] = time.Now()
		}
		updatedStr := ial["updated"]
		updated, parseErr := time.ParseInLocation("20060102150405", updatedStr, time.Local)
		if nil == parseErr {
			dataModel["updated"] = updated
		} else {
			dataModel["updated"] = time.Now()
		}
	}

	if nil != flashcard {
		dataModel["flashcard"] = flashcard
	}

	for _, rowValue := range rowValues {
		if 0 < len(rowValue.Values) {
			v := rowValue.Values[0]
			if av.KeyTypeNumber == v.Type {
				dataModel[rowValue.Key.Name] = v.Number.Content
			} else if av.KeyTypeDate == v.Type {
				dataModel[rowValue.Key.Name] = time.UnixMilli(v.Date.Content)
			} else {
				dataModel[rowValue.Key.Name] = v.String()
			}
		}
	}

	if err := tpl.Execute(buf, dataModel); nil != err {
		logging.LogWarnf("execute template [%s] failed: %s", tplContent, err)
	}
	return buf.String()
}

func renderAttributeViewTable(attrView *av.AttributeView, view *av.View, query string) (ret *av.Table, err error) {
	ret = &av.Table{
		ID:               view.ID,
		Icon:             view.Icon,
		Name:             view.Name,
		HideAttrViewName: view.HideAttrViewName,
		Columns:          []*av.TableColumn{},
		Rows:             []*av.TableRow{},
		Filters:          view.Table.Filters,
		Sorts:            view.Table.Sorts,
	}

	// 组装列
	for _, col := range view.Table.Columns {
		key, getErr := attrView.GetKey(col.ID)
		if nil != getErr {
			err = getErr
			return
		}

		ret.Columns = append(ret.Columns, &av.TableColumn{
			ID:           key.ID,
			Name:         key.Name,
			Type:         key.Type,
			Icon:         key.Icon,
			Options:      key.Options,
			NumberFormat: key.NumberFormat,
			Template:     key.Template,
			Relation:     key.Relation,
			Rollup:       key.Rollup,
			Wrap:         col.Wrap,
			Hidden:       col.Hidden,
			Width:        col.Width,
			Pin:          col.Pin,
			Calc:         col.Calc,
		})
	}

	// 生成行
	rows := map[string][]*av.KeyValues{}
	for _, keyValues := range attrView.KeyValues {
		for _, val := range keyValues.Values {
			values := rows[val.BlockID]
			if nil == values {
				values = []*av.KeyValues{{Key: keyValues.Key, Values: []*av.Value{val}}}
			} else {
				values = append(values, &av.KeyValues{Key: keyValues.Key, Values: []*av.Value{val}})
			}
			rows[val.BlockID] = values
		}

		// 数据订正，补全关联
		if av.KeyTypeRelation == keyValues.Key.Type && nil != keyValues.Key.Relation {
			av.UpsertAvBackRel(attrView.ID, keyValues.Key.Relation.AvID)
			if keyValues.Key.Relation.IsTwoWay {
				av.UpsertAvBackRel(keyValues.Key.Relation.AvID, attrView.ID)
			}
		}
	}

	// 过滤掉不存在的行
	var notFound []string
	for blockID, keyValues := range rows {
		blockValue := getRowBlockValue(keyValues)
		if nil == blockValue {
			notFound = append(notFound, blockID)
			continue
		}

		if blockValue.IsDetached {
			continue
		}

		if nil != blockValue.Block && "" == blockValue.Block.ID {
			notFound = append(notFound, blockID)
			continue
		}

		if treenode.GetBlockTree(blockID) == nil {
			notFound = append(notFound, blockID)
		}
	}
	for _, blockID := range notFound {
		delete(rows, blockID)
	}

	// 生成行单元格
	for rowID, row := range rows {
		var tableRow av.TableRow
		for _, col := range ret.Columns {
			var tableCell *av.TableCell
			for _, keyValues := range row {
				if keyValues.Key.ID == col.ID {
					tableCell = &av.TableCell{
						ID:        keyValues.Values[0].ID,
						Value:     keyValues.Values[0],
						ValueType: col.Type,
					}
					break
				}
			}
			if nil == tableCell {
				tableCell = &av.TableCell{
					ID:        ast.NewNodeID(),
					ValueType: col.Type,
				}
			}
			tableRow.ID = rowID

			switch tableCell.ValueType {
			case av.KeyTypeNumber: // 格式化数字
				if nil != tableCell.Value && nil != tableCell.Value.Number && tableCell.Value.Number.IsNotEmpty {
					tableCell.Value.Number.Format = col.NumberFormat
					tableCell.Value.Number.FormatNumber()
				}
			case av.KeyTypeTemplate: // 渲染模板列
				tableCell.Value = &av.Value{ID: tableCell.ID, KeyID: col.ID, BlockID: rowID, Type: av.KeyTypeTemplate, Template: &av.ValueTemplate{Content: col.Template}}
			case av.KeyTypeCreated: // 填充创建时间列值，后面再渲染
				tableCell.Value = &av.Value{ID: tableCell.ID, KeyID: col.ID, BlockID: rowID, Type: av.KeyTypeCreated}
			case av.KeyTypeUpdated: // 填充更新时间列值，后面再渲染
				tableCell.Value = &av.Value{ID: tableCell.ID, KeyID: col.ID, BlockID: rowID, Type: av.KeyTypeUpdated}
			case av.KeyTypeRelation: // 清空关联列值，后面再渲染 https://ld246.com/article/1703831044435
				if nil != tableCell.Value && nil != tableCell.Value.Relation {
					tableCell.Value.Relation.Contents = nil
				}
			}

			treenode.FillAttributeViewTableCellNilValue(tableCell, rowID, col.ID)

			tableRow.Cells = append(tableRow.Cells, tableCell)
		}
		ret.Rows = append(ret.Rows, &tableRow)
	}

	// 渲染自动生成的列值，比如关联列、汇总列、创建时间列和更新时间列
	for _, row := range ret.Rows {
		for _, cell := range row.Cells {
			switch cell.ValueType {
			case av.KeyTypeRollup: // 渲染汇总列
				rollupKey, _ := attrView.GetKey(cell.Value.KeyID)
				if nil == rollupKey || nil == rollupKey.Rollup {
					break
				}

				relKey, _ := attrView.GetKey(rollupKey.Rollup.RelationKeyID)
				if nil == relKey || nil == relKey.Relation {
					break
				}

				relVal := attrView.GetValue(relKey.ID, row.ID)
				if nil == relVal || nil == relVal.Relation {
					break
				}

				destAv, _ := av.ParseAttributeView(relKey.Relation.AvID)
				if nil == destAv {
					break
				}

				destKey, _ := destAv.GetKey(rollupKey.Rollup.KeyID)
				if nil == destKey {
					continue
				}

				for _, blockID := range relVal.Relation.BlockIDs {
					destVal := destAv.GetValue(rollupKey.Rollup.KeyID, blockID)
					if nil == destVal {
						continue
					}
					if av.KeyTypeNumber == destKey.Type {
						destVal.Number.Format = destKey.NumberFormat
						destVal.Number.FormatNumber()
					}

					cell.Value.Rollup.Contents = append(cell.Value.Rollup.Contents, destVal.Clone())
				}

				cell.Value.Rollup.RenderContents(rollupKey.Rollup.Calc, destKey)

				// 将汇总列的值保存到 rows 中，后续渲染模板列的时候会用到，下同
				// Database table view template columns support reading relation, rollup, created and updated columns https://github.com/siyuan-note/siyuan/issues/10442
				keyValues := rows[row.ID]
				keyValues = append(keyValues, &av.KeyValues{Key: rollupKey, Values: []*av.Value{{ID: cell.Value.ID, KeyID: rollupKey.ID, BlockID: row.ID, Type: av.KeyTypeRollup, Rollup: cell.Value.Rollup}}})
				rows[row.ID] = keyValues
			case av.KeyTypeRelation: // 渲染关联列
				relKey, _ := attrView.GetKey(cell.Value.KeyID)
				if nil != relKey && nil != relKey.Relation {
					destAv, _ := av.ParseAttributeView(relKey.Relation.AvID)
					if nil != destAv {
						blocks := map[string]*av.Value{}
						for _, blockValue := range destAv.GetBlockKeyValues().Values {
							blocks[blockValue.BlockID] = blockValue
						}
						for _, blockID := range cell.Value.Relation.BlockIDs {
							if val := blocks[blockID]; nil != val {
								cell.Value.Relation.Contents = append(cell.Value.Relation.Contents, val)
							}
						}
					}
				}

				keyValues := rows[row.ID]
				keyValues = append(keyValues, &av.KeyValues{Key: relKey, Values: []*av.Value{{ID: cell.Value.ID, KeyID: relKey.ID, BlockID: row.ID, Type: av.KeyTypeRelation, Relation: cell.Value.Relation}}})
				rows[row.ID] = keyValues
			case av.KeyTypeCreated: // 渲染创建时间
				createdStr := row.ID[:len("20060102150405")]
				created, parseErr := time.ParseInLocation("20060102150405", createdStr, time.Local)
				if nil == parseErr {
					cell.Value.Created = av.NewFormattedValueCreated(created.UnixMilli(), 0, av.CreatedFormatNone)
					cell.Value.Created.IsNotEmpty = true
				} else {
					cell.Value.Created = av.NewFormattedValueCreated(time.Now().UnixMilli(), 0, av.CreatedFormatNone)
				}

				keyValues := rows[row.ID]
				createdKey, _ := attrView.GetKey(cell.Value.KeyID)
				keyValues = append(keyValues, &av.KeyValues{Key: createdKey, Values: []*av.Value{{ID: cell.Value.ID, KeyID: createdKey.ID, BlockID: row.ID, Type: av.KeyTypeCreated, Created: cell.Value.Created}}})
				rows[row.ID] = keyValues
			case av.KeyTypeUpdated: // 渲染更新时间
				ial := map[string]string{}
				block := row.GetBlockValue()
				if nil != block && !block.IsDetached {
					ial = GetBlockAttrsWithoutWaitWriting(row.ID)
				}
				updatedStr := ial["updated"]
				if "" == updatedStr && nil != block {
					cell.Value.Updated = av.NewFormattedValueUpdated(block.Block.Updated, 0, av.UpdatedFormatNone)
					cell.Value.Updated.IsNotEmpty = true
				} else {
					updated, parseErr := time.ParseInLocation("20060102150405", updatedStr, time.Local)
					if nil == parseErr {
						cell.Value.Updated = av.NewFormattedValueUpdated(updated.UnixMilli(), 0, av.UpdatedFormatNone)
						cell.Value.Updated.IsNotEmpty = true
					} else {
						cell.Value.Updated = av.NewFormattedValueUpdated(time.Now().UnixMilli(), 0, av.UpdatedFormatNone)
					}
				}

				keyValues := rows[row.ID]
				updatedKey, _ := attrView.GetKey(cell.Value.KeyID)
				keyValues = append(keyValues, &av.KeyValues{Key: updatedKey, Values: []*av.Value{{ID: cell.Value.ID, KeyID: updatedKey.ID, BlockID: row.ID, Type: av.KeyTypeUpdated, Updated: cell.Value.Updated}}})
				rows[row.ID] = keyValues
			}
		}
	}

	// 最后单独渲染模板列，这样模板列就可以使用汇总、关联、创建时间和更新时间列的值了
	// Database table view template columns support reading relation, rollup, created and updated columns https://github.com/siyuan-note/siyuan/issues/10442

	// 获取闪卡信息
	flashcards := map[string]*Flashcard{}
	//deck := Decks[builtinDeckID]
	//if nil != deck {
	//	var blockIDs []string
	//	for _, row := range ret.Rows {
	//		blockIDs = append(blockIDs, row.ID)
	//	}
	//	cards := deck.GetCardsByBlockIDs(blockIDs)
	//	now := time.Now()
	//	for _, card := range cards {
	//		flashcards[card.BlockID()] = newFlashcard(card, builtinDeckID, now)
	//	}
	//}

	for _, row := range ret.Rows {
		for _, cell := range row.Cells {
			switch cell.ValueType {
			case av.KeyTypeTemplate: // 渲染模板列
				keyValues := rows[row.ID]
				ial := map[string]string{}
				block := row.GetBlockValue()
				if nil != block && !block.IsDetached {
					ial = GetBlockAttrsWithoutWaitWriting(row.ID)
				}
				content := renderTemplateCol(ial, flashcards[row.ID], keyValues, cell.Value.Template.Content)
				cell.Value.Template.Content = content
			}
		}
	}

	// 根据搜索条件过滤
	query = strings.TrimSpace(query)
	if "" != query {
		keywords := strings.Split(query, " ")
		var hitRows []*av.TableRow
		for _, row := range ret.Rows {
			hit := false
			for _, cell := range row.Cells {
				for _, keyword := range keywords {
					if strings.Contains(strings.ToLower(cell.Value.String()), strings.ToLower(keyword)) {
						hit = true
						break
					}
				}
			}
			if hit {
				hitRows = append(hitRows, row)
			}
		}
		ret.Rows = hitRows
		if 1 > len(ret.Rows) {
			ret.Rows = []*av.TableRow{}
		}
	}

	// 自定义排序
	sortRowIDs := map[string]int{}
	if 0 < len(view.Table.RowIDs) {
		for i, rowID := range view.Table.RowIDs {
			sortRowIDs[rowID] = i
		}
	}

	sort.Slice(ret.Rows, func(i, j int) bool {
		iv := sortRowIDs[ret.Rows[i].ID]
		jv := sortRowIDs[ret.Rows[j].ID]
		if iv == jv {
			return ret.Rows[i].ID < ret.Rows[j].ID
		}
		return iv < jv
	})
	return
}

func getRowBlockValue(keyValues []*av.KeyValues) (ret *av.Value) {
	for _, kv := range keyValues {
		if av.KeyTypeBlock == kv.Key.Type && 0 < len(kv.Values) {
			ret = kv.Values[0]
			break
		}
	}
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
		}
	}

	if !destAdded {
		if operation.IsTwoWay {
			name := strings.TrimSpace(operation.Name)
			if "" == name {
				name = srcAv.Name + " " + operation.Format
			}

			destAv.KeyValues = append(destAv.KeyValues, &av.KeyValues{
				Key: &av.Key{
					ID:       operation.BackRelationKeyID,
					Name:     name,
					Type:     av.KeyTypeRelation,
					Relation: &av.Relation{AvID: operation.AvID, IsTwoWay: operation.IsTwoWay, BackKeyID: operation.KeyID},
				},
			})

			for _, v := range destAv.Views {
				switch v.LayoutType {
				case av.LayoutTypeTable:
					v.Table.Columns = append(v.Table.Columns, &av.ViewTableColumn{ID: operation.BackRelationKeyID})
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
		util.BroadcastByType("protyle", "refreshAttributeView", 0, "", map[string]interface{}{"id": destAv.ID})
	}

	av.UpsertAvBackRel(srcAv.ID, destAv.ID)
	return
}

func (tx *Transaction) doSortAttrViewView(operation *Operation) (ret *TxErr) {
	avID := operation.AvID
	attrView, err := av.ParseAttributeView(avID)
	if nil != err {
		logging.LogErrorf("parse attribute view [%s] failed: %s", operation.AvID, err)
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if nil == view {
		logging.LogErrorf("get view failed: %s", operation.BlockID)
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	viewID := view.ID
	previewViewID := operation.PreviousID

	if viewID == previewViewID {
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
		if v.ID == previewViewID {
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
		if err = indexWriteJSONQueue(tree); nil != err {
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
	view.Name = attrView.GetDuplicateViewName(masterView.Name)
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
			nodeAvName = "Untitled"
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
	err := AddAttributeViewBlock(tx, operation.SrcIDs, operation.AvID, operation.BlockID, operation.PreviousID, operation.IsDetached)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func AddAttributeViewBlock(tx *Transaction, srcIDs []string, avID, blockID, previousBlockID string, isDetached bool) (err error) {
	for _, id := range srcIDs {
		var tree *parse.Tree
		if !isDetached {
			var loadErr error
			if nil != tx {
				tree, loadErr = tx.loadTree(id)
			} else {
				tree, loadErr = LoadTreeByBlockID(id)
			}
			if nil != loadErr {
				logging.LogErrorf("load tree [%s] failed: %s", id, err)
				return loadErr
			}
		}

		if avErr := addAttributeViewBlock(avID, blockID, previousBlockID, id, isDetached, tree, tx); nil != avErr {
			return avErr
		}
	}
	return
}

func addAttributeViewBlock(avID, blockID, previousBlockID, addingBlockID string, isDetached bool, tree *parse.Tree, tx *Transaction) (err error) {
	var node *ast.Node
	if !isDetached {
		node = treenode.GetNodeInTree(tree, addingBlockID)
		if nil == node {
			err = ErrBlockNotFound
			return
		}

		if ast.NodeAttributeView == node.Type {
			// 不能将一个属性视图拖拽到另一个属性视图中
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

	// 不允许重复添加相同的块到属性视图中
	blockValues := attrView.GetBlockKeyValues()
	for _, blockValue := range blockValues.Values {
		if blockValue.Block.ID == addingBlockID {
			return
		}
	}

	var content string
	if !isDetached {
		content = getNodeRefText(node)
	}
	now := time.Now().UnixMilli()
	blockValue := &av.Value{
		ID:         ast.NewNodeID(),
		KeyID:      blockValues.Key.ID,
		BlockID:    addingBlockID,
		Type:       av.KeyTypeBlock,
		IsDetached: isDetached,
		CreatedAt:  now,
		UpdatedAt:  now,
		Block:      &av.ValueBlock{ID: addingBlockID, Content: content, Created: now, Updated: now}}
	blockValues.Values = append(blockValues.Values, blockValue)

	// 如果存在过滤条件，则将过滤条件应用到新添加的块上
	view, _ := getAttrViewViewByBlockID(attrView, blockID)
	if nil != view && 0 < len(view.Table.Filters) {
		viewable, _ := renderAttributeViewTable(attrView, view, "")
		viewable.FilterRows(attrView)
		viewable.SortRows()

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

	if !isDetached {
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

		if nil != tx {
			if err = setNodeAttrsWithTx(tx, node, tree, attrs); nil != err {
				return
			}
		} else {
			if err = setNodeAttrs(node, tree, attrs); nil != err {
				return
			}
		}
	}

	for _, view := range attrView.Views {
		switch view.LayoutType {
		case av.LayoutTypeTable:
			if "" != previousBlockID {
				changed := false
				for i, id := range view.Table.RowIDs {
					if id == previousBlockID {
						view.Table.RowIDs = append(view.Table.RowIDs[:i+1], append([]string{addingBlockID}, view.Table.RowIDs[i+1:]...)...)
						changed = true
						break
					}
				}
				if !changed {
					view.Table.RowIDs = append(view.Table.RowIDs, addingBlockID)
				}
			} else {
				view.Table.RowIDs = append([]string{addingBlockID}, view.Table.RowIDs...)
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
	attrView, err := av.ParseAttributeView(operation.AvID)
	if nil != err {
		return
	}

	view, err := getAttrViewViewByBlockID(attrView, operation.BlockID)
	if nil != err {
		return
	}

	var rowID string
	var index, previousIndex int
	for i, r := range view.Table.RowIDs {
		if r == operation.ID {
			rowID = r
			index = i
			break
		}
	}
	if "" == rowID {
		rowID = operation.ID
		view.Table.RowIDs = append(view.Table.RowIDs, rowID)
		index = len(view.Table.RowIDs) - 1
	}

	switch view.LayoutType {
	case av.LayoutTypeTable:
		view.Table.RowIDs = append(view.Table.RowIDs[:index], view.Table.RowIDs[index+1:]...)
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
	err := SortAttributeViewKey(operation.AvID, operation.BlockID, operation.ID, operation.PreviousID)
	if nil != err {
		return &TxErr{code: TxErrWriteAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return
}

func SortAttributeViewKey(avID, blockID, keyID, previousKeyID string) (err error) {
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
		av.KeyTypeRelation, av.KeyTypeRollup:

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
		av.KeyTypeRelation, av.KeyTypeRollup:
		for _, keyValues := range attrView.KeyValues {
			if keyValues.Key.ID == operation.ID {
				keyValues.Key.Name = strings.TrimSpace(operation.Name)
				keyValues.Key.Type = colType
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

			destAv, _ := av.ParseAttributeView(removedKey.Relation.AvID)
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

				av.SaveAttributeView(destAv)
				util.BroadcastByType("protyle", "refreshAttributeView", 0, "", map[string]interface{}{"id": destAv.ID})

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

	for _, keyValues := range attrView.KeyValues {
		for _, value := range keyValues.Values {
			if value.BlockID == operation.PreviousID {
				if value.BlockID != operation.NextID {
					// 换绑
					unbindBlockAv(tx, operation.AvID, value.BlockID)
				}

				value.BlockID = operation.NextID
				if nil != value.Block {
					value.Block.ID = operation.NextID
					value.IsDetached = operation.IsDetached
					if !operation.IsDetached {
						value.Block.Content = getNodeRefText(node)
					}
				}

				if !operation.IsDetached {
					bindBlockAv(tx, operation.AvID, operation.NextID)
				}
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
			if cellID == value.ID {
				val = value
				val.Type = keyValues.Key.Type
				break
			}
		}

		if nil == val {
			val = &av.Value{ID: cellID, KeyID: keyValues.Key.ID, BlockID: rowID, Type: keyValues.Key.Type, CreatedAt: now, UpdatedAt: now}
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
	}

	relationChangeMode := 0 // 0：不变（仅排序），1：增加，2：减少
	if av.KeyTypeRelation == val.Type {
		// 关联列得 content 是自动渲染的，所以不需要保存
		val.Relation.Contents = nil

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

	if oldIsDetached { // 之前是游离行
		if !val.IsDetached { // 现在绑定了块
			// 将游离行绑定到新建的块上
			bindBlockAv(tx, avID, rowID)
		}
	} else { // 之前绑定了块
		if isUpdatingBlockKey { // 正在更新主键
			if val.IsDetached { // 现在是游离行
				// 将绑定的块从属性视图中移除
				unbindBlockAv(tx, avID, rowID)
			} else { // 现在绑定了块
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
		blockVal.UpdatedAt = now
		if val.CreatedAt == val.UpdatedAt {
			val.UpdatedAt += 1000 // 防止更新时间和创建时间一样
		}
		if isUpdatingBlockKey {
			blockVal.IsDetached = val.IsDetached
		}
	}
	val.UpdatedAt = now
	if val.CreatedAt == val.UpdatedAt {
		val.UpdatedAt += 1000 // 防止更新时间和创建时间一样
	}

	key, _ := attrView.GetKey(val.KeyID)
	if nil != key && av.KeyTypeRelation == key.Type && nil != key.Relation {
		destAv, _ := av.ParseAttributeView(key.Relation.AvID)
		if nil != destAv {
			if key.Relation.IsTwoWay {
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
								destVal = &av.Value{ID: ast.NewNodeID(), KeyID: keyValues.Key.ID, BlockID: blockID, Type: keyValues.Key.Type, Relation: &av.ValueRelation{}}
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
									break
								}
							}
						}
					}
				}

				av.SaveAttributeView(destAv)
			}
		}
	}

	relatedAvIDs := av.GetSrcAvIDs(avID)
	for _, relatedAvID := range relatedAvIDs {
		util.BroadcastByType("protyle", "refreshAttributeView", 0, "", map[string]interface{}{"id": relatedAvID})
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
		delete(attrs, av.NodeAttrNameAvs)
		node.RemoveIALAttr(av.NodeAttrNameAvs)
	} else {
		attrs[av.NodeAttrNameAvs] = strings.Join(avIDs, ",")
		node.SetIALAttr(av.NodeAttrNameAvs, strings.Join(avIDs, ","))
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

	attrs := parse.IAL2Map(node.KramdownIAL)
	if "" == attrs[av.NodeAttrNameAvs] {
		attrs[av.NodeAttrNameAvs] = avID
	} else {
		avIDs := strings.Split(attrs[av.NodeAttrNameAvs], ",")
		avIDs = append(avIDs, avID)
		avIDs = gulu.Str.RemoveDuplicatedElem(avIDs)
		attrs[av.NodeAttrNameAvs] = strings.Join(avIDs, ",")
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
