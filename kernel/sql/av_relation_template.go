package sql

import (
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
)

// fillRelationPrimaryTemplates 只为已关联条目计算目标主键显示模板，不受目标视图布局、过滤和分页影响。
func fillRelationPrimaryTemplates(target *av.AttributeView, relations []*av.Value, depth *int,
	cachedAttrViews map[string]*av.AttributeView, context *AttributeViewRenderContext) {
	if nil == target || context.renderingRelationTemplates {
		return
	}
	primary := target.GetBlockKey()
	if nil == primary || "" == strings.TrimSpace(primary.RenderTemplate) {
		return
	}

	itemIDs := map[string]bool{}
	for _, relation := range relations {
		for _, content := range relation.Relation.Contents {
			itemIDs[content.BlockID] = true
		}
	}
	if 0 == len(itemIDs) {
		return
	}

	// 使用独立副本，避免自关联的嵌套渲染修改外层正在计算的字段值。
	cloned := *target
	cloned.KeyValues = nil
	cloned.RenderedViewables = nil
	view := &av.View{ID: ast.NewNodeID(), LayoutType: av.LayoutTypeTable, Table: av.NewLayoutTable()}
	for itemID := range itemIDs {
		view.GroupItemIDs = append(view.GroupItemIDs, itemID)
	}
	for _, keyValues := range target.KeyValues {
		key := *keyValues.Key
		if primary.ID != key.ID {
			key.RenderTemplate = ""
		}
		copied := &av.KeyValues{Key: &key}
		for _, value := range keyValues.Values {
			copied.Values = append(copied.Values, av.CloneStoredValue(value).Clone())
		}
		cloned.KeyValues = append(cloned.KeyValues, copied)
		view.Table.Columns = append(view.Table.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: key.ID}})
	}
	cache := make(map[string]*av.AttributeView, len(cachedAttrViews))
	for id, attrView := range cachedAttrViews {
		cache[id] = attrView
	}
	cache[target.ID] = &cloned

	// 显示模板只能读取原始值，计算目标模板时无需再次展开关联主键显示模板。
	context.renderingRelationTemplates = true
	defer func() { context.renderingRelationTemplates = false }()
	nestedDepth := *depth
	rendered := renderView(&cloned, view, "", &nestedDepth, cache, false, false, context)
	if nil == rendered {
		return
	}
	collection := rendered.(av.Collection)
	values := map[string]*av.Value{}
	for _, item := range collection.GetItems() {
		values[item.GetID()] = item.GetBlockValue()
	}
	for _, relation := range relations {
		for i, content := range relation.Relation.Contents {
			if value := values[content.BlockID]; nil != value {
				relation.Relation.Contents[i] = value
			}
		}
	}
}
