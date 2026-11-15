// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
)

func RenderViewGroupItems(attrView *av.AttributeView, view *av.View) []av.Item {
	key := view.GetGroupKey(attrView)
	if key != nil && view.Group.ValueSource != av.ValueSourceRendered {
		switch key.Type {
		case av.KeyTypeText, av.KeyTypeNumber, av.KeyTypeDate, av.KeyTypeSelect, av.KeyTypeMSelect,
			av.KeyTypeCheckbox, av.KeyTypeURL, av.KeyTypeEmail, av.KeyTypePhone, av.KeyTypeMAsset:
			// 原始值分组只物化主键和分组字段，避免求值无关的关联、汇总和模板。
			// 独立表格布局不写入完整视图缓存，保留条目范围及手工顺序。
			scoped := *view
			scoped.ID = ast.NewNodeID()
			scoped.LayoutType = av.LayoutTypeTable
			scoped.Table = &av.LayoutTable{BaseLayout: &av.BaseLayout{}}
			if blockKey := attrView.GetBlockKey(); blockKey != nil {
				scoped.Table.Columns = append(scoped.Table.Columns,
					&av.ViewTableColumn{BaseField: &av.BaseField{ID: blockKey.ID}})
			}
			scoped.Table.Columns = append(scoped.Table.Columns,
				&av.ViewTableColumn{BaseField: &av.BaseField{ID: key.ID}})
			depth := 1
			return renderAttributeViewTable(attrView, &scoped, "", &depth,
				map[string]*av.AttributeView{attrView.ID: attrView}, false, true,
				NewAttributeViewRenderContext()).GetItems()
		}
	}
	return RenderView(attrView, view, "", false).(av.Collection).GetItems()
}
