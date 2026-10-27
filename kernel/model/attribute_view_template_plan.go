// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"strings"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/sql"
)

type attributeViewTemplatePlan struct {
	required map[string]bool
	deferred map[string]bool
}

func planAttributeViewTemplates(attrView *av.AttributeView, view *av.View, query string, ignoreRows bool) *attributeViewTemplatePlan {
	if attrView == nil || view == nil || ignoreRows {
		return nil
	}
	keys := map[string]*av.Key{}
	for _, values := range attrView.KeyValues {
		if values != nil && values.Key != nil && (values.Key.Type == av.KeyTypeTemplate || strings.TrimSpace(values.Key.RenderTemplate) != "") {
			keys[values.Key.ID] = values.Key
		}
	}
	if len(keys) == 0 {
		return nil
	}
	plan := &attributeViewTemplatePlan{required: map[string]bool{}, deferred: map[string]bool{}}
	if shouldDeferAttributeViewTemplateValues(attrView, view, query, ignoreRows) {
		for id := range keys {
			plan.deferred[id] = true
		}
		return plan
	}
	if strings.TrimSpace(query) != "" || view.IsGroupView() {
		return nil
	}
	switch view.LayoutType {
	case av.LayoutTypeTable, av.LayoutTypeList, av.LayoutTypeGallery:
	default:
		return nil
	}
	ordered, resolved := sql.GetTemplateKeysByResolutionOrder(attrView)
	if !resolved {
		return nil
	}
	positions := map[string]int{}
	for i, key := range ordered {
		positions[key.ID] = i
	}
	dependencies := map[string][]*av.Key{}
	for id, key := range keys {
		values, known := sql.StaticTemplateKeyDependencies(attrView, key)
		if !known {
			return nil
		}
		for _, dependency := range values {
			if dependency.ID != id && keys[dependency.ID] != nil && positions[dependency.ID] > positions[id] {
				// 不提前暴露完整求值顺序中尚未生成的显示结果。
				return nil
			}
		}
		dependencies[id] = values
	}
	require := func(id string, rendered bool) {
		if key := keys[id]; key != nil && (key.Type == av.KeyTypeTemplate || rendered) {
			plan.required[id] = true
		}
	}
	var filters func([]*av.ViewFilter)
	filters = func(values []*av.ViewFilter) {
		for _, filter := range values {
			if filter == nil {
				continue
			}
			if filter.IsGroup() {
				filters(filter.Filters)
			} else {
				require(filter.Column, filter.ValueSource == av.ValueSourceRendered)
			}
		}
	}
	filters(view.Filters)
	for _, sort := range view.Sorts {
		if sort != nil {
			require(sort.Column, sort.ValueSource == av.ValueSourceRendered)
		}
	}
	for _, rule := range view.EffectiveConditionalColors() {
		if rule != nil {
			filters([]*av.ViewFilter{rule.Filter})
		}
	}
	if view.GroupCalc != nil {
		require(view.GroupCalc.Field, true)
	}
	calc := func(id string, value *av.FieldCalc) {
		if value != nil && value.Operator != av.CalcOperatorNone {
			require(id, true)
		}
	}
	if view.LayoutType == av.LayoutTypeGallery {
		for _, field := range view.Gallery.CardFields {
			if field != nil && field.BaseField != nil {
				calc(field.ID, field.Calc)
			}
		}
	} else {
		for _, field := range view.GetTableLayout().Columns {
			if field != nil && field.BaseField != nil {
				calc(field.ID, field.Calc)
			}
		}
	}
	var pending []string
	for id := range plan.required {
		pending = append(pending, id)
	}
	for len(pending) > 0 {
		id := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		for _, dependency := range dependencies[id] {
			if keys[dependency.ID] != nil && !plan.required[dependency.ID] {
				plan.required[dependency.ID] = true
				pending = append(pending, dependency.ID)
			}
		}
	}
	for id := range keys {
		if !plan.required[id] {
			plan.deferred[id] = true
		}
	}
	if len(plan.deferred) == 0 {
		return nil
	}
	return plan
}
