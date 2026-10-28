// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"encoding/json"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
)

// MCP 工具与 REST 端点对同一个模型能力各自解析参数，两者必须给出同样的取舍：同一个值，
// 一边接受另一边拒绝，说明调用方按任一文档写都能通过其中一条路径而拿到不同结果。
// 这里用 REST 的请求结构体本身当判据，而不是在测试里复述一份规则——规则改了测试自动跟随。
func TestAttributeValuesFollowTheRequestContract(t *testing.T) {
	cases := []struct {
		name  string
		value any
		json  string
	}{
		{name: "string", value: "text", json: `"text"`},
		// null 在 REST 契约里是 *string 的零值，含义是删除该属性。
		{name: "null", value: nil, json: `null`},
		{name: "number", value: float64(5), json: `5`},
		{name: "boolean", value: true, json: `true`},
		{name: "object", value: map[string]any{"a": float64(1)}, json: `{"a":1}`},
		{name: "array", value: []any{"a"}, json: `["a"]`},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			var request apicontract.SetBlockAttrsRequest
			restErr := json.Unmarshal([]byte(`{"id":"box","attrs":{"custom-x":`+testCase.json+`}}`), &request)
			values, mcpErr := parseAttrValues(map[string]any{"custom-x": testCase.value})
			if (restErr == nil) != (mcpErr == nil) {
				t.Fatalf("REST error = %v, MCP error = %v; both surfaces must accept or reject the same value",
					restErr, mcpErr)
			}
			if restErr != nil {
				return
			}
			// REST 用 nil 指针表示删除，MCP 用空字符串表示删除，这是两边的既有约定，取值必须一致。
			expected := ""
			if pointer := request.Attrs["custom-x"]; pointer != nil {
				expected = *pointer
			}
			if values["custom-x"] != expected {
				t.Fatalf("REST stores %q, MCP stores %q", expected, values["custom-x"])
			}
		})
	}
}

// 请求头没有删除语义，null 因此不像属性值那样可以折叠成空串；但嵌套结构必须与属性值一样拒绝，
// 否则格式化会把 Go 的内部表示当作头发出去。
func TestHeaderValuesRejectWhatCannotBeSent(t *testing.T) {
	accepted := map[string]any{"Authorization": "Bearer token", "X-Count": float64(5), "X-Debug": true}
	headers, err := parseHeaderValues(accepted)
	if err != nil {
		t.Fatalf("scalar headers must be accepted: %s", err)
	}
	if headers["Authorization"] != "Bearer token" || headers["X-Count"] != "5" || headers["X-Debug"] != "true" {
		t.Fatalf("unexpected header values: %v", headers)
	}
	for name, value := range map[string]any{
		"null":   nil,
		"object": map[string]any{"a": float64(1)},
		"array":  []any{"a"},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := parseHeaderValues(map[string]any{"X-Test": value}); err == nil {
				t.Fatalf("header value of type %T must be rejected", value)
			}
		})
	}
}
