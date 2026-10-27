// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

import (
	"github.com/siyuan-note/siyuan/kernel/util"
)

type Tag struct {
	Sort int `json:"sort"` // 排序方式
}

func NewTag() *Tag {
	return &Tag{
		Sort: util.SortModeAlphanumASC,
	}
}
