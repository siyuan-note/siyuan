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
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strconv"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func RenderAttributeView(blockID, avID, viewID, query string, page, pageSize int, groupPaging map[string]interface{}) (viewable av.Viewable, attrView *av.AttributeView, err error) {
	waitForSyncingStorages()

	if avJSONPath := av.GetAttributeViewDataPath(avID); !filelock.IsExist(avJSONPath) {
		attrView = av.NewAttributeView(avID)
		if err = av.SaveAttributeView(attrView); err != nil {
			logging.LogErrorf("save attribute view [%s] failed: %s", avID, err)
			return
		}
	}

	attrView, err = av.ParseAttributeView(avID)
	if err != nil {
		logging.LogErrorf("parse attribute view [%s] failed: %s", avID, err)
		return
	}

	viewable, err = renderAttributeView(attrView, blockID, viewID, query, page, pageSize, groupPaging)
	return
}

const (
	groupValueDefault                                        = "_@default@_"    // 默认分组值（值为空的默认分组）
	groupValueNotInRange                                     = "_@notInRange@_" // 不再范围内的分组值（只有数字类型的分组才可能是该值）
	groupValueLast30Days, groupValueLast7Days                = "_@last30Days@_", "_@last7Days@_"
	groupValueYesterday, groupValueToday, groupValueTomorrow = "_@yesterday@_", "_@today@_", "_@tomorrow@_"
	groupValueNext7Days, groupValueNext30Days                = "_@next7Days@_", "_@next30Days@_"
)

func renderAttributeView(attrView *av.AttributeView, nodeID, viewID, query string, page, pageSize int, groupPaging map[string]interface{}) (viewable av.Viewable, err error) {
	// 获取待渲染的视图
	view, err := getRenderAttributeViewView(attrView, viewID, nodeID)
	if nil != err {
		return
	}

	// 做一些数据兼容和订正处理
	checkAttrView(attrView, view)
	upgradeAttributeViewSpec(attrView)

	// 渲染视图
	viewable = sql.RenderView(attrView, view, query)
	err = renderViewableInstance(viewable, view, attrView, page, pageSize)
	if nil != err {
		return
	}

	// 渲染分组视图
	err = renderAttributeViewGroups(viewable, attrView, view, query, page, pageSize, groupPaging)
	return
}

func renderAttributeViewGroups(viewable av.Viewable, attrView *av.AttributeView, view *av.View, query string, page, pageSize int, groupPaging map[string]interface{}) (err error) {
	groupKey := view.GetGroupKey(attrView)
	if nil == groupKey {
		if view.LayoutType == av.LayoutTypeKanban {
			preferredGroupKey := getKanbanPreferredGroupKey(attrView)
			group := &av.ViewGroup{Field: preferredGroupKey.ID}
			setAttributeViewGroup(attrView, view, group)
			av.SaveAttributeView(attrView)
			groupKey = view.GetGroupKey(attrView)
		} else {
			return
		}
	}

	// 当前日期可能会变，所以如果是按日期分组则需要重新生成分组
	if isGroupByDate(view) {
		createdDate := time.UnixMilli(view.GroupCreated).Format("2006-01-02")
		if time.Now().Format("2006-01-02") != createdDate {
			genAttrViewGroups(view, attrView) // 仅重新生成一个视图的分组以提升性能
			av.SaveAttributeView(attrView)
		}
	}

	// 如果是按模板分组则需要重新生成分组
	if isGroupByTemplate(attrView, view) {
		genAttrViewGroups(view, attrView) // 仅重新生成一个视图的分组以提升性能
		av.SaveAttributeView(attrView)
	}

	// 渲染分组视图
	if nil == view.Groups {
		genAttrViewGroups(view, attrView)
		av.SaveAttributeView(attrView)
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

	var groups []av.Viewable
	for _, groupView := range view.Groups {
		groupViewable := sql.RenderGroupView(attrView, view, groupView, query)

		groupPage, groupPageSize := page, pageSize
		if nil != groupPaging {
			if paging := groupPaging[groupView.ID]; nil != paging {
				pagingMap := paging.(map[string]interface{})
				if nil != pagingMap["page"] {
					groupPage = int(pagingMap["page"].(float64))
				}
				if nil != pagingMap["pageSize"] {
					groupPageSize = int(pagingMap["pageSize"].(float64))
				}
			}
		}

		err = renderViewableInstance(groupViewable, view, attrView, groupPage, groupPageSize)
		if nil != err {
			return
		}

		hideEmptyGroupViews(view, groupViewable)
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

func renderViewableInstance(viewable av.Viewable, view *av.View, attrView *av.AttributeView, page, pageSize int) (err error) {
	if nil == viewable {
		err = av.ErrViewNotFound
		logging.LogErrorf("render attribute view [%s] failed", attrView.ID)
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
		table.RowCount = len(table.Rows)
		table.PageSize = view.PageSize
		if 1 > pageSize {
			pageSize = table.PageSize
		}
		start := (page - 1) * pageSize
		end := start + pageSize
		if len(table.Rows) < end {
			end = len(table.Rows)
		}
		table.Rows = table.Rows[start:end]
	case av.LayoutTypeGallery:
		gallery := viewable.(*av.Gallery)
		gallery.CardCount = len(gallery.Cards)
		gallery.PageSize = view.PageSize
		if 1 > pageSize {
			pageSize = gallery.PageSize
		}
		start := (page - 1) * pageSize
		end := start + pageSize
		if len(gallery.Cards) < end {
			end = len(gallery.Cards)
		}
		gallery.Cards = gallery.Cards[start:end]
	case av.LayoutTypeKanban:
		kanban := viewable.(*av.Kanban)
		kanban.CardCount = len(kanban.Cards)
		kanban.PageSize = view.PageSize
		if 1 > pageSize {
			pageSize = kanban.PageSize
		}
		start := (page - 1) * pageSize
		end := start + pageSize
		if len(kanban.Cards) < end {
			end = len(kanban.Cards)
		}
		kanban.Cards = kanban.Cards[start:end]
	}
	return
}

func getRenderAttributeViewView(attrView *av.AttributeView, viewID, nodeID string) (ret *av.View, err error) {
	if 1 > len(attrView.Views) {
		view, _, _ := av.NewTableViewWithBlockKey(ast.NewNodeID())
		attrView.Views = append(attrView.Views, view)
		attrView.ViewID = view.ID
		if err = av.SaveAttributeView(attrView); err != nil {
			logging.LogErrorf("save attribute view [%s] failed: %s", attrView.ID, err)
			return
		}
	}

	if "" == viewID && "" != nodeID {
		node, _, _ := getNodeByBlockID(nil, nodeID)
		if nil != node {
			viewID = node.IALAttr(av.NodeAttrView)
		}
	}

	if "" != viewID {
		ret, _ = attrView.GetCurrentView(viewID)
		if nil != ret && ret.ID != attrView.ViewID {
			attrView.ViewID = ret.ID
			if err = av.SaveAttributeView(attrView); err != nil {
				logging.LogErrorf("save attribute view [%s] failed: %s", attrView.ID, err)
				return
			}
		}
	} else {
		ret = attrView.GetView(attrView.ViewID)
	}

	if nil == ret {
		ret = attrView.Views[0]
	}
	return
}

func RenderRepoSnapshotAttributeView(indexID, avID string) (viewable av.Viewable, attrView *av.AttributeView, err error) {
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

		attrView = av.NewAttributeView(avID)
		if err = gulu.JSON.UnmarshalJSON(data, attrView); err != nil {
			logging.LogErrorf("unmarshal attribute view [%s] failed: %s", avID, err)
			return
		}
	}

	viewable, err = renderAttributeView(attrView, "", "", "", 1, -1, nil)
	return
}

func RenderHistoryAttributeView(blockID, avID, viewID, query string, page, pageSize int, groupPaging map[string]interface{}, created string) (viewable av.Viewable, attrView *av.AttributeView, err error) {
	createdUnix, parseErr := strconv.ParseInt(created, 10, 64)
	if nil != parseErr {
		logging.LogErrorf("parse created [%s] failed: %s", created, parseErr)
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
		return
	}

	historyDir := matches[0]
	avJSONPath := filepath.Join(historyDir, "storage", "av", avID+".json")
	if !gulu.File.IsExist(avJSONPath) {
		logging.LogWarnf("attribute view [%s] not found in history data [%s], use current data instead", avID, historyDir)
		avJSONPath = filepath.Join(util.DataDir, "storage", "av", avID+".json")
	}
	if !gulu.File.IsExist(avJSONPath) {
		logging.LogWarnf("attribute view [%s] not found in current data", avID)
		attrView = av.NewAttributeView(avID)
	} else {
		data, readErr := os.ReadFile(avJSONPath)
		if nil != readErr {
			logging.LogErrorf("read attribute view [%s] failed: %s", avID, readErr)
			return
		}

		attrView = av.NewAttributeView(avID)
		if err = gulu.JSON.UnmarshalJSON(data, attrView); err != nil {
			logging.LogErrorf("unmarshal attribute view [%s] failed: %s", avID, err)
			return
		}
	}

	viewable, err = renderAttributeView(attrView, blockID, viewID, query, page, pageSize, groupPaging)
	return
}
