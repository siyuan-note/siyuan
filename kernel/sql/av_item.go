// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
)

// RenderViewItem 为属性面板计算单条记录，关联汇总仅物化该记录依赖的条目。
func RenderViewItem(attrView *av.AttributeView, view *av.View, itemID string) av.Viewable {
	context := NewAttributeViewRenderContext()
	context.itemScope = true
	defer context.PushTemplateErrors()
	depth := 1
	return renderView(attrView, attributeViewItemScope(view, []string{itemID}), "", &depth,
		map[string]*av.AttributeView{attrView.ID: attrView}, false, false, context)
}

func attributeViewItemScope(view *av.View, itemIDs []string) *av.View {
	// 独立视图身份隔离完整视图的渲染缓存，分组范围仅作用于本次行生成。
	scoped := *view
	scoped.ID = ast.NewNodeID()
	scoped.GroupItemIDs = itemIDs
	return &scoped
}

func attributeViewRelatedItemIDs(source *av.AttributeView, collection av.Collection, relationKeyID string) []string {
	ret := []string{}
	seen := map[string]bool{}
	for _, item := range collection.GetItems() {
		value := source.GetValue(relationKeyID, item.GetID())
		if value == nil || value.Relation == nil {
			continue
		}
		for _, id := range value.Relation.BlockIDs {
			if !seen[id] {
				seen[id] = true
				ret = append(ret, id)
			}
		}
	}
	return ret
}
