// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"encoding/json"
	"fmt"
	"text/template"
	"text/template/parse"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
)

func newAttributeViewMapLayout(attrView *av.AttributeView, fieldIDs []string) *av.LayoutMap {
	return &av.LayoutMap{
		LayoutTable: newAttributeViewListLayout(attrView, fieldIDs),
	}
}

func (filter *attributeViewPublishAccessFilter) filterMapTemplateValue(attrView *av.AttributeView, itemID string, baseValue *av.BaseValue) {
	if nil == baseValue || nil == baseValue.Value {
		return
	}
	var key *av.Key
	if nil != attrView {
		key, _ = attrView.GetKey(baseValue.Value.KeyID)
	}
	value := baseValue.Value
	if av.KeyTypeTemplate == value.Type && nil != value.Template &&
		(!filter.checkKeyDependencies(attrView, key, itemID, map[string]bool{}) ||
			!filter.checkMapTemplateDependencySyntax(attrView, key, itemID, map[string]bool{})) {
		// 地图模板在发布权限过滤前生成，私有依赖的结果只能在响应副本中清空。
		value = cloneAttributeViewSensitiveValue(value)
		value.Template = &av.ValueTemplate{}
		value.RenderedContent = ""
	}
	if "" != value.RenderedContent {
		var displayKey *av.Key
		if nil != key {
			clonedKey := *key
			clonedKey.Type = av.KeyTypeText // 显示结果必须按 RenderTemplate 而非模板字段的 Template 分析。
			displayKey = &clonedKey
		}
		if !filter.checkRenderTemplateDependencies(attrView, displayKey, itemID) ||
			!filter.checkMapTemplateDependencySyntax(attrView, displayKey, itemID, map[string]bool{}) {
			// 显示模板使用相同的证明边界，但不得清空原始标量、坐标或其他字段值。
			value = cloneAttributeViewSensitiveValue(value)
			value.RenderedContent = ""
		}
	}
	baseValue.Value = value
}

func (filter *attributeViewPublishAccessFilter) checkMapTemplateDependencySyntax(attrView *av.AttributeView, key *av.Key,
	itemID string, visited map[string]bool) bool {
	if nil == attrView || nil == key {
		return false
	}
	visitKey := attrView.ID + "\x00" + key.ID + "\x00" + itemID
	if visited[visitKey] {
		return true
	}
	visited[visitKey] = true
	templateContent := key.RenderTemplate
	if av.KeyTypeTemplate == key.Type {
		templateContent = key.Template
	}
	if "" != templateContent {
		if !mapTemplateDependencySyntaxIsSupported(templateContent) {
			return false
		}
		for _, dependency := range sql.GetTemplateKeyRelevantKeys(attrView, key) {
			if dependency.ID != key.ID &&
				(!filter.checkKeyDependencies(attrView, dependency, itemID, map[string]bool{}) ||
					!filter.checkMapTemplateDependencySyntax(attrView, dependency, itemID, visited)) {
				return false
			}
		}
	}
	if av.KeyTypeRollup == key.Type {
		targetAttrView, targetKey, targetItemIDs, ok := filter.getRollupTarget(attrView, key, itemID)
		if ok {
			for _, targetItemID := range targetItemIDs {
				if !filter.checkMapTemplateDependencySyntax(targetAttrView, targetKey, targetItemID, visited) {
					return false
				}
			}
		}
	}
	return true
}

// 仅地图响应采用保守检查；共享依赖提取器尚未覆盖的语法不能用于证明模板可公开。
func mapTemplateDependencySyntaxIsSupported(content string) bool {
	funcs := filesys.BuiltInTemplateFuncs()
	sql.SQLTemplateFuncs(&funcs)
	tpl, err := template.New("").Delims(".action{", "}").Funcs(funcs).Parse(content)
	if nil != err {
		return false
	}
	var supported func(parse.Node) bool
	supported = func(node parse.Node) bool {
		switch n := node.(type) {
		case *parse.ListNode:
			for _, child := range n.Nodes {
				if !supported(child) {
					return false
				}
			}
		case *parse.ActionNode:
			return supported(n.Pipe)
		case *parse.PipeNode:
			if 0 < len(n.Decl) {
				return false
			}
			for _, command := range n.Cmds {
				if !supported(command) {
					return false
				}
			}
		case *parse.CommandNode:
			staticIndex := false
			if 3 <= len(n.Args) && "index" == n.Args[0].String() {
				_, staticIndex = n.Args[2].(*parse.StringNode)
			}
			if 2 <= len(n.Args) && "index" == n.Args[0].String() {
				if field, ok := n.Args[1].(*parse.FieldNode); ok && 0 < len(field.Ident) &&
					("id_mod" == field.Ident[0] || "id_mod_raw" == field.Ident[0]) &&
					(1 != len(field.Ident) || !staticIndex) {
					return false
				}
			}
			for i, arg := range n.Args {
				if 1 == i && staticIndex && (".id_mod" == arg.String() || ".id_mod_raw" == arg.String()) {
					continue
				}
				if !supported(arg) {
					return false
				}
			}
		case *parse.FieldNode:
			if 1 == len(n.Ident) && ("id_mod" == n.Ident[0] || "id_mod_raw" == n.Ident[0]) {
				return false
			}
		case *parse.IdentifierNode:
			switch n.Ident {
			case "index", "len", "printf", "print", "println", "eq", "ne", "lt", "le", "gt", "ge", "and", "or", "not", "html", "js", "urlquery":
			default:
				return false
			}
		case *parse.TextNode, *parse.StringNode, *parse.NumberNode, *parse.BoolNode, *parse.NilNode:
		default:
			// 分支、链式表达式、变量别名和整行访问均可能隐藏共享提取器未识别的依赖。
			return false
		}
		return true
	}
	return supported(tpl.Tree.Root)
}

func shouldPushAttributeViewTemplateErrors(layout av.LayoutType, writable bool) bool {
	// 公开地图的模板先于权限过滤执行，不广播其中可能包含私有条目内容的错误。
	return layout != av.LayoutTypeMap || writable
}

func (tx *Transaction) doSetAttrViewMap(operation *Operation) *TxErr {
	if err := setAttrViewMap(operation); err != nil {
		return &TxErr{code: TxErrHandleAttributeView, id: operation.AvID, msg: err.Error()}
	}
	return nil
}

func setAttrViewMap(operation *Operation) error {
	if operation.Data == nil {
		return fmt.Errorf("map settings are required")
	}
	data, err := json.Marshal(operation.Data)
	if err != nil {
		return err
	}
	// 设置只包含位置字段，拒绝其他内容进入数据库事务。
	var settings struct {
		LocationKeyID *string `json:"locationKeyID"`
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&settings); err != nil {
		return err
	}
	if settings.LocationKeyID == nil {
		return fmt.Errorf("complete map settings are required")
	}
	next := av.MapSettings{LocationKeyID: *settings.LocationKeyID}
	if err = next.Validate(); err != nil {
		return err
	}
	attrView, err := av.ParseAttributeView(operation.AvID)
	if err != nil {
		return err
	}
	view, err := getAttrViewOperationView(attrView, operation)
	if err != nil {
		return err
	}
	if view.LayoutType != av.LayoutTypeMap || view.Map == nil {
		return av.ErrWrongLayoutType
	}
	view.Map.Settings = next
	return av.SaveAttributeView(attrView)
}

// FilterAttributeViewMapForPublish 在完整结果上过滤访问权限，再计算可访问总数和分页定位。
// filter 同时负责行权限和关联字段脱敏，不把未授权条目的数量、位置或统计结果带入响应。
func FilterAttributeViewMapForPublish(mapped *av.Map, page, pageSize int, target *AttributeViewRenderTarget,
	filter func(av.Viewable) av.Viewable) (av.Viewable, *AttributeViewRenderTarget) {
	if mapped.RowsBeforePagination != nil {
		mapped.Rows = mapped.RowsBeforePagination
	}
	mapped.RowsBeforePagination = nil
	filtered := filter(mapped)
	mapped, ok := filtered.(*av.Map)
	if !ok {
		return filtered, nil
	}
	clearPublishedAttributeViewMapCalculations(mapped)
	mapped.RowCount = len(mapped.Rows)
	index := findAttributeViewTargetIndex(targetItemID(target), len(mapped.Rows), func(index int) string {
		return mapped.Rows[index].ID
	})
	start, end := getAttributeViewRenderRange(page, pageSize, index, mapped.PageSize, len(mapped.Rows))
	mapped.Rows = mapped.Rows[start:end]
	if target == nil {
		return mapped, nil
	}
	visibleTarget := &AttributeViewRenderTarget{Status: "itemNotFound", ItemID: target.ItemID}
	if index >= 0 {
		setAttributeViewRenderTarget(visibleTarget, "", index, start, mapped.PageSize)
	}
	return mapped, visibleTarget
}

// 发布地图不返回权限过滤前生成的聚合和条件颜色，避免泄露受限行或其关联内容。
func clearPublishedAttributeViewMapCalculations(mapped *av.Map) {
	for _, column := range mapped.Columns {
		if column != nil && column.BaseInstanceField != nil {
			column.Calc = nil
		}
	}
	if mapped.BaseInstance != nil {
		mapped.GroupCalc = nil
	}
	for _, row := range mapped.Rows {
		if row != nil {
			row.ConditionalColors = nil
		}
	}
}
