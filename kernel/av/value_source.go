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

// ValueSource 描述筛选、排序或分组使用的字段值来源。
type ValueSource string

const (
	ValueSourceStored   ValueSource = "stored"   // 使用字段存储值
	ValueSourceRendered ValueSource = "rendered" // 使用字段模板渲染值
)

// ResolveValueSource 根据值来源返回用于规则求值的值。模板字段本身始终使用模板渲染结果。
func ResolveValueSource(value *Value, source ValueSource) *Value {
	if nil == value || ValueSourceRendered != source || KeyTypeTemplate == value.Type {
		return value
	}

	return &Value{
		ID:       value.ID,
		KeyID:    value.KeyID,
		BlockID:  value.BlockID,
		Type:     KeyTypeTemplate,
		Template: &ValueTemplate{Content: value.RenderedContent},
	}
}
