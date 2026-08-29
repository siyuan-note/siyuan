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

type renderedContentBinding struct {
	value   *Value
	content string
}

// CloneStoredValue 复制字段存储值，并递归剥离运行时显示模板结果。
func CloneStoredValue(value *Value) (ret *Value) {
	if nil == value {
		return
	}
	cloned := *value
	cloned.RenderedContent = ""
	ret = &cloned
	if nil != value.Relation {
		relation := *value.Relation
		relation.Contents = cloneStoredValues(value.Relation.Contents)
		ret.Relation = &relation
	}
	if nil != value.Rollup {
		rollup := *value.Rollup
		rollup.Contents = cloneStoredValues(value.Rollup.Contents)
		ret.Rollup = &rollup
	}
	return
}

func cloneStoredValues(values []*Value) (ret []*Value) {
	if nil == values {
		return
	}
	ret = make([]*Value, 0, len(values))
	for _, value := range values {
		ret = append(ret, CloneStoredValue(value))
	}
	return
}

// suspendRenderedContents 在序列化属性视图期间剥离运行时显示模板结果，并在序列化后恢复。
func (av *AttributeView) suspendRenderedContents() (restore func()) {
	var bindings []renderedContentBinding
	if nil != av {
		av.visitPersistedValues(func(value *Value) {
			if "" == value.RenderedContent {
				return
			}
			bindings = append(bindings, renderedContentBinding{value: value, content: value.RenderedContent})
			value.RenderedContent = ""
		})
	}
	return func() {
		for _, binding := range bindings {
			binding.value.RenderedContent = binding.content
		}
	}
}

func (av *AttributeView) visitPersistedValues(visit func(*Value)) {
	visited := map[*Value]struct{}{}
	var visitValue func(value *Value)
	visitValue = func(value *Value) {
		if nil == value {
			return
		}
		if _, ok := visited[value]; ok {
			return
		}
		visited[value] = struct{}{}
		visit(value)
		if nil != value.Relation {
			for _, content := range value.Relation.Contents {
				visitValue(content)
			}
		}
		if nil != value.Rollup {
			for _, content := range value.Rollup.Contents {
				visitValue(content)
			}
		}
	}

	for _, keyValues := range av.KeyValues {
		if nil == keyValues {
			continue
		}
		visitKeyValues(keyValues.Key, visitValue)
		for _, value := range keyValues.Values {
			visitValue(value)
		}
	}
	for _, view := range av.Views {
		visitViewValues(view, visitValue)
	}
	for _, itemTemplate := range av.NewItemTemplates {
		if nil == itemTemplate {
			continue
		}
		for _, fieldValue := range itemTemplate.FieldValues {
			if nil != fieldValue {
				visitValue(fieldValue.Value)
			}
		}
	}
}

func visitKeyValues(key *Key, visitValue func(*Value)) {
	if nil == key {
		return
	}
	if nil != key.Relation {
		visitFilterValues(key.Relation.CandidateFilters, visitValue)
	}
	if nil != key.Rollup {
		visitFilterValues(key.Rollup.Filters, visitValue)
		if nil != key.Rollup.Calc {
			visitValue(key.Rollup.Calc.Result)
		}
	}
}

func visitFilterValues(filters []*ViewFilter, visitValue func(*Value)) {
	for _, filter := range filters {
		if nil == filter {
			continue
		}
		visitValue(filter.Value)
		visitFilterValues(filter.Filters, visitValue)
	}
}

func visitViewValues(view *View, visitValue func(*Value)) {
	if nil == view {
		return
	}
	visitKeyValues(view.GroupKey, visitValue)
	visitValue(view.GroupVal)
	visitFilterValues(view.Filters, visitValue)
	if nil != view.GroupCalc && nil != view.GroupCalc.FieldCalc {
		visitValue(view.GroupCalc.FieldCalc.Result)
	}
	if nil != view.Table {
		if nil != view.Table.BaseLayout {
			visitFilterValues(view.Table.Filters, visitValue)
		}
		for _, column := range view.Table.Columns {
			if nil == column {
				continue
			}
			visitBaseFieldValue(column.BaseField, visitValue)
			if nil != column.Calc {
				visitValue(column.Calc.Result)
			}
		}
	}
	if nil != view.Gallery {
		if nil != view.Gallery.BaseLayout {
			visitFilterValues(view.Gallery.Filters, visitValue)
		}
		for _, field := range view.Gallery.CardFields {
			if nil != field {
				visitBaseFieldValue(field.BaseField, visitValue)
			}
		}
	}
	if nil != view.Kanban {
		if nil != view.Kanban.BaseLayout {
			visitFilterValues(view.Kanban.Filters, visitValue)
		}
		for _, field := range view.Kanban.Fields {
			if nil != field {
				visitBaseFieldValue(field.BaseField, visitValue)
			}
		}
	}
	for _, group := range view.Groups {
		visitViewValues(group, visitValue)
	}
}

func visitBaseFieldValue(field *BaseField, visitValue func(*Value)) {
	if nil != field && nil != field.Calc {
		visitValue(field.Calc.Result)
	}
}
