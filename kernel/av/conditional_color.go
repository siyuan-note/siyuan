// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"fmt"
	"strconv"
)

// ConditionalColorRule 使用单字段筛选条件为条目或该属性设置背景色。
// 空颜色表示默认背景，仍占据匹配优先级；MatchOption 按条目内已选选项的顺序取色。
type ConditionalColorRule struct {
	ID          string       `json:"id"`
	Filter      *ViewFilter  `json:"filter"`
	Target      string       `json:"target"`
	Color       *ValueSelect `json:"color"`
	MatchOption bool         `json:"matchOption"`
}

// ItemConditionalColors 仅包含当前渲染条目的计算结果，不写入数据库。
type ItemConditionalColors struct {
	Background *ValueSelect            `json:"background,omitempty"`
	Properties map[string]*ValueSelect `json:"properties,omitempty"`
}

// EffectiveConditionalColors 以只读方式兼容旧日历的单选取色设置。
// nil 表示尚未设置新规则，显式空数组表示用户已经清空规则，不重新启用旧设置。
func (view *View) EffectiveConditionalColors() []*ConditionalColorRule {
	if nil != view.ConditionalColors {
		return view.ConditionalColors
	}
	if LayoutTypeCalendar == view.LayoutType && nil != view.Calendar && "" != view.Calendar.Settings.ColorKeyID {
		return []*ConditionalColorRule{{ID: view.ID, Target: "item", MatchOption: true,
			Filter: &ViewFilter{Column: view.Calendar.Settings.ColorKeyID, Operator: FilterOperatorIsNotEmpty,
				Value: &Value{Type: KeyTypeSelect}}}}
	}
	return nil
}

func ValidateConditionalColors(rules []*ConditionalColorRule) error {
	if len(rules) > 100 {
		return fmt.Errorf("too many conditional color rules")
	}
	ids := map[string]bool{}
	for _, rule := range rules {
		if nil == rule || "" == rule.ID || ids[rule.ID] || nil == rule.Filter || rule.Filter.IsGroup() ||
			"" == rule.Filter.Column || (rule.Target != "item" && rule.Target != "property") {
			return fmt.Errorf("invalid conditional color rule")
		}
		ids[rule.ID] = true
		switch rule.Filter.Operator {
		case "", FilterOperatorIsEqual, FilterOperatorIsNotEqual, FilterOperatorIsGreater, FilterOperatorIsGreaterOrEqual,
			FilterOperatorIsLess, FilterOperatorIsLessOrEqual, FilterOperatorContains, FilterOperatorDoesNotContain,
			FilterOperatorContainsAnyItem, FilterOperatorDoesNotContainAnyItem, FilterOperatorIsEmpty,
			FilterOperatorIsNotEmpty, FilterOperatorStartsWith, FilterOperatorEndsWith, FilterOperatorIsBetween,
			FilterOperatorIsTrue, FilterOperatorIsFalse:
		default:
			return fmt.Errorf("invalid conditional color operator")
		}
		if nil != rule.Color && "" != rule.Color.Color {
			index, err := strconv.Atoi(rule.Color.Color)
			if nil != err || index < 1 || index > CustomColorMaxIndex {
				return fmt.Errorf("invalid conditional color")
			}
		}
	}
	return nil
}

// CloneConditionalColors 保留未配置与显式清空的区别，并隔离复制视图的可编辑数据。
func CloneConditionalColors(rules []*ConditionalColorRule) []*ConditionalColorRule {
	if nil == rules {
		return nil
	}
	result := make([]*ConditionalColorRule, 0, len(rules))
	for _, rule := range rules {
		if nil == rule {
			continue
		}
		copy := *rule
		filters := CloneFilters([]*ViewFilter{rule.Filter})
		if len(filters) > 0 {
			copy.Filter = filters[0]
		}
		if nil != rule.Color {
			color := *rule.Color
			copy.Color = &color
		}
		result = append(result, &copy)
	}
	return result
}

// RenderConditionalColors 按顺序为尚未着色的目标取色，不修改条目集合或存储字段值。
// 整条目规则命中后终止扫描，保留此前已经匹配的属性色；不同属性可以同时着色。
func RenderConditionalColors(viewable Viewable, view *View, attrView *AttributeView,
	rollupFurtherCollections map[string]*RollupRenderContext, cachedAttrViews map[string]*AttributeView) {
	rules := view.EffectiveConditionalColors()
	if len(rules) == 0 {
		return
	}
	collection := viewable.(Collection)
	indexes := map[string]int{}
	for i, field := range collection.GetFields() {
		indexes[field.GetID()] = i
	}
	for _, item := range collection.GetItems() {
		switch item := item.(type) {
		case *TableRow:
			item.ConditionalColors = nil
		case *GalleryCard:
			item.ConditionalColors = nil
		case *KanbanCard:
			item.ConditionalColors = nil
		}
		colors := &ItemConditionalColors{Properties: map[string]*ValueSelect{}}
		values := item.GetValues()
		for _, rule := range rules {
			if nil == rule || nil == rule.Filter || rule.Filter.IsGroup() || !conditionalColorFilterConfigured(rule.Filter) {
				continue
			}
			index, exists := indexes[rule.Filter.Column]
			if !exists || (rule.Target == "property" && view.LayoutType != LayoutTypeTable) ||
				(rule.Target != "item" && rule.Target != "property") {
				continue
			}
			if rule.Target == "property" && nil != colors.Properties[rule.Filter.Column] {
				continue
			}
			filter := *rule.Filter
			if nil == filter.Value && nil == filter.RelativeDate {
				filter.Value = &Value{Type: collection.GetFields()[index].GetType()}
			}
			if index < len(values) && nil != values[index] && nil != filter.Value &&
				ResolveValueSource(values[index], filter.ValueSource).Type != resolveFilterValueSource(&filter).Value.Type {
				continue
			}
			if !evalLeaf(&filter, values, index, attrView, item.GetID(), rollupFurtherCollections, cachedAttrViews) {
				continue
			}
			color := rule.Color
			if rule.MatchOption {
				if index >= len(values) || nil == values[index] ||
					(values[index].Type != KeyTypeSelect && values[index].Type != KeyTypeMSelect) ||
					filter.ValueSource == ValueSourceRendered || len(values[index].MSelect) == 0 || nil == values[index].MSelect[0] {
					continue
				}
				color = values[index].MSelect[0]
			}
			if nil == color {
				color = &ValueSelect{}
			}
			// 只返回颜色引用，避免把筛选值或选项内容混入派生结果。
			resolved := &ValueSelect{Color: color.Color, ResolvedColor: color.ResolvedColor}
			if rule.Target == "property" {
				colors.Properties[rule.Filter.Column] = resolved
			} else {
				colors.Background = resolved
				break
			}
		}
		if nil != colors.Background || len(colors.Properties) > 0 {
			switch item := item.(type) {
			case *TableRow:
				item.ConditionalColors = colors
			case *GalleryCard:
				item.ConditionalColors = colors
			case *KanbanCard:
				item.ConditionalColors = colors
			}
		}
	}
}

func conditionalColorFilterConfigured(filter *ViewFilter) bool {
	if "" == filter.Operator {
		return false
	}
	switch filter.Operator {
	case FilterOperatorIsEmpty, FilterOperatorIsNotEmpty, FilterOperatorIsTrue, FilterOperatorIsFalse:
		return true
	default:
		return filter.IsValid() || nil != filter.RelativeDate
	}
}
