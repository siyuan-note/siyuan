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
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"bytes"
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"sort"
)

// 只记录字段操作实际改变的片段；带稳定标识的集合按元素合并，其他列表整体检查冲突。
type attributeViewFieldChange struct {
	before, after             any
	beforeExists, afterExists bool
	members                   map[string]*attributeViewFieldChange
	elements                  map[string]*attributeViewFieldChange
	beforeOrder, afterOrder   []string
	container                 string
}

func attributeViewFieldJSON(value any) (any, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber()
	var ret any
	err = decoder.Decode(&ret)
	return ret, err
}

func attributeViewFieldElementID(value any, container string) string {
	if container == "itemIds" || container == "groupItemIds" {
		id, _ := value.(string)
		return id
	}
	object, ok := value.(map[string]any)
	if !ok {
		return ""
	}
	if container == "options" {
		name, _ := object["name"].(string)
		return name
	}
	if key, ok := object["key"].(map[string]any); ok {
		object = key
	}
	id, _ := object["id"].(string)
	return id
}

func attributeViewFieldElements(values []any, container string) (map[string]any, []string, bool) {
	ret := map[string]any{}
	var order []string
	for _, value := range values {
		id := attributeViewFieldElementID(value, container)
		if id == "" || ret[id] != nil {
			return nil, nil, false
		}
		ret[id] = value
		order = append(order, id)
	}
	return ret, order, true
}

func diffAttributeViewFields(before, after any, beforeExists, afterExists bool) *attributeViewFieldChange {
	return diffAttributeViewFieldData(before, after, beforeExists, afterExists, "")
}

// 格式化文本、关联显示内容、汇总结果和分组生成时间由渲染计算，不作为后续编辑冲突。
func attributeViewFieldDerivedMember(container, key string) bool {
	return key == "groupCreated" || key == "formattedContent" || key == "contents" && (container == "relation" || container == "rollup")
}

func equalAttributeViewFieldData(before, after any, container string) bool {
	old, oldIsMap := before.(map[string]any)
	current, currentIsMap := after.(map[string]any)
	if oldIsMap && currentIsMap {
		for key, value := range old {
			if attributeViewFieldDerivedMember(container, key) {
				continue
			}
			other, exists := current[key]
			if !exists || !equalAttributeViewFieldData(value, other, key) {
				return false
			}
		}
		for key := range current {
			if _, exists := old[key]; !exists && !attributeViewFieldDerivedMember(container, key) {
				return false
			}
		}
		return true
	}
	oldSlice, oldIsSlice := before.([]any)
	currentSlice, currentIsSlice := after.([]any)
	if oldIsSlice && currentIsSlice {
		if len(oldSlice) != len(currentSlice) {
			return false
		}
		for index := range oldSlice {
			if !equalAttributeViewFieldData(oldSlice[index], currentSlice[index], container) {
				return false
			}
		}
		return true
	}
	return reflect.DeepEqual(before, after)
}

func diffAttributeViewFieldData(before, after any, beforeExists, afterExists bool, container string) *attributeViewFieldChange {
	if beforeExists == afterExists && equalAttributeViewFieldData(before, after, container) {
		return nil
	}
	change := &attributeViewFieldChange{before: before, after: after, beforeExists: beforeExists, afterExists: afterExists, container: container}
	if !beforeExists || !afterExists {
		return change
	}
	beforeMap, beforeIsMap := before.(map[string]any)
	afterMap, afterIsMap := after.(map[string]any)
	if beforeIsMap && afterIsMap {
		change.members = map[string]*attributeViewFieldChange{}
		for key := range beforeMap {
			change.members[key] = nil
		}
		for key := range afterMap {
			change.members[key] = nil
		}
		for key := range change.members {
			if attributeViewFieldDerivedMember(container, key) {
				delete(change.members, key)
				continue
			}
			old, oldOK := beforeMap[key]
			newValue, newOK := afterMap[key]
			if child := diffAttributeViewFieldData(old, newValue, oldOK, newOK, key); child != nil {
				change.members[key] = child
			} else {
				delete(change.members, key)
			}
		}
		if len(change.members) == 0 {
			return nil
		}
		change.before, change.after = nil, nil
		return change
	}
	beforeSlice, beforeIsSlice := before.([]any)
	afterSlice, afterIsSlice := after.([]any)
	if !beforeIsSlice || !afterIsSlice {
		return change
	}
	oldElements, oldOrder, oldOK := attributeViewFieldElements(beforeSlice, container)
	newElements, newOrder, newOK := attributeViewFieldElements(afterSlice, container)
	if !oldOK || !newOK {
		return change
	}
	var oldCommon, newCommon []string
	for _, id := range oldOrder {
		if newElements[id] != nil {
			oldCommon = append(oldCommon, id)
		}
	}
	for _, id := range newOrder {
		if oldElements[id] != nil {
			newCommon = append(newCommon, id)
		}
	}
	if !slices.Equal(oldCommon, newCommon) {
		return change
	}
	change.elements = map[string]*attributeViewFieldChange{}
	change.beforeOrder, change.afterOrder = oldOrder, newOrder
	for _, id := range append(append([]string(nil), oldOrder...), newOrder...) {
		old, oldExists := oldElements[id]
		newValue, newExists := newElements[id]
		if child := diffAttributeViewFieldData(old, newValue, oldExists, newExists, container); child != nil {
			change.elements[id] = child
		}
	}
	if len(change.elements) == 0 {
		return nil
	}
	change.before, change.after = nil, nil
	return change
}

func (change *attributeViewFieldChange) apply(current any, exists, undo bool) (any, bool, error) {
	conflict := fmt.Errorf("database field undo conflicts with a subsequent edit")
	if change.members != nil {
		object, ok := current.(map[string]any)
		if !exists || !ok {
			return nil, false, conflict
		}
		for _, key := range sortedAttributeViewFieldKeys(change.members) {
			value, present := object[key]
			replacement, keep, err := change.members[key].apply(value, present, undo)
			if err != nil {
				return nil, false, fmt.Errorf("%s: %w", key, err)
			}
			if keep {
				object[key] = replacement
			} else {
				delete(object, key)
			}
		}
		return object, true, nil
	}
	if change.elements != nil {
		values, ok := current.([]any)
		if !exists || !ok {
			return nil, false, conflict
		}
		elements, _, valid := attributeViewFieldElements(values, change.container)
		if !valid {
			return nil, false, conflict
		}
		for _, id := range sortedAttributeViewFieldKeys(change.elements) {
			value, present := elements[id]
			replacement, keep, err := change.elements[id].apply(value, present, undo)
			if err != nil {
				return nil, false, fmt.Errorf("%s: %w", id, err)
			}
			if keep {
				elements[id] = replacement
			} else {
				delete(elements, id)
			}
		}
		result := make([]any, 0, len(values))
		for _, value := range values {
			if updated, keep := elements[attributeViewFieldElementID(value, change.container)]; keep {
				result = append(result, updated)
			}
		}
		order := change.afterOrder
		if undo {
			order = change.beforeOrder
		}
		for index, id := range order {
			if elements[id] == nil || slices.ContainsFunc(result, func(value any) bool { return attributeViewFieldElementID(value, change.container) == id }) {
				continue
			}
			position := -1
			for previous := index - 1; previous >= 0; previous-- {
				if found := slices.IndexFunc(result, func(value any) bool { return attributeViewFieldElementID(value, change.container) == order[previous] }); found >= 0 {
					position = found + 1
					break
				}
			}
			if position < 0 {
				position = 0
			}
			result = slices.Insert(result, position, elements[id])
		}
		return result, true, nil
	}
	expected, replacement := change.before, change.after
	expectedExists, replacementExists := change.beforeExists, change.afterExists
	if undo {
		expected, replacement = replacement, expected
		expectedExists, replacementExists = replacementExists, expectedExists
	}
	if exists != expectedExists || !equalAttributeViewFieldData(current, expected, change.container) {
		return nil, false, conflict
	}
	copy, err := attributeViewFieldJSON(replacement)
	return copy, replacementExists, err
}

func sortedAttributeViewFieldKeys[T any](values map[string]T) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
