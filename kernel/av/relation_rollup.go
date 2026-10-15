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

import "strings"

// isRollupValueList 判断汇总是否保留目标字段的条目值。
func isRollupValueList(key *Key) bool {
	return nil != key && KeyTypeRollup == key.Type && nil != key.Rollup &&
		(nil == key.Rollup.Calc || CalcOperatorNone == key.Rollup.Calc.Operator ||
			CalcOperatorUniqueValues == key.Rollup.Calc.Operator)
}

// ResolveRelationKey 解析直接关联或保留原值的汇总所指向的最终关联字段。
// load 由调用方提供，以保留关联数据库的缓存和笔记本读取边界。
func (attrView *AttributeView) ResolveRelationKey(keyID string,
	load func(string) (*AttributeView, error)) (*Key, error) {
	if nil == attrView {
		return nil, ErrInvalidAttributeViewContextFilter
	}
	key := getRelationFilterKey(attrView, keyID)
	if nil == key {
		return nil, ErrInvalidAttributeViewContextFilter
	}
	if isRollupValueList(key) {
		relation := getRelationFilterKey(attrView, key.Rollup.RelationKeyID)
		if !isConfiguredRelationKey(relation) {
			return nil, ErrInvalidAttributeViewContextFilter
		}
		target := attrView
		if relation.Relation.AvID != attrView.ID {
			if nil == load {
				load = ParseAttributeView
			}
			var err error
			if target, err = load(relation.Relation.AvID); nil != err {
				return nil, err
			}
		}
		if nil == target {
			return nil, ErrAttributeViewNotFound
		}
		key = getRelationFilterKey(target, key.Rollup.KeyID)
	}
	if !isConfiguredRelationKey(key) {
		return nil, ErrInvalidAttributeViewContextFilter
	}
	return key, nil
}

func getRelationFilterKey(attrView *AttributeView, id string) *Key {
	if "" == strings.TrimSpace(id) {
		return nil
	}
	for _, values := range attrView.KeyValues {
		if nil != values && nil != values.Key && values.Key.ID == id {
			return values.Key
		}
	}
	return nil
}

func isConfiguredRelationKey(key *Key) bool {
	return nil != key && KeyTypeRelation == key.Type && nil != key.Relation &&
		"" != strings.TrimSpace(key.Relation.AvID)
}

// filterRelationRollupItems 对汇总中的全部关联条目做精确集合匹配，不按中间行分别匹配。
func filterRelationRollupItems(contents []*Value, filter *ViewFilter) bool {
	if nil == filter.Value.Relation || 0 == len(filter.Value.Relation.BlockIDs) {
		return true
	}
	selected := map[string]bool{}
	for _, id := range filter.Value.Relation.BlockIDs {
		if "" != id {
			selected[id] = true
		}
	}
	for _, content := range contents {
		if nil == content || nil == content.Relation {
			continue
		}
		for _, id := range content.Relation.BlockIDs {
			if selected[id] {
				return FilterOperatorContainsAnyItem == filter.Operator
			}
		}
	}
	return FilterOperatorDoesNotContainAnyItem == filter.Operator
}
