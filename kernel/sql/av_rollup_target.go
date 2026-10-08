package sql

import (
	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
)

type rollupTargetID struct {
	avID  string
	keyID string
}

// renderRollupTarget 按目标字段计算完整条目集合，不受目标视图的布局、分组和分页影响。
func renderRollupTarget(target *av.AttributeView, key *av.Key, depth *int,
	cachedAttrViews map[string]*av.AttributeView, context *AttributeViewRenderContext) av.Collection {
	// 循环依赖或深度受限时返回空集合，禁止读取持久化的过期汇总内容。
	empty := &av.Table{}
	if nil == target || nil == key || nil == key.Rollup || 7 < *depth {
		return empty
	}
	id := rollupTargetID{avID: target.ID, keyID: key.ID}
	if context.renderingRollupTargets[id] {
		return empty
	}
	if nil == context.renderingRollupTargets {
		context.renderingRollupTargets = map[rollupTargetID]bool{}
	}
	context.renderingRollupTargets[id] = true
	defer delete(context.renderingRollupTargets, id)

	// 独立副本避免自关联和菱形依赖修改外层正在计算的值。
	cloned := *target
	cloned.KeyValues = nil
	cloned.RenderedViewables = nil
	view := &av.View{ID: ast.NewNodeID(), LayoutType: av.LayoutTypeTable, Table: av.NewLayoutTable()}
	for _, keyValues := range target.KeyValues {
		if nil == keyValues || nil == keyValues.Key {
			continue
		}
		copiedKey := *keyValues.Key
		copiedKey.RenderTemplate = ""
		copied := &av.KeyValues{Key: &copiedKey}
		for _, value := range keyValues.Values {
			if nil != value {
				clonedValue := av.CloneStoredValue(value).Clone()
				if copiedKey.ID == key.ID {
					// 关联条目或目标字段已删除时，不能保留上次渲染的汇总内容。
					clonedValue.Rollup = &av.ValueRollup{}
				}
				copied.Values = append(copied.Values, clonedValue)
			}
		}
		cloned.KeyValues = append(cloned.KeyValues, copied)
		if av.KeyTypeBlock == copiedKey.Type || copiedKey.ID == key.ID || copiedKey.ID == key.Rollup.RelationKeyID {
			view.Table.Columns = append(view.Table.Columns, &av.ViewTableColumn{BaseField: &av.BaseField{ID: copiedKey.ID}})
		}
	}
	cache := make(map[string]*av.AttributeView, len(cachedAttrViews)+1)
	for avID, attrView := range cachedAttrViews {
		cache[avID] = attrView
	}
	cache[target.ID] = &cloned

	// 每条依赖分支使用独立深度，兄弟字段不会消耗彼此的递归预算。
	nestedDepth := *depth
	viewable := renderView(&cloned, view, "", &nestedDepth, cache, false, false, context)
	if nil == viewable {
		return empty
	}
	return viewable.(av.Collection)
}
