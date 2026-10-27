// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

// SearchSubTypes 保存各父类型的子类型选择，未知顶层字段由 JSON 解析器忽略。
type SearchSubTypes struct {
	Heading  map[string]bool `json:"heading"`
	List     map[string]bool `json:"list"`
	ListItem map[string]bool `json:"listItem"`
}
