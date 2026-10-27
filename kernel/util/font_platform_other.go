// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build (!darwin && !windows && !linux) || ios || android

package util

func loadPlatformFonts() []*Font {
	return nil
}
