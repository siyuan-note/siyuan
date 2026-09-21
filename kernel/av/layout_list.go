// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import "fmt"

// LayoutList 使用行列字段结构，独立保存列表布局的字段顺序和显隐设置。
type LayoutList = LayoutTable

// List 描述列表视图实例，复用表格的条目和字段操作。
type List struct {
	*Table
}

func (*List) GetType() LayoutType {
	return LayoutTypeList
}

func NewListView() *View {
	view := NewTableView()
	view.Name = GetAttributeViewI18n("list")
	view.LayoutType = LayoutTypeList
	view.List = NewLayoutList()
	view.Table = nil
	return view
}

func NewLayoutList() *LayoutList {
	return NewLayoutTable()
}

// GetTableLayout 返回当前布局使用的行列字段设置。
func (view *View) GetTableLayout() *LayoutTable {
	if LayoutTypeCalendar == view.LayoutType {
		return view.Calendar.LayoutTable
	}
	if LayoutTypeList == view.LayoutType {
		return view.List
	}
	return view.Table
}

// TableFromViewable 获取表格或列表实例的行列数据。
func TableFromViewable(viewable Viewable) *Table {
	switch instance := viewable.(type) {
	case *Table:
		return instance
	case *List:
		return instance.Table
	case *Calendar:
		return instance.Table
	}
	return nil
}

// ValidateListLayouts 校验列表布局的结构，拒绝损坏数据并保留原始文件。
func (attrView *AttributeView) ValidateListLayouts() error {
	if err := attrView.ValidateCalendarLayouts(); nil != err {
		return err
	}
	var validate func(*View) error
	validate = func(view *View) error {
		if nil == view {
			return nil
		}
		if LayoutTypeList == view.LayoutType && nil == view.List {
			return fmt.Errorf("list layout missing in view [%s]", view.ID)
		}
		if nil != view.List {
			if nil == view.List.BaseLayout {
				return fmt.Errorf("invalid list layout in view [%s]", view.ID)
			}
			for _, column := range view.List.Columns {
				if nil == column || nil == column.BaseField {
					return fmt.Errorf("invalid list field in view [%s]", view.ID)
				}
			}
		}
		for _, group := range view.Groups {
			if err := validate(group); nil != err {
				return err
			}
		}
		return nil
	}
	for _, view := range attrView.Views {
		if err := validate(view); nil != err {
			return err
		}
	}
	return nil
}
