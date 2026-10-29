// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import "encoding/json"

// decodeCloudInbox 将云端 JSON 数据绑定到明确的收集箱载荷，保留云端响应的嵌套层级。
func decodeCloudInbox[T any](value map[string]any) (result *T, err error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	err = json.Unmarshal(data, &result)
	return
}
