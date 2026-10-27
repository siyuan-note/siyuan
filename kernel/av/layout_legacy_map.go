// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"encoding/json"
	"fmt"
)

// UnmarshalJSON 原样保留已撤回的地图配置，并用表格读取记录。
// 优先保留已有表格设置，否则沿用旧地图的字段顺序；未知地图设置不参与运行时或公开响应。
func (view *View) UnmarshalJSON(data []byte) error {
	type plainView View
	next := plainView(*view)
	if err := json.Unmarshal(data, &next); err != nil {
		return err
	}
	next.legacyMapFallback = false
	if next.LayoutType == "map" {
		next.LayoutType = LayoutTypeTable
		next.legacyMapFallback = true
		if next.Table != nil {
			if next.Table.BaseLayout == nil || next.Table.Spec != 0 {
				return fmt.Errorf("invalid stored table layout in retired map view [%s]", next.ID)
			}
			for _, column := range next.Table.Columns {
				if column == nil || column.BaseField == nil {
					return fmt.Errorf("invalid stored table field in retired map view [%s]", next.ID)
				}
			}
		}
		if next.Table == nil {
			var layout LayoutTable
			if err := json.Unmarshal(next.LegacyMap, &layout); err == nil && layout.BaseLayout != nil && layout.Spec == 0 {
				valid := true
				for _, column := range layout.Columns {
					if column == nil || column.BaseField == nil {
						valid = false
						break
					}
				}
				if valid {
					next.Table = &layout
				}
			}
			if next.Table == nil {
				next.Table = NewLayoutTable()
			}
		}
	}
	*view = View(next)
	return nil
}

// 旧地图或未知地图格式回退后仍须提供数据库中的所有字段。
func (attrView *AttributeView) restoreLegacyMapColumns() {
	var restore func(*View)
	restore = func(view *View) {
		if view == nil {
			return
		}
		if view.legacyMapFallback {
			seen := map[string]bool{}
			for _, column := range view.Table.Columns {
				seen[column.ID] = true
			}
			for _, keyValues := range attrView.KeyValues {
				if keyValues != nil && keyValues.Key != nil && !seen[keyValues.Key.ID] {
					view.Table.Columns = append(view.Table.Columns, &ViewTableColumn{BaseField: &BaseField{ID: keyValues.Key.ID}})
				}
			}
		}
		for _, group := range view.Groups {
			restore(group)
		}
	}
	for _, view := range attrView.Views {
		restore(view)
	}
}
