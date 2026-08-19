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
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type AttributeViewRenderTarget struct {
	Status   string `json:"status"`
	ItemID   string `json:"itemID"`
	GroupID  string `json:"groupID,omitempty"`
	Index    int    `json:"index"`
	Offset   int    `json:"offset"`
	PageSize int    `json:"pageSize"`
}

type AttributeViewSearchTarget struct {
	AvID            string   `json:"avID"`
	DatabaseBlockID string   `json:"databaseBlockID"`
	NotebookID      string   `json:"notebookID"`
	ViewID          string   `json:"viewID,omitempty"`
	GroupID         string   `json:"groupID,omitempty"`
	ItemID          string   `json:"itemID"`
	ValueID         string   `json:"valueID"`
	MatchedValueID  string   `json:"matchedValueID"`
	MatchedKeyID    string   `json:"matchedKeyID"`
	Title           string   `json:"title"`
	BoundBlockID    string   `json:"boundBlockID"`
	IsDetached      bool     `json:"isDetached"`
	Keywords        []string `json:"keywords"`
}

type attributeViewSearchMatch struct {
	valueID string
	keyID   string
}

type attributeViewSearchItem struct {
	itemID  string
	groupID string
}

func GetAttributeViewSearchTarget(blockID string, keywords []string) (ret *AttributeViewSearchTarget) {
	waitForSyncingStorages()

	node, tree, _ := getNodeByBlockID(nil, blockID)
	if nil == node || nil == tree || ast.NodeAttributeView != node.Type || "" == node.AttributeViewID {
		return
	}

	var attrView *av.AttributeView
	var err error
	if IsEncryptedBox(tree.Box) {
		attrView, err = av.ParseAttributeViewInBox(node.AttributeViewID, tree.Box)
	} else {
		attrView, err = av.ParseAttributeView(node.AttributeViewID)
	}
	if nil == attrView {
		logging.LogErrorf("parse attribute view [%s] failed: %s", node.AttributeViewID, err)
		return
	}

	keywords = normalizeAttributeViewSearchKeywords(keywords)
	if 1 > len(keywords) {
		return
	}
	matches := getAttributeViewSearchMatches(attrView, keywords)
	if 1 > len(matches) {
		return
	}

	var orderedItems []attributeViewSearchItem
	viewID := ""
	blockValues := attrView.GetBlockKeyValues()
	pageSize := len(matches) + 1
	if nil != blockValues && len(blockValues.Values) >= pageSize {
		pageSize = len(blockValues.Values) + 1
	}
	viewable, renderErr := renderAttributeView(attrView, blockID, "", "", "", 1, pageSize, nil, false, false, nil, "")
	if nil == renderErr && nil != viewable {
		viewID = viewable.GetID()
		orderedItems = appendAttributeViewSearchItems(orderedItems, viewable, false)
		orderedItems = appendAttributeViewSearchItems(orderedItems, viewable, true)
	} else if nil != renderErr {
		logging.LogWarnf("render attribute view [%s] for search target failed: %s", attrView.ID, renderErr)
	}
	if nil != blockValues {
		for _, value := range blockValues.Values {
			if nil != value {
				orderedItems = append(orderedItems, attributeViewSearchItem{itemID: value.BlockID})
			}
		}
	}

	visited := map[string]bool{}
	for _, item := range orderedItems {
		if visited[item.itemID] {
			continue
		}
		visited[item.itemID] = true
		match := matches[item.itemID]
		if nil == match {
			continue
		}
		blockValue := attrView.GetBlockValue(item.itemID)
		if nil == blockValue || nil == blockValue.Block {
			continue
		}
		ret = &AttributeViewSearchTarget{
			AvID:            attrView.ID,
			DatabaseBlockID: blockID,
			NotebookID:      tree.Box,
			ViewID:          viewID,
			GroupID:         item.groupID,
			ItemID:          item.itemID,
			ValueID:         blockValue.ID,
			MatchedValueID:  match.valueID,
			MatchedKeyID:    match.keyID,
			Title:           blockValue.String(true),
			BoundBlockID:    blockValue.Block.ID,
			IsDetached:      blockValue.IsDetached || "" == blockValue.Block.ID,
			Keywords:        keywords,
		}
		return
	}
	return
}

func normalizeAttributeViewSearchKeywords(keywords []string) (ret []string) {
	added := map[string]bool{}
	for _, keyword := range keywords {
		keyword = strings.TrimSpace(keyword)
		if "" == keyword || added[keyword] {
			continue
		}
		added[keyword] = true
		ret = append(ret, keyword)
	}
	return
}

func getAttributeViewSearchMatches(attrView *av.AttributeView, keywords []string) (ret map[string]*attributeViewSearchMatch) {
	ret = map[string]*attributeViewSearchMatch{}
	for _, keyValues := range attrView.KeyValues {
		if nil == keyValues || nil == keyValues.Key {
			continue
		}
		for _, value := range keyValues.Values {
			if nil == value || "" == value.BlockID || nil != ret[value.BlockID] {
				continue
			}
			content := value.String(true)
			for _, keyword := range keywords {
				if strings.Contains(content, keyword) {
					ret[value.BlockID] = &attributeViewSearchMatch{valueID: value.ID, keyID: keyValues.Key.ID}
					break
				}
			}
		}
	}
	return
}

func appendAttributeViewSearchItems(items []attributeViewSearchItem, viewable av.Viewable, hiddenGroups bool) []attributeViewSearchItem {
	if nil == viewable {
		return items
	}
	baseInstance := getAttributeViewBaseInstance(viewable)
	if nil != baseInstance && 0 < len(baseInstance.Groups) {
		for _, group := range baseInstance.Groups {
			if (0 != group.GetGroupHidden()) != hiddenGroups {
				continue
			}
			if collection, ok := group.(av.Collection); ok {
				for _, item := range collection.GetItems() {
					items = append(items, attributeViewSearchItem{itemID: item.GetID(), groupID: group.GetID()})
				}
			}
		}
		return items
	}
	if hiddenGroups {
		return items
	}
	if collection, ok := viewable.(av.Collection); ok {
		for _, item := range collection.GetItems() {
			items = append(items, attributeViewSearchItem{itemID: item.GetID()})
		}
	}
	return items
}

func GetAttributeViewItemStatuses(blockID, avID, viewID, query string, itemIDs []string) (ret map[string]string, err error) {
	viewable, attrView, _, err := RenderAttributeViewWithTarget(blockID, avID, viewID, query, 1, math.MaxInt, nil, "", false, false, "", "")
	if nil != err {
		return nil, err
	}
	return getAttributeViewItemStatuses(attrView, viewable, itemIDs), nil
}

func getAttributeViewItemStatuses(attrView *av.AttributeView, viewable av.Viewable, itemIDs []string) (ret map[string]string) {
	ret = map[string]string{}
	requested := map[string]bool{}
	for _, itemID := range itemIDs {
		if "" == itemID || requested[itemID] {
			continue
		}
		requested[itemID] = true
		ret[itemID] = "itemNotFound"
	}
	if blockValues := attrView.GetBlockKeyValues(); nil != blockValues {
		for _, value := range blockValues.Values {
			if nil != value && requested[value.BlockID] {
				ret[value.BlockID] = "filtered"
			}
		}
	}
	for _, item := range appendAttributeViewSearchItems(nil, viewable, true) {
		if requested[item.itemID] && "filtered" == ret[item.itemID] {
			ret[item.itemID] = "groupHidden"
		}
	}
	for _, item := range appendAttributeViewSearchItems(nil, viewable, false) {
		if requested[item.itemID] {
			ret[item.itemID] = "visible"
		}
	}
	return
}

func getAttributeViewBaseInstance(viewable av.Viewable) (ret *av.BaseInstance) {
	switch instance := viewable.(type) {
	case *av.Table:
		ret = instance.BaseInstance
	case *av.Gallery:
		ret = instance.BaseInstance
	case *av.Kanban:
		ret = instance.BaseInstance
	}
	return
}

func RenderAttributeView(blockID, avID, viewID, query string, page, pageSize int, groupPaging map[string]any, createIfNotExist, ignoreRows bool) (viewable av.Viewable, attrView *av.AttributeView, err error) {
	viewable, attrView, _, err = RenderAttributeViewWithTarget(blockID, avID, viewID, query, page, pageSize, groupPaging, "", createIfNotExist, ignoreRows, "", "")
	return
}

// GetAttributeViewPasteRows 返回当前表格视图中从指定条目开始的连续行和可安全推断类型的空字段，供粘贴扩充行列。
func GetAttributeViewPasteRows(blockID, avID, viewID, groupID, query, startItemID string, count int) (
	table *av.Table, inferableKeyIDs []string, err error,
) {
	viewable, attrView, err := RenderAttributeView(blockID, avID, viewID, query, 1, math.MaxInt, nil, false, false)
	if nil != err {
		return nil, nil, err
	}

	table, ok := viewable.(*av.Table)
	if !ok {
		return nil, nil, fmt.Errorf("attribute view [%s] is not a table", avID)
	}
	if "" != groupID {
		var groupTable *av.Table
		for _, group := range table.Groups {
			if group.GetID() == groupID {
				groupTable, _ = group.(*av.Table)
				break
			}
		}
		if nil == groupTable {
			return nil, nil, fmt.Errorf("attribute view group [%s] not found", groupID)
		}
		table = groupTable
	}

	rows, err := getAttributeViewPasteRowsFromTable(table, startItemID, count)
	if nil != err {
		return nil, nil, err
	}
	table.Rows = rows
	return table, getPasteInferableAttributeViewKeyIDs(attrView, getDependentRollupKeyIDs(attrView.ID)), nil
}

func getPasteInferableAttributeViewKeyIDs(attrView *av.AttributeView, dependentRollupKeyIDs map[string]struct{}) (ret []string) {
	unsafeKeyIDs := dependentRollupKeyIDs
	if nil == unsafeKeyIDs {
		unsafeKeyIDs = map[string]struct{}{}
	}
	for _, itemTemplate := range attrView.NewItemTemplates {
		if nil == itemTemplate {
			continue
		}
		for keyID := range itemTemplate.FieldValues {
			unsafeKeyIDs[keyID] = struct{}{}
		}
	}
	for _, view := range attrView.Views {
		if nil != view && nil != view.Group && "" != view.Group.Field {
			unsafeKeyIDs[view.Group.Field] = struct{}{}
		}
	}
	for _, keyValues := range attrView.KeyValues {
		if nil == keyValues || nil == keyValues.Key {
			continue
		}
		if _, unsafe := unsafeKeyIDs[keyValues.Key.ID]; unsafe {
			continue
		}
		empty := true
		for _, value := range keyValues.Values {
			if !value.IsEmpty() {
				empty = false
				break
			}
		}
		if empty {
			ret = append(ret, keyValues.Key.ID)
		}
	}
	return
}

func getDependentRollupKeyIDs(avID string) map[string]struct{} {
	var relatedAttrViews []*av.AttributeView
	for _, relatedAvID := range av.GetSrcAvIDs(avID) {
		relatedAv, _ := av.ParseAttributeView(relatedAvID)
		if nil == relatedAv {
			continue
		}
		relatedAttrViews = append(relatedAttrViews, relatedAv)
	}
	return collectDependentRollupKeyIDs(relatedAttrViews)
}

func collectDependentRollupKeyIDs(attrViews []*av.AttributeView) (ret map[string]struct{}) {
	ret = map[string]struct{}{}
	for _, attrView := range attrViews {
		if nil == attrView {
			continue
		}
		for _, keyValues := range attrView.KeyValues {
			if nil == keyValues || nil == keyValues.Key || av.KeyTypeRollup != keyValues.Key.Type ||
				nil == keyValues.Key.Rollup || "" == keyValues.Key.Rollup.KeyID {
				continue
			}
			ret[keyValues.Key.Rollup.KeyID] = struct{}{}
		}
	}
	return
}

func getAttributeViewPasteRowsFromTable(table *av.Table, startItemID string, count int) (rows []*av.TableRow, err error) {
	if count < 1 {
		return nil, fmt.Errorf("invalid paste row count [%d]", count)
	}
	start := -1
	for i, row := range table.Rows {
		if row.ID == startItemID {
			start = i
			break
		}
	}
	if 0 > start {
		return nil, fmt.Errorf("attribute view item [%s] not found", startItemID)
	}
	end := start + min(count, len(table.Rows)-start)
	return table.Rows[start:end], nil
}

func RenderAttributeViewWithTarget(blockID, avID, viewID, query string, page, pageSize int, groupPaging map[string]any, initialLayout av.LayoutType, createIfNotExist, ignoreRows bool, targetItemID, targetGroupID string) (viewable av.Viewable, attrView *av.AttributeView, target *AttributeViewRenderTarget, err error) {
	if !ast.IsNodeIDPattern(avID) {
		err = ErrInvalidID
		return
	}

	waitForSyncingStorages()

	// 加密笔记本的 AV 定义存笔记本级路径，通过 blockID 反查 boxID
	avBoxID := ""
	if "" != blockID {
		bt := treenode.GetBlockTree(blockID)
		if nil == bt {
			for _, encBoxID := range treenode.GetOpenedEncryptedBoxIDs() {
				if encBT := treenode.GetBlockTreeInBox(blockID, encBoxID); nil != encBT {
					bt = encBT
					break
				}
			}
		}
		if nil != bt && IsEncryptedBox(bt.BoxID) {
			avBoxID = bt.BoxID
		}
	}

	// 通过 fallback 查找 AV 定义路径（普通 box 全局，加密笔记本笔记本级）
	// 已知 box 时直接用 InBox 查找，避免全局 pending 映射被并发覆盖
	var existPath string
	if avBoxID != "" {
		existPath, _ = av.FindAttributeViewPathInBox(avID, avBoxID)
	} else {
		existPath, _ = av.FindAttributeViewPath(avID)
	}
	if "" == existPath {
		if avBoxID != "" {
			existPath = filepath.Join(util.DataDir, avBoxID, "storage", "av", avID+".json")
		} else {
			// fallback 找不到时按全局路径检查（首次创建场景）
			existPath = av.GetAttributeViewDataPath(avID)
		}
	}
	if !filelock.IsExist(existPath) {
		if !createIfNotExist {
			err = av.ErrAttributeViewNotFound
			return
		}

		// 加密笔记本首次创建：仅设置 pending 用于 SaveAttributeView 路径路由，创建后立即清除
		if avBoxID != "" {
			av.SetAVBoxID(avID, avBoxID)
			defer av.SetAVBoxID(avID, "") // 创建完成立即清除，避免污染后续路由
		}
		attrView = newAttributeViewWithLayout(avID, initialLayout)
		if err = av.SaveAttributeView(attrView); err != nil {
			logging.LogErrorf("save attribute view [%s] failed: %s", avID, err)
			return
		}
		if blockID != "" {
			av.UpsertBlockRel(avID, blockID)
		}
	}

	// 已知 box 时直接用 InBox 解析，不依赖全局 pending 状态
	if avBoxID != "" {
		attrView, err = av.ParseAttributeViewInBox(avID, avBoxID)
	} else {
		attrView, err = av.ParseAttributeView(avID)
	}
	if err != nil {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}
	if targetItemID != "" {
		target = &AttributeViewRenderTarget{Status: "itemNotFound", ItemID: targetItemID}
		if nil != attrView.GetBlockValue(targetItemID) {
			target.Status = "filtered"
		}
	}

	// 诊断：AV 解析后的数据量
	blockKV := attrView.GetBlockKeyValues()
	if nil != blockKV {
	} else {
	}

	viewable, err = renderAttributeView(attrView, blockID, viewID, "", query, page, pageSize, groupPaging, ignoreRows, true, target, targetGroupID)
	return
}

func newAttributeViewWithLayout(avID string, initialLayout av.LayoutType) (ret *av.AttributeView) {
	ret = av.NewAttributeView(avID)
	switch initialLayout {
	case av.LayoutTypeGallery, av.LayoutTypeKanban:
	default:
		return
	}

	if err := changeAttrViewLayout(ret, ret.Views[0], initialLayout); err != nil {
		return av.NewAttributeView(avID)
	}
	regenAttrViewGroups(ret)
	return
}

const (
	groupValueDefault                                        = "_@default@_"    // 默认分组值（值为空的默认分组）
	groupValueNotInRange                                     = "_@notInRange@_" // 不再范围内的分组值（只有数字类型的分组才可能是该值）
	groupValueLast30Days, groupValueLast7Days                = "_@last30Days@_", "_@last7Days@_"
	groupValueYesterday, groupValueToday, groupValueTomorrow = "_@yesterday@_", "_@today@_", "_@tomorrow@_"
	groupValueNext7Days, groupValueNext30Days                = "_@next7Days@_", "_@next30Days@_"
)

func renderAttributeView(attrView *av.AttributeView, nodeID, viewID, carrierViewID, query string, page, pageSize int, groupPaging map[string]any, ignoreRows, writable bool, target *AttributeViewRenderTarget, targetGroupID string) (viewable av.Viewable, err error) {
	// 获取待渲染的视图
	view, err := getRenderAttributeViewView(attrView, viewID, carrierViewID, nodeID, writable)
	if nil != err {
		return
	}

	// 做一些数据兼容和订正处理
	changed := checkAttrView(attrView, view)
	changed = upgradeAttributeViewSpec(attrView) || changed
	if !ignoreRows {
		changed = normalizeAttributeViewBlockRefSubtypes(attrView) || changed
	}
	if writable && changed {
		if err = av.SaveAttributeView(attrView); nil != err {
			logging.LogErrorf("save attribute view [%s] failed: %s", attrView.ID, err)
			return
		}
	}

	// 渲染视图
	viewable = sql.RenderView(attrView, view, query, ignoreRows)
	var groupRenderSource *sql.GroupViewRenderSource
	if !ignoreRows && view.IsGroupView() {
		// 在父视图分页前保存完整行索引，分组表格复用已经生成的字段值。
		groupRenderSource = sql.NewGroupViewRenderSource(viewable, query)
	}
	renderTargetItemID := targetItemID(target)
	if view.IsGroupView() || view.LayoutType == av.LayoutTypeKanban {
		renderTargetItemID = ""
	}
	var targetIndex, targetOffset int
	targetIndex, targetOffset, err = renderViewableInstance(viewable, view, attrView, page, pageSize, ignoreRows, renderTargetItemID)
	if nil != err {
		return
	}
	if nil != target && targetIndex >= 0 && !view.IsGroupView() && view.LayoutType != av.LayoutTypeKanban {
		setAttributeViewRenderTarget(target, "", targetIndex, targetOffset, view.PageSize)
	}

	// 渲染分组视图。当 ignoreRows 时若有已生成的分组则渲染元数据供面板使用，无分组则跳过（生成分组需要行数据）
	if !ignoreRows || len(view.Groups) > 0 {
		err = renderAttributeViewGroups(viewable, attrView, view, query, page, pageSize, groupPaging, groupRenderSource,
			ignoreRows, writable, target, targetGroupID)
	}
	if writable && nil == err && attrView.HasCardCoverPositionChanges() {
		if err = av.SaveAttributeView(attrView); nil != err {
			logging.LogErrorf("save attribute view [%s] failed: %s", attrView.ID, err)
			return
		}
	}
	return
}

func renderAttributeViewGroups(viewable av.Viewable, attrView *av.AttributeView, view *av.View, query string, page,
	pageSize int, groupPaging map[string]any, groupRenderSource *sql.GroupViewRenderSource, ignoreRows, writable bool,
	target *AttributeViewRenderTarget, targetGroupID string) (err error) {
	groupKey := view.GetGroupKey(attrView)
	if nil == groupKey {
		if view.LayoutType == av.LayoutTypeKanban {
			preferredGroupKey := getKanbanPreferredGroupKey(attrView)
			group := &av.ViewGroup{Field: preferredGroupKey.ID}
			setAttributeViewGroup(attrView, view, group)
			if writable {
				if err = av.SaveAttributeView(attrView); err != nil {
					logging.LogErrorf("save attribute view [%s] failed: %s", attrView.ID, err)
					return
				}
			}
			groupKey = view.GetGroupKey(attrView)
			if nil == groupKey {
				return
			}
		} else {
			return
		}
	}

	// 当前日期可能会变，所以如果是按日期分组则需要重新生成分组。
	// ignoreRows 时跳过重新生成（需要行数据），沿用已保存的分组。
	if !ignoreRows && isGroupByDate(view) {
		createdDate := time.UnixMilli(view.GroupCreated).Format("2006-01-02")
		if time.Now().Format("2006-01-02") != createdDate {
			genAttrViewGroups(view, attrView) // 仅重新生成一个视图的分组以提升性能
			if writable {
				if err = av.SaveAttributeView(attrView); err != nil {
					logging.LogErrorf("save attribute view [%s] failed: %s", attrView.ID, err)
					return
				}
			}
		}
	}

	// 如果是按模板分组则需要重新生成分组。
	// ignoreRows 时跳过重新生成（需要行数据），沿用已保存的分组。
	if !ignoreRows && isGroupByTemplate(attrView, view) {
		genAttrViewGroups(view, attrView) // 仅重新生成一个视图的分组以提升性能
		if writable {
			if err = av.SaveAttributeView(attrView); err != nil {
				logging.LogErrorf("save attribute view [%s] failed: %s", attrView.ID, err)
				return
			}
		}
	}

	// 渲染分组视图。ignoreRows 时若已存在分组则渲染元数据供面板使用，若无分组则返回（生成需要行数据）
	if nil == view.Groups {
		if ignoreRows {
			return
		}
		genAttrViewGroups(view, attrView)
		if writable {
			if err = av.SaveAttributeView(attrView); err != nil {
				logging.LogErrorf("save attribute view [%s] failed: %s", attrView.ID, err)
				return
			}
		}
	}

	for _, groupView := range view.Groups {
		groupView.Name = groupView.GetGroupValue()
		switch groupView.Name {
		case groupValueDefault:
			groupView.Name = fmt.Sprintf(Conf.language(264), groupKey.Name)
		case groupValueNotInRange:
			groupView.Name = Conf.language(265)
		case groupValueLast30Days:
			groupView.Name = fmt.Sprintf(Conf.language(259), 30)
		case groupValueLast7Days:
			groupView.Name = fmt.Sprintf(Conf.language(259), 7)
		case groupValueYesterday:
			groupView.Name = Conf.language(260)
		case groupValueToday:
			groupView.Name = Conf.language(261)
		case groupValueTomorrow:
			groupView.Name = Conf.language(262)
		case groupValueNext7Days:
			groupView.Name = fmt.Sprintf(Conf.language(263), 7)
		case groupValueNext30Days:
			groupView.Name = fmt.Sprintf(Conf.language(263), 30)
		}
	}

	sortGroupViews(attrView, view)
	targetGroupID = resolveAttributeViewTargetGroupID(view, target, targetGroupID)

	var groups []av.Viewable
	for _, groupView := range view.Groups {
		groupViewable := sql.RenderGroupViewWithSource(attrView, view, groupView, query, groupRenderSource, ignoreRows)

		groupPage, groupPageSize := page, pageSize
		if nil != groupPaging {
			if paging := groupPaging[groupView.ID]; nil != paging {
				pagingMap := paging.(map[string]any)
				if nil != pagingMap["page"] {
					groupPage = int(pagingMap["page"].(float64))
				}
				if nil != pagingMap["pageSize"] {
					groupPageSize = int(pagingMap["pageSize"].(float64))
				}
			}
		}

		groupTargetItemID := ""
		if nil != target {
			if (targetGroupID != "" && groupView.ID == targetGroupID) || (targetGroupID == "" && target.Status != "visible") {
				groupTargetItemID = target.ItemID
			}
		}
		targetIndex, targetOffset, renderErr := renderViewableInstance(groupViewable, view, attrView, groupPage, groupPageSize, ignoreRows, groupTargetItemID)
		err = renderErr
		if nil != err {
			return
		}
		if !ignoreRows {
			hideEmptyGroupViews(view, groupViewable)
		}
		if nil != target && targetIndex >= 0 {
			if groupViewable.GetGroupHidden() == 0 {
				if target.Status != "visible" || groupView.ID == targetGroupID {
					setAttributeViewRenderTarget(target, groupView.ID, targetIndex, targetOffset, view.PageSize)
				}
			} else if target.Status != "visible" {
				target.Status = "groupHidden"
				target.GroupID = groupView.ID
			}
		}

		groups = append(groups, groupViewable)

		// 将分组视图的分组字段清空，减少冗余（字段信息可以在总的视图 view 对象上获取到）
		switch groupView.LayoutType {
		case av.LayoutTypeTable:
			groupView.Table.Columns = nil
		case av.LayoutTypeGallery:
			groupView.Gallery.CardFields = nil
		case av.LayoutTypeKanban:
			groupView.Kanban.Fields = nil
		}
	}
	viewable.SetGroups(groups)

	// 将总的视图上的项目清空，减少冗余
	viewable.(av.Collection).SetItems(nil)
	return
}

func hideEmptyGroupViews(view *av.View, viewable av.Viewable) {
	if !view.IsGroupView() {
		return
	}

	groupHidden := viewable.GetGroupHidden()
	if !view.Group.HideEmpty {
		if 2 != groupHidden {
			viewable.SetGroupHidden(0)
		}
		return
	}

	itemCount := viewable.(av.Collection).CountItems()
	if 1 == groupHidden && 0 < itemCount {
		viewable.SetGroupHidden(0)
	}
}

func sortGroupViews(attrView *av.AttributeView, view *av.View) {
	if av.GroupOrderMan == view.Group.Order {
		sort.Slice(view.Groups, func(i, j int) bool { return view.Groups[i].GroupSort < view.Groups[j].GroupSort })
		return
	}

	if av.GroupMethodDateRelative == view.Group.Method {
		var relativeDateGroups []*av.View
		var last30Days, last7Days, yesterday, today, tomorrow, next7Days, next30Days, defaultGroup *av.View
		for _, groupView := range view.Groups {
			_, err := time.Parse("2006-01", groupView.GetGroupValue())
			if nil == err { // 如果能解析出来说明是 30 天之前或 30 天之后的分组形式
				relativeDateGroups = append(relativeDateGroups, groupView)
			} else { // 否则是相对日期分组形式
				switch groupView.GetGroupValue() {
				case groupValueLast30Days:
					last30Days = groupView
				case groupValueLast7Days:
					last7Days = groupView
				case groupValueYesterday:
					yesterday = groupView
				case groupValueToday:
					today = groupView
				case groupValueTomorrow:
					tomorrow = groupView
				case groupValueNext7Days:
					next7Days = groupView
				case groupValueNext30Days:
					next30Days = groupView
				case groupValueDefault:
					defaultGroup = groupView
				}
			}
		}

		sort.SliceStable(relativeDateGroups, func(i, j int) bool {
			return relativeDateGroups[i].GetGroupValue() < relativeDateGroups[j].GetGroupValue()
		})

		var lastNext30Days []*av.View
		if nil != next30Days {
			lastNext30Days = append(lastNext30Days, next30Days)
		}
		if nil != next7Days {
			lastNext30Days = append(lastNext30Days, next7Days)
		}
		if nil != tomorrow {
			lastNext30Days = append(lastNext30Days, tomorrow)
		}
		if nil != today {
			lastNext30Days = append(lastNext30Days, today)
		}
		if nil != yesterday {
			lastNext30Days = append(lastNext30Days, yesterday)
		}

		if nil != last7Days {
			lastNext30Days = append(lastNext30Days, last7Days)
		}
		if nil != last30Days {
			lastNext30Days = append(lastNext30Days, last30Days)
		}

		startIdx := -1
		todayStart := util.GetTodayStart()
		thisMonth := todayStart.Format("2006-01")
		for i, monthGroup := range relativeDateGroups {
			if monthGroup.GetGroupValue() < thisMonth {
				startIdx = i + 1
			}
		}
		if -1 == startIdx {
			startIdx = 0
		}
		for _, g := range lastNext30Days {
			relativeDateGroups = util.InsertElem(relativeDateGroups, startIdx, g)
		}

		if av.GroupOrderDesc == view.Group.Order {
			slices.Reverse(relativeDateGroups)
		}

		if nil != defaultGroup {
			relativeDateGroups = append(relativeDateGroups, defaultGroup)
		}

		view.Groups = relativeDateGroups
		return
	}

	if av.GroupOrderAsc == view.Group.Order || av.GroupOrderDesc == view.Group.Order {
		defaultGroup := view.GetGroupByGroupValue(groupValueDefault)
		if nil != defaultGroup {
			view.RemoveGroupByID(defaultGroup.ID)
		}

		sort.SliceStable(view.Groups, func(i, j int) bool {
			iVal, jVal := view.Groups[i].GetGroupValue(), view.Groups[j].GetGroupValue()
			if av.GroupOrderAsc == view.Group.Order {
				return util.NaturalCompare(iVal, jVal)
			}
			return util.NaturalCompare(jVal, iVal)
		})

		if nil != defaultGroup {
			view.Groups = append(view.Groups, defaultGroup)
		}
		return
	}

	if av.GroupOrderSelectOption == view.Group.Order {
		groupKey := view.GetGroupKey(attrView)
		if nil == groupKey {
			return
		}

		if av.KeyTypeSelect != groupKey.Type && av.KeyTypeMSelect != groupKey.Type {
			return
		}

		sortGroupsBySelectOption(view, groupKey)
		return
	}
}

func sortGroupsBySelectOption(view *av.View, groupKey *av.Key) {
	optionSort := map[string]int{}
	for i, op := range groupKey.Options {
		optionSort[op.Name] = i
	}

	defaultGroup := view.GetGroupByGroupValue(groupValueDefault)
	if nil != defaultGroup {
		view.RemoveGroupByID(defaultGroup.ID)
	}

	sort.Slice(view.Groups, func(i, j int) bool {
		vSort := optionSort[view.Groups[i].GetGroupValue()]
		oSort := optionSort[view.Groups[j].GetGroupValue()]
		return vSort < oSort
	})

	if nil != defaultGroup {
		view.Groups = append(view.Groups, defaultGroup)
	}
}

func isGroupByDate(view *av.View) bool {
	if !view.IsGroupView() {
		return false
	}
	return av.GroupMethodDateDay == view.Group.Method || av.GroupMethodDateWeek == view.Group.Method || av.GroupMethodDateMonth == view.Group.Method || av.GroupMethodDateYear == view.Group.Method || av.GroupMethodDateRelative == view.Group.Method
}

func isGroupByTemplate(attrView *av.AttributeView, view *av.View) bool {
	if !view.IsGroupView() {
		return false
	}

	groupKey := view.GetGroupKey(attrView)
	if nil == groupKey {
		return false
	}
	return av.KeyTypeTemplate == groupKey.Type
}

func renderViewableInstance(viewable av.Viewable, view *av.View, attrView *av.AttributeView, page, pageSize int, ignoreRows bool, targetItemID string) (targetIndex, targetOffset int, err error) {
	targetIndex = -1
	if nil == viewable {
		err = av.ErrViewNotFound
		logging.LogErrorf("render attribute view [%s] failed", attrView.ID)
		return
	}

	// ignoreRows 时行已为空，跳过 filter/sort/calc 和分页（菜单不需要行数据）
	if ignoreRows {
		return
	}

	cachedAttrViews := map[string]*av.AttributeView{}
	rollupFurtherCollections := sql.GetFurtherCollections(attrView, cachedAttrViews)
	av.Filter(viewable, attrView, rollupFurtherCollections, cachedAttrViews)
	av.Sort(viewable, attrView)
	av.Calc(viewable, attrView)

	// 分页
	switch viewable.GetType() {
	case av.LayoutTypeTable:
		table := viewable.(*av.Table)
		targetIndex = findAttributeViewTargetIndex(targetItemID, len(table.Rows), func(index int) string { return table.Rows[index].ID })
		table.RowCount = len(table.Rows)
		table.PageSize = view.PageSize
		if 1 > pageSize {
			pageSize = table.PageSize
		}
		start, end := getAttributeViewRenderRange(page, pageSize, targetIndex, table.PageSize, len(table.Rows))
		if targetIndex >= 0 {
			targetOffset = start
		}
		table.Rows = table.Rows[start:end]
	case av.LayoutTypeGallery:
		gallery := viewable.(*av.Gallery)
		targetIndex = findAttributeViewTargetIndex(targetItemID, len(gallery.Cards), func(index int) string { return gallery.Cards[index].ID })
		gallery.CardCount = len(gallery.Cards)
		gallery.PageSize = view.PageSize
		if 1 > pageSize {
			pageSize = gallery.PageSize
		}
		start, end := getAttributeViewRenderRange(page, pageSize, targetIndex, gallery.PageSize, len(gallery.Cards))
		if targetIndex >= 0 {
			targetOffset = start
		}
		gallery.Cards = gallery.Cards[start:end]
	case av.LayoutTypeKanban:
		kanban := viewable.(*av.Kanban)
		targetIndex = findAttributeViewTargetIndex(targetItemID, len(kanban.Cards), func(index int) string { return kanban.Cards[index].ID })
		kanban.CardCount = len(kanban.Cards)
		kanban.PageSize = view.PageSize
		if 1 > pageSize {
			pageSize = kanban.PageSize
		}
		start, end := getAttributeViewRenderRange(page, pageSize, targetIndex, kanban.PageSize, len(kanban.Cards))
		if targetIndex >= 0 {
			targetOffset = start
		}
		kanban.Cards = kanban.Cards[start:end]
	}
	return
}

func targetItemID(target *AttributeViewRenderTarget) string {
	if nil == target {
		return ""
	}
	return target.ItemID
}

func findAttributeViewTargetIndex(targetItemID string, length int, getID func(index int) string) int {
	if targetItemID == "" {
		return -1
	}
	for i := 0; i < length; i++ {
		if getID(i) == targetItemID {
			return i
		}
	}
	return -1
}

func getAttributeViewRenderRange(page, pageSize, targetIndex, defaultPageSize, length int) (start, end int) {
	if 1 > defaultPageSize {
		defaultPageSize = av.ViewDefaultPageSize
	}
	if 1 > pageSize {
		pageSize = defaultPageSize
	}
	if targetIndex < 0 {
		start = min(length, max(0, (page-1)*pageSize))
		end = min(length, start+pageSize)
		return
	}

	windowSize := min(length, max(defaultPageSize, av.ViewDefaultPageSize*4))
	start = max(0, targetIndex-windowSize/2)
	end = min(length, start+windowSize)
	start = max(0, end-windowSize)
	return
}

func resolveAttributeViewTargetGroupID(view *av.View, target *AttributeViewRenderTarget, targetGroupID string) string {
	if targetGroupID == "" || nil == target {
		return targetGroupID
	}
	targetGroup := view.GetGroupByID(targetGroupID)
	if nil == targetGroup || !gulu.Str.Contains(target.ItemID, targetGroup.GroupItemIDs) {
		return ""
	}
	return targetGroupID
}

func setAttributeViewRenderTarget(target *AttributeViewRenderTarget, groupID string, index, offset, pageSize int) {
	target.Status = "visible"
	target.GroupID = groupID
	target.Index = index
	target.Offset = offset
	target.PageSize = pageSize
}

func getRenderAttributeViewView(attrView *av.AttributeView, viewID, carrierViewID, nodeID string, writable bool) (ret *av.View, err error) {
	if _, firstViewErr := attrView.GetFirstView(); nil != firstViewErr {
		view, _, _ := av.NewTableViewWithBlockKey(ast.NewNodeID())
		attrView.Views = append(attrView.Views, view)
		if writable {
			if err = av.SaveAttributeView(attrView); err != nil {
				logging.LogErrorf("save attribute view [%s] failed: %s", attrView.ID, err)
				return
			}
		}
	}
	return resolveAttributeViewView(attrView, viewID, carrierViewID, nodeID)
}

// avBoxIDFromRepoPath 从快照文件路径反查 boxID。
// 全局路径 /storage/av/<avID>.json 返回空串；加密笔记本路径 /<boxID>/storage/av/<avID>.json 返回 boxID。
func avBoxIDFromRepoPath(repoPath string) string {
	parts := strings.Split(repoPath, "/")
	// 全局路径: ["", "storage", "av", "xxx.json"] → parts[1]=="storage"
	// 加密 box: ["", "<boxID>", "storage", "av", "xxx.json"] → parts[1]=="<boxID>"
	if len(parts) >= 4 && parts[2] == "storage" {
		return parts[1]
	}
	return ""
}

// ResolveRepoSnapshotAttributeViewBoxID 返回快照属性视图的唯一加密笔记本上下文。
func ResolveRepoSnapshotAttributeViewBoxID(indexID, avID string) (string, error) {
	if !ast.IsNodeIDPattern(avID) {
		return "", ErrInvalidID
	}
	repo, err := newRepository()
	if err != nil {
		return "", err
	}
	index, err := repo.GetIndex(indexID)
	if err != nil {
		return "", err
	}
	files, err := repo.GetFiles(index)
	if err != nil {
		return "", err
	}
	var matches []*entity.File
	for _, file := range files {
		if strings.HasSuffix(file.Path, "/storage/av/"+avID+".json") {
			matches = append(matches, file)
		}
	}
	if len(matches) == 0 {
		return "", av.ErrAttributeViewNotFound
	}
	if len(matches) != 1 {
		return "", fmt.Errorf("attribute view snapshot context is ambiguous [%s]", avID)
	}
	boxID := avBoxIDFromRepoPath(matches[0].Path)
	if IsEncryptedBox(boxID) {
		return boxID, nil
	}
	return "", nil
}

// ResolveHistoryAttributeViewBoxID 返回历史属性视图的唯一加密笔记本上下文。
func ResolveHistoryAttributeViewBoxID(avID, created string) (string, error) {
	if !ast.IsNodeIDPattern(avID) {
		return "", ErrInvalidID
	}
	createdUnix, err := strconv.ParseInt(created, 10, 64)
	if err != nil {
		return "", fmt.Errorf("parse created [%s] failed: %w", created, err)
	}
	dirPrefix := time.Unix(createdUnix, 0).Format("2006-01-02-150405")
	matches, err := filepath.Glob(filepath.Join(util.HistoryDir, dirPrefix+"*"))
	if err != nil {
		return "", err
	}
	var boxIDs []string
	for _, historyDir := range matches {
		if gulu.File.IsExist(filepath.Join(historyDir, "storage", "av", avID+".json")) {
			boxIDs = append(boxIDs, "")
		}
		entries, _ := os.ReadDir(historyDir)
		for _, entry := range entries {
			if !entry.IsDir() || !ast.IsNodeIDPattern(entry.Name()) {
				continue
			}
			candidate := filepath.Join(historyDir, entry.Name(), "storage", "av", avID+".json")
			if gulu.File.IsExist(candidate) {
				boxIDs = append(boxIDs, entry.Name())
			}
		}
	}
	if len(boxIDs) == 0 {
		return "", av.ErrAttributeViewNotFound
	}
	if len(boxIDs) != 1 {
		return "", fmt.Errorf("attribute view history context is ambiguous [%s]", avID)
	}
	if IsEncryptedBox(boxIDs[0]) {
		return boxIDs[0], nil
	}
	return "", nil
}

func RenderRepoSnapshotAttributeView(indexID, avID, viewID, carrierViewID string) (viewable av.Viewable, attrView *av.AttributeView, err error) {
	if !ast.IsNodeIDPattern(avID) {
		err = ErrInvalidID
		return
	}

	repo, err := newRepository()
	if err != nil {
		return
	}

	index, err := repo.GetIndex(indexID)
	if err != nil {
		return
	}

	files, err := repo.GetFiles(index)
	if err != nil {
		return
	}
	var avFiles []*entity.File
	for _, f := range files {
		// 匹配全局 /storage/av/<avID>.json 或加密笔记本/<boxID>/storage/av/<avID>.json
		if strings.HasSuffix(f.Path, "/storage/av/"+avID+".json") {
			avFiles = append(avFiles, f)
		}
	}

	if len(avFiles) == 0 {
		attrView = av.NewAttributeView(avID)
		err = av.ErrAttributeViewNotFound
		return
	}
	if len(avFiles) != 1 {
		err = fmt.Errorf("attribute view snapshot context is ambiguous [%s]", avID)
		return
	}
	avFile := avFiles[0]

	data, readErr := repo.OpenFile(avFile)
	if nil != readErr {
		logging.LogErrorf("read attribute view [%s] failed: %s", avID, readErr)
		err = readErr
		return
	}

	data, err = decryptHistoricalAttributeView(avBoxIDFromRepoPath(avFile.Path), avID, data)
	if err != nil {
		logging.LogErrorf("decrypt snapshot attribute view [%s] failed: %s", avID, err)
		return
	}

	attrView = av.NewAttributeView(avID)
	if err = gulu.JSON.UnmarshalJSON(data, attrView); err != nil {
		logging.LogErrorf("unmarshal attribute view [%s] failed: %s", avID, err)
		return
	}
	if err = av.CheckSpec(attrView); nil != err {
		return
	}

	viewable, err = renderAttributeView(attrView, "", viewID, carrierViewID, "", 1, -1, nil, false, false, nil, "")
	return
}

func RenderHistoryAttributeView(avID, viewID, carrierViewID, query string, page, pageSize int, groupPaging map[string]any, created string) (viewable av.Viewable, attrView *av.AttributeView, err error) {
	if !ast.IsNodeIDPattern(avID) {
		err = ErrInvalidID
		return
	}

	createdUnix, parseErr := strconv.ParseInt(created, 10, 64)
	if nil != parseErr {
		logging.LogErrorf("parse created [%s] failed: %s", created, parseErr)
		err = fmt.Errorf("parse created [%s] failed: %w", created, parseErr)
		return
	}

	dirPrefix := time.Unix(createdUnix, 0).Format("2006-01-02-150405")
	globPath := filepath.Join(util.HistoryDir, dirPrefix+"*")
	matches, err := filepath.Glob(globPath)
	if err != nil {
		logging.LogErrorf("glob [%s] failed: %s", globPath, err)
		return
	}
	if 1 > len(matches) {
		err = av.ErrAttributeViewNotFound
		return
	}

	type historyAttributeViewSource struct {
		path  string
		boxID string
	}
	var sources []historyAttributeViewSource
	for _, historyDir := range matches {
		globalPath := filepath.Join(historyDir, "storage", "av", avID+".json")
		if gulu.File.IsExist(globalPath) {
			sources = append(sources, historyAttributeViewSource{path: globalPath})
		}
		entries, _ := os.ReadDir(historyDir)
		for _, entry := range entries {
			if entry.IsDir() && ast.IsNodeIDPattern(entry.Name()) {
				candidate := filepath.Join(historyDir, entry.Name(), "storage", "av", avID+".json")
				if gulu.File.IsExist(candidate) {
					sources = append(sources, historyAttributeViewSource{path: candidate, boxID: entry.Name()})
				}
			}
		}
	}
	if len(sources) == 0 {
		attrView = av.NewAttributeView(avID)
		err = av.ErrAttributeViewNotFound
		return
	}
	if len(sources) != 1 {
		err = fmt.Errorf("attribute view history context is ambiguous [%s]", avID)
		return
	}
	source := sources[0]

	data, readErr := os.ReadFile(source.path)
	if nil != readErr {
		logging.LogErrorf("read attribute view [%s] failed: %s", avID, readErr)
		err = readErr
		return
	}

	data, err = decryptHistoricalAttributeView(source.boxID, avID, data)
	if err != nil {
		logging.LogErrorf("decrypt history attribute view [%s] failed: %s", avID, err)
		return
	}

	attrView = av.NewAttributeView(avID)
	if err = gulu.JSON.UnmarshalJSON(data, attrView); err != nil {
		logging.LogErrorf("unmarshal attribute view [%s] failed: %s", avID, err)
		return
	}
	if err = av.CheckSpec(attrView); nil != err {
		return
	}

	viewable, err = renderAttributeView(attrView, "", viewID, carrierViewID, query, page, pageSize, groupPaging, false, false, nil, "")
	return
}

func decryptHistoricalAttributeView(boxID, avID string, data []byte) ([]byte, error) {
	ciphertext := util.IsCiphertext(data)
	if boxID == "" {
		if ciphertext {
			return nil, errors.New("encrypted attribute view snapshot is missing notebook context")
		}
		return data, nil
	}
	if !IsEncryptedBox(boxID) {
		if ciphertext {
			return nil, fmt.Errorf("encrypted attribute view snapshot has no matching notebook [%s]", boxID)
		}
		return data, nil
	}
	if !ciphertext {
		return nil, fmt.Errorf("encrypted notebook attribute view snapshot is plaintext [%s]", boxID)
	}
	return av.DecryptAVData(boxID, avID, data)
}
