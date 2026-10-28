// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

// CardLayout 描述了卡片字段的布局方式。
type CardLayout int

const (
	CardLayoutList CardLayout = iota
	CardLayoutCompact
)

func (layout CardLayout) IsValid() bool {
	return CardLayoutList <= layout && layout <= CardLayoutCompact
}
