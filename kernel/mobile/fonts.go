// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package mobile

import (
	"encoding/json"

	"github.com/siyuan-note/siyuan/kernel/util"
)

// 字体查询不启动内核，也不打开工作空间。
func GetSysFonts() string {
	data, err := json.Marshal(util.LoadSysFonts())
	if err != nil {
		return "[]"
	}
	return string(data)
}
