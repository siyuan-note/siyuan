// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import "github.com/siyuan-note/siyuan/kernel/av"

func applyAttributeViewIconDefaults(view *av.View) {
	base := view.GetBaseLayout()
	if base == nil {
		return
	}
	showIcon, showRelationIcon := true, true
	if Conf != nil {
		if editor := Conf.Editor.Load(); editor != nil {
			if editor.DatabaseShowIcon != nil {
				showIcon = *editor.DatabaseShowIcon
			}
			if editor.DatabaseShowRelationIcon != nil {
				showRelationIcon = *editor.DatabaseShowRelationIcon
			}
		}
	}
	base.ShowIcon = showIcon
	base.ShowRelationIcon = new(showRelationIcon)
}
