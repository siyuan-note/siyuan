// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build windows

package server

import "github.com/siyuan-note/siyuan/kernel/util"

func evalAppearanceSymlinks(name string) (string, error) {
	// 通过句柄解析完整链路，兼容可打开但无法逐级解析的目录联接。
	return util.ResolveRealPath(name)
}
