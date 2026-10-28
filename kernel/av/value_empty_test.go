// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import "testing"

// IsEmpty 与 IsBlank 共用同一套类型分派，两者的唯一差别是内容首尾空白：
// 只有空白的值 IsBlank 视为空、IsEmpty 视为有内容；模板内容两者都按去空白后比较。
func TestValueEmptyAndBlank(t *testing.T) {
	tests := []struct {
		name  string
		value *Value
		empty bool
		blank bool
	}{
		{"nil value", nil, true, true},

		{"block filled", &Value{Type: KeyTypeBlock, Block: &ValueBlock{Content: "块"}}, false, false},
		{"block blank", &Value{Type: KeyTypeBlock, Block: &ValueBlock{Content: "  "}}, false, true},
		{"block missing", &Value{Type: KeyTypeBlock}, true, true},

		{"text filled", &Value{Type: KeyTypeText, Text: &ValueText{Content: "字"}}, false, false},
		{"text blank", &Value{Type: KeyTypeText, Text: &ValueText{Content: "  "}}, false, true},
		{"text missing", &Value{Type: KeyTypeText}, true, true},

		{"url blank", &Value{Type: KeyTypeURL, URL: &ValueURL{Content: " "}}, false, true},
		{"email blank", &Value{Type: KeyTypeEmail, Email: &ValueEmail{Content: " "}}, false, true},
		{"phone blank", &Value{Type: KeyTypePhone, Phone: &ValuePhone{Content: " "}}, false, true},

		{"number empty", &Value{Type: KeyTypeNumber, Number: &ValueNumber{IsNotEmpty: false}}, true, true},
		{"number filled", &Value{Type: KeyTypeNumber, Number: &ValueNumber{Content: 0, IsNotEmpty: true}}, false, false},
		{"date empty", &Value{Type: KeyTypeDate, Date: &ValueDate{IsNotEmpty: false}}, true, true},

		{"select missing", &Value{Type: KeyTypeSelect}, true, true},
		{"select blank", &Value{Type: KeyTypeSelect, MSelect: []*ValueSelect{{Content: " "}}}, false, true},
		{"select nil option", &Value{Type: KeyTypeSelect, MSelect: []*ValueSelect{nil}}, true, true},
		{"select filled", &Value{Type: KeyTypeSelect, MSelect: []*ValueSelect{{Content: "甲"}}}, false, false},
		{"mselect empty", &Value{Type: KeyTypeMSelect}, true, true},
		{"mselect filled", &Value{Type: KeyTypeMSelect, MSelect: []*ValueSelect{{Content: "甲"}}}, false, false},

		{"mAsset empty", &Value{Type: KeyTypeMAsset}, true, true},
		{"mAsset filled", &Value{Type: KeyTypeMAsset, MAsset: []*ValueAsset{{Content: "a.png"}}}, false, false},

		// 模板内容始终按去空白后比较，空白模板在两种判定下都是空值。
		{"template blank", &Value{Type: KeyTypeTemplate, Template: &ValueTemplate{Content: "  "}}, true, true},
		{"template filled", &Value{Type: KeyTypeTemplate, Template: &ValueTemplate{Content: "x"}}, false, false},

		{"created missing", &Value{Type: KeyTypeCreated}, true, true},
		{"created filled", &Value{Type: KeyTypeCreated, Created: &ValueCreated{Content: 1, IsNotEmpty: true}}, false, false},
		{"updated missing", &Value{Type: KeyTypeUpdated}, true, true},

		{"checkbox missing", &Value{Type: KeyTypeCheckbox}, true, true},
		{"checkbox unchecked", &Value{Type: KeyTypeCheckbox, Checkbox: &ValueCheckbox{}}, false, false},

		{"relation missing", &Value{Type: KeyTypeRelation}, true, true},
		{"relation empty", &Value{Type: KeyTypeRelation, Relation: &ValueRelation{}}, true, true},
		{"rollup missing", &Value{Type: KeyTypeRollup}, true, true},

		{"location missing", &Value{Type: KeyTypeLocation}, true, true},

		// 未知类型既不是空值也不是空白，保留原有回退结果。
		{"unknown", &Value{Type: KeyType("unknown")}, false, false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := test.value.IsEmpty(); got != test.empty {
				t.Fatalf("IsEmpty = %v，期望 %v", got, test.empty)
			}
			if got := test.value.IsBlank(); got != test.blank {
				t.Fatalf("IsBlank = %v，期望 %v", got, test.blank)
			}
		})
	}
}

// TestValueBlankKeepsEmptyContract 断言空白判定包含空值判定：
// 空值在两种口径下都必须为空，否则过滤与排序会得到互相矛盾的结果。
func TestValueBlankKeepsEmptyContract(t *testing.T) {
	values := []*Value{
		{Type: KeyTypeBlock}, {Type: KeyTypeText, Text: &ValueText{}},
		{Type: KeyTypeNumber}, {Type: KeyTypeDate}, {Type: KeyTypeSelect},
		{Type: KeyTypeMSelect}, {Type: KeyTypeURL}, {Type: KeyTypeEmail},
		{Type: KeyTypePhone}, {Type: KeyTypeMAsset}, {Type: KeyTypeTemplate},
		{Type: KeyTypeCreated}, {Type: KeyTypeUpdated}, {Type: KeyTypeCheckbox},
		{Type: KeyTypeRelation}, {Type: KeyTypeRollup},
	}
	for _, value := range values {
		if value.IsEmpty() && !value.IsBlank() {
			t.Fatalf("类型 %s 的 IsEmpty 为真但 IsBlank 为假", value.Type)
		}
	}
}
