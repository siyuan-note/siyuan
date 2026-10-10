// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"bytes"
	"encoding/json"
	"fmt"

	"github.com/88250/lute/ast"
)

// MapSettings 只保存位置字段绑定，底图固定为 OpenFreeMap。
type MapSettings struct {
	LocationKeyID string `json:"locationKeyID"`
}

// UnmarshalJSON 拒绝额外设置，避免把不支持的地图结构静默保存为新结构。
func (settings *MapSettings) UnmarshalJSON(data []byte) error {
	type plainSettings MapSettings
	var next plainSettings
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&next); err != nil {
		return err
	}
	*settings = MapSettings(next)
	return nil
}

// Validate 允许缺失的字段引用，保持跨设备、删除和撤销后的原始绑定。
func (settings MapSettings) Validate() error {
	if settings.LocationKeyID != "" && !ast.IsNodeIDPattern(settings.LocationKeyID) {
		return fmt.Errorf("invalid map location field ID")
	}
	return nil
}

// LayoutMap 复用表格的数据字段、筛选、排序及分页。
type LayoutMap struct {
	*LayoutTable
	Settings MapSettings `json:"settings"`
}

type Map struct {
	*Table
	// 保留筛选和排序后的完整行集，供发布权限过滤后重新分页和未定位条目查询；绝不序列化给客户端。
	RowsBeforePagination []*TableRow `json:"-"`
}

func (*Map) GetType() LayoutType { return LayoutTypeMap }

func NewMapView() *View {
	view := NewTableView()
	view.Name = GetAttributeViewI18n("map")
	view.LayoutType = LayoutTypeMap
	view.Map = &LayoutMap{LayoutTable: view.Table}
	view.Table = nil
	return view
}

// HasMap 包含未激活和分组内暂存的地图配置，防止旧内核重写后丢失设置。
func (attrView *AttributeView) HasMap() bool {
	if attrView == nil {
		return false
	}
	var hasMap func(*View) bool
	hasMap = func(view *View) bool {
		if view == nil {
			return false
		}
		if view.Map != nil || view.LayoutType == LayoutTypeMap {
			return true
		}
		for _, group := range view.Groups {
			if hasMap(group) {
				return true
			}
		}
		return false
	}
	for _, view := range attrView.Views {
		if hasMap(view) {
			return true
		}
	}
	return false
}

// ValidateMapLayouts 拒绝损坏或未知版本的地图配置，不修复、不覆盖源文件。
func (attrView *AttributeView) ValidateMapLayouts() error {
	var validate func(*View) error
	validate = func(view *View) error {
		if view == nil {
			return nil
		}
		if view.LayoutType == LayoutTypeMap && view.Map == nil {
			return fmt.Errorf("map layout missing in view [%s]", view.ID)
		}
		if layout := view.Map; layout != nil {
			if layout.LayoutTable == nil || layout.BaseLayout == nil || layout.Spec != 0 {
				return fmt.Errorf("invalid map layout in view [%s]", view.ID)
			}
			if err := layout.Settings.Validate(); err != nil {
				return err
			}
			for _, column := range layout.Columns {
				if column == nil || column.BaseField == nil {
					return fmt.Errorf("invalid map field in view [%s]", view.ID)
				}
			}
		}
		for _, group := range view.Groups {
			if err := validate(group); err != nil {
				return err
			}
		}
		return nil
	}
	for _, view := range attrView.Views {
		if err := validate(view); err != nil {
			return err
		}
	}
	return nil
}
