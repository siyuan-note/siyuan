// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package apicontract

import (
	"encoding/json"
	"fmt"
	"strings"
)

// requestFieldString 按旧解析语义读取字符串字段。
// trim 为 true 时裁掉首尾空白，裁剪后为空则报错；字段缺失或为 null 时按 required 决定是否报错。
func requestFieldString(fields map[string]json.RawMessage, key string, required, trim bool) (string, error) {
	value, err := legacyField[string](fields, key, "String", required)
	if err != nil {
		return "", err
	}
	if trim && len(fields[key]) > 0 && string(fields[key]) != "null" {
		value = strings.TrimSpace(value)
		if value == "" {
			return "", fmt.Errorf("Field [%s] must not be empty", key)
		}
	}
	return value, nil
}
