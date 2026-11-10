// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"unicode/utf8"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func truncateText(text string, maxLen int) string {
	if utf8.RuneCountInString(text) <= maxLen {
		return text
	}
	return util.TruncateRunes(text, maxLen) + "..."
}
