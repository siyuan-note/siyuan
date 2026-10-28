// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
)

// 本文件是契约迁移前的请求解析实现，**冻结**为兼容性测试的参照。
//
// 迁移完成时，这些函数从 util 包移出：生产代码已全部改用 apicontract 的类型化解码器，
// 留在 util 里只是一个只有测试可达的导出 API。测试仍然需要它们，因为兼容性用例断言的正是
// 「新解码器与迁移前的解析结果逐字相同」。
//
// **不要为了让用例通过而修改这里的规则。** 这里代表的是迁移前已经上线、调用方可能依赖的行为；
// 确需调整期望时，应在用例里显式写出新的期望值，并确认该变化是有意的接口变更。

// legacyJSONArg 读取请求体为 JSON 对象，失败时把错误写进 result。
func legacyJSONArg(c *gin.Context, result *gulu.Result) (arg map[string]any, ok bool) {
	arg = map[string]any{}
	if err := c.ShouldBindJSON(&arg); err != nil {
		result.Code = -1
		var detail string
		if errors.Is(err, io.EOF) {
			detail = "the request body is empty or truncated (EOF)"
		} else {
			detail = err.Error()
		}
		result.Msg = fmt.Sprintf("Parses request [%s] failed: %s", c.Request.URL.Path, detail)
		return
	}

	ok = true
	return
}

// legacyParseArg 从已解析的对象里取出指定键，按 required / rejectEmpty 校验后写入 result。
func legacyParseArg[T any](key string, arg map[string]any, ret *gulu.Result, required, rejectEmpty bool) (value T, ok bool) {
	raw, exists := arg[key]
	if !exists || raw == nil {
		if required {
			ret.Code = -1
			ret.Msg = fmt.Sprintf("Field [%s] is required", key)
		} else {
			ok = true
		}
		return
	}

	value, ok = raw.(T)
	if !ok {
		var zero T
		ret.Code = -1

		jsonType := ""
		switch any(zero).(type) {
		case string:
			jsonType = "String"
		case float64:
			jsonType = "Number"
		case bool:
			jsonType = "Boolean"
		case []any:
			jsonType = "Array"
		case map[string]any:
			jsonType = "Object"
		default:
			jsonType = fmt.Sprintf("%T", zero)
		}

		ret.Msg = fmt.Sprintf("Field [%s] should be of type [%s]", key, jsonType)
		return
	}

	if rejectEmpty {
		var bad bool
		switch x := any(value).(type) {
		case string:
			if t := strings.TrimSpace(x); t == "" {
				bad = true
			} else {
				value = any(t).(T)
			}
		case []any:
			bad = len(x) == 0
		case map[string]any:
			bad = len(x) == 0
		}
		if bad {
			ret.Code = -1
			ret.Msg = fmt.Sprintf("Field [%s] must not be empty", key)
			ok = false
		}
	}
	return
}

// legacyArgExtractor 为单次提取函数，供 legacyParseArgs 批量使用。
type legacyArgExtractor func(arg map[string]any, ret *gulu.Result) bool

// legacyBind 生成一个提取函数：取出 key 并写入 dest。
func legacyBind[T any](key string, dest *T, required, rejectEmpty bool) legacyArgExtractor {
	return func(arg map[string]any, ret *gulu.Result) bool {
		v, ok := legacyParseArg[T](key, arg, ret, required, rejectEmpty)
		if !ok {
			return false
		}
		*dest = v
		return true
	}
}

// legacyParseArgs 依次执行提取函数，任一失败即返回 false 并写错误。
func legacyParseArgs(arg map[string]any, ret *gulu.Result, extractors ...legacyArgExtractor) bool {
	for _, ext := range extractors {
		if !ext(arg, ret) {
			return false
		}
	}
	return true
}

// checkLegacyInputCompatibility 以 base 为模板生成一组变异请求体，
// 逐个比对「迁移前解析」与契约解码器给出的错误消息，要求逐字相同。
// base 的每个字段都会被替换为 null、false、1、[]、{}、""、"  " 以及整体删除，
// 另外还包含空体、null、非法 JSON 等整体形态。
func checkLegacyInputCompatibility(t *testing.T, routePath, base string, legacy func(*gin.Context) *gulu.Result, decode func([]byte) error) {
	t.Helper()
	fields := map[string]json.RawMessage{}
	if err := json.Unmarshal([]byte(base), &fields); err != nil {
		t.Fatalf("%s: base body is not a JSON object: %s", routePath, err)
	}
	bodies := [][]byte{[]byte(base), []byte(`{}`), []byte(`null`), []byte(``), []byte(`[`), []byte(`[]`), []byte(`1`)}
	for key := range fields {
		for _, value := range []string{"null", "false", "1", "[]", "{}", `""`, `"  "`} {
			changed := map[string]json.RawMessage{}
			maps.Copy(changed, fields)
			changed[key] = json.RawMessage(value)
			data, _ := json.Marshal(changed)
			bodies = append(bodies, data)
		}
		changed := map[string]json.RawMessage{}
		for k, v := range fields {
			if k != key {
				changed[k] = v
			}
		}
		data, _ := json.Marshal(changed)
		bodies = append(bodies, data)
	}
	for _, body := range bodies {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodPost, routePath, bytes.NewReader(body))
		expected := legacy(c)
		err := decode(body)
		message := ""
		if err != nil {
			message = err.Error()
		}
		if message != expected.Msg {
			t.Errorf("%s: body %s: got %q, want %q", routePath, body, message, expected.Msg)
		}
	}
}
