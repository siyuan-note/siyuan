// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"github.com/88250/lute/ast"
	"github.com/jinzhu/copier"
	"github.com/siyuan-note/siyuan/kernel/av"
)

// cloneAttributeViewLayouts 同时复制当前和暂存布局，保持切换布局后的用户设置。
func cloneAttributeViewLayouts(target, source *av.View) (err error) {
	if nil != source.Table {
		target.Table = &av.LayoutTable{}
		if err = copier.CopyWithOption(target.Table, source.Table, copier.Option{DeepCopy: true}); nil != err {
			return
		}
		target.Table.ID = ast.NewNodeID()
	}
	if nil != source.List {
		target.List = &av.LayoutList{}
		if err = copier.CopyWithOption(target.List, source.List, copier.Option{DeepCopy: true}); nil != err {
			return
		}
		target.List.ID = ast.NewNodeID()
	}
	if nil != source.Calendar {
		target.Calendar = &av.LayoutCalendar{}
		if err = copier.CopyWithOption(target.Calendar, source.Calendar, copier.Option{DeepCopy: true}); nil != err {
			return
		}
		target.Calendar.ID = ast.NewNodeID()
	}
	if nil != source.Gallery {
		target.Gallery = &av.LayoutGallery{}
		if err = copier.CopyWithOption(target.Gallery, source.Gallery, copier.Option{DeepCopy: true}); nil != err {
			return
		}
		target.Gallery.ID = ast.NewNodeID()
	}
	if nil != source.Kanban {
		target.Kanban = &av.LayoutKanban{}
		if err = copier.CopyWithOption(target.Kanban, source.Kanban, copier.Option{DeepCopy: true}); nil != err {
			return
		}
		target.Kanban.ID = ast.NewNodeID()
	}
	return
}

// attributeViewFieldIDs 按当前布局的字段顺序返回字段 ID。
func attributeViewFieldIDs(view *av.View) (ret []string) {
	switch view.LayoutType {
	case av.LayoutTypeTable, av.LayoutTypeList, av.LayoutTypeCalendar:
		if layout := view.GetTableLayout(); nil != layout {
			for _, column := range layout.Columns {
				ret = append(ret, column.ID)
			}
		}
	case av.LayoutTypeGallery:
		for _, field := range view.Gallery.CardFields {
			ret = append(ret, field.ID)
		}
	case av.LayoutTypeKanban:
		for _, field := range view.Kanban.Fields {
			ret = append(ret, field.ID)
		}
	}
	return
}

// newAttributeViewListLayout 初始化列表字段，仅显示主键；已有列表配置无需重新初始化。
func newAttributeViewListLayout(attrView *av.AttributeView, fieldIDs []string) *av.LayoutList {
	ret := av.NewLayoutList()
	seen := map[string]bool{}
	appendField := func(id string) {
		if seen[id] {
			return
		}
		key, err := attrView.GetKey(id)
		if nil != err {
			return
		}
		seen[id] = true
		ret.Columns = append(ret.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{
			ID: id, Hidden: av.KeyTypeBlock != key.Type,
		}})
	}
	if primary := attrView.GetBlockKeyValues(); nil != primary && nil != primary.Key {
		appendField(primary.Key.ID)
	}
	for _, id := range fieldIDs {
		appendField(id)
	}
	for _, keyValues := range attrView.KeyValues {
		appendField(keyValues.Key.ID)
	}
	return ret
}
