// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
