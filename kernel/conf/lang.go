// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

type Lang struct {
	Label string `json:"label"` // 简体中文
	Name  string `json:"name"`  // BCP 47 标准语言代码，例如 zh-CN
}
