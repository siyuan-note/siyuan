// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package av

import (
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/goccy/go-json"
)

const (
	CustomColorMinIndex = 15
	CustomColorMaxIndex = 78
	MaxCustomColors     = CustomColorMaxIndex - CustomColorMinIndex + 1
)

var attributeViewColorPattern = regexp.MustCompile(`^#[0-9a-f]{6}$`)

// AttributeViewColorTheme 描述一种主题模式下的数据库选项颜色。
type AttributeViewColorTheme struct {
	Color           string `json:"color"`
	BackgroundColor string `json:"backgroundColor"`
}

// AttributeViewColor 描述数据库选项在明暗主题下的颜色。
type AttributeViewColor struct {
	Light AttributeViewColorTheme `json:"light"`
	Dark  AttributeViewColorTheme `json:"dark"`
}

// AttributeViewCustomColor 描述数据库级自定义选项颜色及其稳定编号。
type AttributeViewCustomColor struct {
	Index int `json:"index"`
	AttributeViewColor
}

// UnmarshalJSON 忽略外部输入中的派生颜色，派生颜色只能由内核根据数据库调色板生成。
func (option *SelectOption) UnmarshalJSON(data []byte) error {
	decoded := struct {
		Name  string `json:"name"`
		Color string `json:"color"`
		Desc  string `json:"desc"`
	}{}
	if err := json.Unmarshal(data, &decoded); nil != err {
		return err
	}
	option.Name = decoded.Name
	option.Color = decoded.Color
	option.Desc = decoded.Desc
	option.ResolvedColor = nil
	return nil
}

// UnmarshalJSON 忽略外部输入中的派生颜色，派生颜色只能由内核根据数据库调色板生成。
func (value *ValueSelect) UnmarshalJSON(data []byte) error {
	decoded := struct {
		Content string `json:"content"`
		Color   string `json:"color"`
	}{}
	if err := json.Unmarshal(data, &decoded); nil != err {
		return err
	}
	value.Content = decoded.Content
	value.Color = decoded.Color
	value.ResolvedColor = nil
	return nil
}

// NormalizeAttributeViewCustomColors 校验并规范化数据库自定义颜色。
func NormalizeAttributeViewCustomColors(colors []*AttributeViewCustomColor, strict bool) (ret []*AttributeViewCustomColor, err error) {
	if strict && MaxCustomColors < len(colors) {
		return nil, fmt.Errorf("attribute view custom colors count exceeds the %d item limit", MaxCustomColors)
	}

	indexes := map[int]struct{}{}
	for _, color := range colors {
		normalized, normalizeErr := normalizeAttributeViewCustomColor(color)
		if nil != normalizeErr {
			if strict {
				return nil, normalizeErr
			}
			continue
		}
		if _, ok := indexes[normalized.Index]; ok {
			if strict {
				return nil, fmt.Errorf("duplicated attribute view custom color index [%d]", normalized.Index)
			}
			continue
		}
		indexes[normalized.Index] = struct{}{}
		ret = append(ret, normalized)
	}

	sort.Slice(ret, func(i, j int) bool {
		return ret[i].Index < ret[j].Index
	})
	if nil == ret {
		ret = []*AttributeViewCustomColor{}
	}
	return
}

func normalizeAttributeViewCustomColor(color *AttributeViewCustomColor) (ret *AttributeViewCustomColor, err error) {
	if nil == color {
		return nil, errors.New("attribute view custom color must not be null")
	}
	if color.Index < CustomColorMinIndex || CustomColorMaxIndex < color.Index {
		return nil, fmt.Errorf("attribute view custom color index [%d] is out of range [%d, %d]",
			color.Index, CustomColorMinIndex, CustomColorMaxIndex)
	}

	ret = &AttributeViewCustomColor{Index: color.Index}
	ret.Light, err = normalizeAttributeViewColorTheme(color.Light)
	if nil != err {
		return nil, fmt.Errorf("invalid light theme of attribute view custom color [%d]: %w", color.Index, err)
	}
	ret.Dark, err = normalizeAttributeViewColorTheme(color.Dark)
	if nil != err {
		return nil, fmt.Errorf("invalid dark theme of attribute view custom color [%d]: %w", color.Index, err)
	}
	return
}

func normalizeAttributeViewColorTheme(theme AttributeViewColorTheme) (ret AttributeViewColorTheme, err error) {
	ret.Color = strings.ToLower(strings.TrimSpace(theme.Color))
	ret.BackgroundColor = strings.ToLower(strings.TrimSpace(theme.BackgroundColor))
	if !attributeViewColorPattern.MatchString(ret.Color) {
		return AttributeViewColorTheme{}, fmt.Errorf("invalid foreground color [%s]", theme.Color)
	}
	if !attributeViewColorPattern.MatchString(ret.BackgroundColor) {
		return AttributeViewColorTheme{}, fmt.Errorf("invalid background color [%s]", theme.BackgroundColor)
	}
	return
}

// NormalizeCustomColors 校验并替换数据库自定义颜色。
func (av *AttributeView) NormalizeCustomColors(strict bool) error {
	if nil == av {
		return errors.New("attribute view must not be nil")
	}
	colors, err := NormalizeAttributeViewCustomColors(av.CustomColors, strict)
	if nil != err {
		return err
	}
	av.CustomColors = colors
	return nil
}

// NextCustomColorIndex 返回最小的可用自定义颜色编号，没有可用编号时返回 0。
func (av *AttributeView) NextCustomColorIndex() int {
	used := map[int]struct{}{}
	if nil != av {
		for _, color := range av.CustomColors {
			if nil != color {
				used[color.Index] = struct{}{}
			}
		}
	}
	for index := CustomColorMinIndex; index <= CustomColorMaxIndex; index++ {
		if _, ok := used[index]; !ok {
			return index
		}
	}
	return 0
}

// ResolveColor 根据自定义颜色编号返回经过校验的明暗主题颜色。
func (av *AttributeView) ResolveColor(color string) *AttributeViewColor {
	index, err := strconv.Atoi(strings.TrimSpace(color))
	if nil != err || index < CustomColorMinIndex || CustomColorMaxIndex < index || nil == av {
		return nil
	}
	for _, customColor := range av.CustomColors {
		if nil == customColor || customColor.Index != index {
			continue
		}
		normalized, normalizeErr := normalizeAttributeViewCustomColor(customColor)
		if nil != normalizeErr {
			return nil
		}
		return &AttributeViewColor{Light: normalized.Light, Dark: normalized.Dark}
	}
	return nil
}

// FilterColorValue 校验数据库上下文中的选项颜色编号。
func (av *AttributeView) FilterColorValue(color string) string {
	if filtered := FilterColorValue(color); "" != filtered {
		return filtered
	}
	color = strings.TrimSpace(color)
	index, err := strconv.Atoi(color)
	if nil != err || nil == av.ResolveColor(color) {
		return ""
	}
	return strconv.Itoa(index)
}

// ResolveDirectColors 为本数据库直接持有的选项和值填充派生颜色。
func (av *AttributeView) ResolveDirectColors() {
	if nil == av {
		return
	}
	for _, keyValues := range av.KeyValues {
		if nil == keyValues {
			continue
		}
		if nil != keyValues.Key {
			for _, option := range keyValues.Key.Options {
				if nil != option {
					option.ResolvedColor = av.ResolveColor(option.Color)
				}
			}
		}
		for _, value := range keyValues.Values {
			resolveValueSelectColors(value, av)
		}
	}
	for _, view := range av.Views {
		av.resolveDirectViewGroupColors(view)
	}
}

// ApplyRelatedCustomColorRenderContext 为关联数据库应用当前只读渲染请求中的历史调色板。
func (av *AttributeView) ApplyRelatedCustomColorRenderContext(target *AttributeView) {
	if nil == av || nil == target || nil == av.CustomColorRenderContext ||
		nil == av.CustomColorRenderContext.ResolveRelatedCustomColors {
		return
	}

	context := av.CustomColorRenderContext
	if target.CustomColorRenderContext == context {
		return
	}
	target.CustomColorRenderContext = context
	colors, found := context.ResolveRelatedCustomColors(target.ID)
	if !found {
		colors = []*AttributeViewCustomColor{}
	}
	target.CustomColors, _ = NormalizeAttributeViewCustomColors(colors, false)
	target.ResolveDirectColors()
}

func (av *AttributeView) resolveDirectViewGroupColors(view *View) {
	if nil == view {
		return
	}
	if nil != view.GroupKey {
		if key, err := av.GetKey(view.GroupKey.ID); nil == err &&
			(KeyTypeSelect == key.Type || KeyTypeMSelect == key.Type) {
			for _, option := range view.GroupKey.Options {
				if nil != option {
					option.ResolvedColor = av.ResolveColor(option.Color)
				}
			}
			resolveValueSelectColors(view.GroupVal, av)
		}
	}
	for _, group := range view.Groups {
		av.resolveDirectViewGroupColors(group)
	}
}

// ResolveValueSelectColors 为数据库上下文中的直接选择值填充派生颜色。
func (av *AttributeView) ResolveValueSelectColors(value *Value) {
	resolveValueSelectColors(value, av)
}

func resolveValueSelectColors(value *Value, av *AttributeView) {
	if nil == value {
		return
	}
	for _, selection := range value.MSelect {
		if nil != selection {
			selection.ResolvedColor = av.ResolveColor(selection.Color)
		}
	}
}

type resolvedColorBinding struct {
	option    *SelectOption
	selection *ValueSelect
	color     *AttributeViewColor
}

// suspendResolvedColors 在序列化持久化数据期间临时清除所有派生颜色。
func (av *AttributeView) suspendResolvedColors() (restore func()) {
	var bindings []resolvedColorBinding
	if nil != av {
		av.visitPersistedColorHolders(func(option *SelectOption) {
			if nil != option.ResolvedColor {
				bindings = append(bindings, resolvedColorBinding{option: option, color: option.ResolvedColor})
				option.ResolvedColor = nil
			}
		}, func(selection *ValueSelect) {
			if nil != selection.ResolvedColor {
				bindings = append(bindings, resolvedColorBinding{selection: selection, color: selection.ResolvedColor})
				selection.ResolvedColor = nil
			}
		})
	}
	return func() {
		for _, binding := range bindings {
			if nil != binding.option {
				binding.option.ResolvedColor = binding.color
			} else if nil != binding.selection {
				binding.selection.ResolvedColor = binding.color
			}
		}
		av.ResolveDirectColors()
	}
}

func (av *AttributeView) visitPersistedColorHolders(visitOption func(*SelectOption), visitSelection func(*ValueSelect)) {
	for _, keyValues := range av.KeyValues {
		if nil == keyValues {
			continue
		}
		visitKeyColorHolders(keyValues.Key, visitOption, visitSelection)
		for _, value := range keyValues.Values {
			walkValueSelects(value, visitSelection)
		}
	}
	for _, view := range av.Views {
		visitViewColorHolders(view, visitOption, visitSelection)
	}
	for _, itemTemplate := range av.NewItemTemplates {
		if nil == itemTemplate {
			continue
		}
		for _, fieldValue := range itemTemplate.FieldValues {
			if nil != fieldValue {
				walkValueSelects(fieldValue.Value, visitSelection)
			}
		}
	}
}

func visitKeyColorHolders(key *Key, visitOption func(*SelectOption), visitSelection func(*ValueSelect)) {
	if nil == key {
		return
	}
	for _, option := range key.Options {
		if nil != option {
			visitOption(option)
		}
	}
	if nil != key.Relation {
		visitFilterColorHolders(key.Relation.CandidateFilters, visitSelection)
	}
	if nil != key.Rollup {
		visitFilterColorHolders(key.Rollup.Filters, visitSelection)
		if nil != key.Rollup.Calc {
			walkValueSelects(key.Rollup.Calc.Result, visitSelection)
		}
	}
}

func visitFilterColorHolders(filters []*ViewFilter, visitSelection func(*ValueSelect)) {
	for _, filter := range filters {
		if nil == filter {
			continue
		}
		walkValueSelects(filter.Value, visitSelection)
		visitFilterColorHolders(filter.Filters, visitSelection)
	}
}

func visitViewColorHolders(view *View, visitOption func(*SelectOption), visitSelection func(*ValueSelect)) {
	if nil == view {
		return
	}
	visitKeyColorHolders(view.GroupKey, visitOption, visitSelection)
	walkValueSelects(view.GroupVal, visitSelection)
	visitFilterColorHolders(view.Filters, visitSelection)
	if nil != view.GroupCalc && nil != view.GroupCalc.FieldCalc {
		walkValueSelects(view.GroupCalc.FieldCalc.Result, visitSelection)
	}
	if nil != view.Table {
		if nil != view.Table.BaseLayout {
			visitFilterColorHolders(view.Table.Filters, visitSelection)
		}
		for _, column := range view.Table.Columns {
			if nil == column {
				continue
			}
			visitBaseFieldColorHolders(column.BaseField, visitSelection)
			if nil != column.Calc {
				walkValueSelects(column.Calc.Result, visitSelection)
			}
		}
	}
	if nil != view.Gallery {
		if nil != view.Gallery.BaseLayout {
			visitFilterColorHolders(view.Gallery.Filters, visitSelection)
		}
		for _, field := range view.Gallery.CardFields {
			if nil != field {
				visitBaseFieldColorHolders(field.BaseField, visitSelection)
			}
		}
	}
	if nil != view.Kanban {
		if nil != view.Kanban.BaseLayout {
			visitFilterColorHolders(view.Kanban.Filters, visitSelection)
		}
		for _, field := range view.Kanban.Fields {
			if nil != field {
				visitBaseFieldColorHolders(field.BaseField, visitSelection)
			}
		}
	}
	for _, group := range view.Groups {
		visitViewColorHolders(group, visitOption, visitSelection)
	}
}

func visitBaseFieldColorHolders(field *BaseField, visitSelection func(*ValueSelect)) {
	if nil != field && nil != field.Calc {
		walkValueSelects(field.Calc.Result, visitSelection)
	}
}

func walkValueSelects(value *Value, fn func(*ValueSelect)) {
	if nil == value {
		return
	}
	for _, selection := range value.MSelect {
		if nil != selection {
			fn(selection)
		}
	}
	if nil != value.Relation {
		for _, content := range value.Relation.Contents {
			walkValueSelects(content, fn)
		}
	}
	if nil != value.Rollup {
		for _, content := range value.Rollup.Contents {
			walkValueSelects(content, fn)
		}
	}
}

// copyValueResolvedColors 让内核内部值克隆保留已经可信解析的派生颜色。
func copyValueResolvedColors(cloned, original *Value) {
	if nil == cloned || nil == original {
		return
	}
	for i, selection := range original.MSelect {
		if len(cloned.MSelect) <= i || nil == cloned.MSelect[i] || nil == selection || nil == selection.ResolvedColor {
			continue
		}
		resolved := *selection.ResolvedColor
		cloned.MSelect[i].ResolvedColor = &resolved
	}
	if nil != cloned.Relation && nil != original.Relation {
		for i, content := range original.Relation.Contents {
			if len(cloned.Relation.Contents) <= i {
				break
			}
			copyValueResolvedColors(cloned.Relation.Contents[i], content)
		}
	}
	if nil != cloned.Rollup && nil != original.Rollup {
		for i, content := range original.Rollup.Contents {
			if len(cloned.Rollup.Contents) <= i {
				break
			}
			copyValueResolvedColors(cloned.Rollup.Contents[i], content)
		}
	}
}

// UsesCustomColor 判断数据库持久化数据是否仍引用指定的自定义颜色编号。
func (av *AttributeView) UsesCustomColor(index int) bool {
	if nil == av || index < CustomColorMinIndex || CustomColorMaxIndex < index {
		return false
	}
	_, ret := av.usedCustomColorIndexSet()[index]
	return ret
}

func (av *AttributeView) usedCustomColorIndexSet() map[int]struct{} {
	ret := map[int]struct{}{}
	if nil == av {
		return ret
	}
	addColor := func(color string) {
		index, err := strconv.Atoi(strings.TrimSpace(color))
		if nil == err && CustomColorMinIndex <= index && index <= CustomColorMaxIndex {
			ret[index] = struct{}{}
		}
	}
	for _, keyValues := range av.KeyValues {
		if nil == keyValues {
			continue
		}
		collectKeyCustomColorIndexes(keyValues.Key, addColor)
		for _, value := range keyValues.Values {
			collectValueCustomColorIndexes(value, addColor)
		}
	}
	for _, view := range av.Views {
		collectViewCustomColorIndexes(view, av, addColor)
	}
	for _, itemTemplate := range av.NewItemTemplates {
		if nil == itemTemplate {
			continue
		}
		for _, fieldValue := range itemTemplate.FieldValues {
			if nil != fieldValue {
				collectValueCustomColorIndexes(fieldValue.Value, addColor)
			}
		}
	}
	return ret
}

// UsedCustomColorIndexes 返回数据库中仍被引用的自定义颜色编号。
func (av *AttributeView) UsedCustomColorIndexes() (ret []int) {
	used := av.usedCustomColorIndexSet()
	for index := CustomColorMinIndex; index <= CustomColorMaxIndex; index++ {
		if _, ok := used[index]; ok {
			ret = append(ret, index)
		}
	}
	if nil == ret {
		ret = []int{}
	}
	return
}

func collectKeyCustomColorIndexes(key *Key, addColor func(string)) {
	if nil == key {
		return
	}
	for _, option := range key.Options {
		if nil != option {
			addColor(option.Color)
		}
	}
}

func collectFilterCustomColorIndexes(filters []*ViewFilter, attrView *AttributeView, addColor func(string)) {
	for _, filter := range filters {
		if nil == filter {
			continue
		}
		if key, err := attrView.GetKey(filter.Column); nil == err &&
			(KeyTypeSelect == key.Type || KeyTypeMSelect == key.Type) {
			collectValueCustomColorIndexes(filter.Value, addColor)
		}
		collectFilterCustomColorIndexes(filter.Filters, attrView, addColor)
	}
}

func collectValueCustomColorIndexes(value *Value, addColor func(string)) {
	if nil == value {
		return
	}
	for _, selection := range value.MSelect {
		if nil != selection {
			addColor(selection.Color)
		}
	}
}

func collectViewCustomColorIndexes(view *View, attrView *AttributeView, addColor func(string)) {
	if nil == view {
		return
	}
	collectKeyCustomColorIndexes(view.GroupKey, addColor)
	collectFilterCustomColorIndexes(view.Filters, attrView, addColor)
	collectValueCustomColorIndexes(view.GroupVal, addColor)
	if nil != view.Table {
		if nil != view.Table.BaseLayout {
			collectFilterCustomColorIndexes(view.Table.Filters, attrView, addColor)
		}
	}
	if nil != view.Gallery {
		if nil != view.Gallery.BaseLayout {
			collectFilterCustomColorIndexes(view.Gallery.Filters, attrView, addColor)
		}
	}
	if nil != view.Kanban {
		if nil != view.Kanban.BaseLayout {
			collectFilterCustomColorIndexes(view.Kanban.Filters, attrView, addColor)
		}
	}
	for _, group := range view.Groups {
		collectViewCustomColorIndexes(group, attrView, addColor)
	}
}
