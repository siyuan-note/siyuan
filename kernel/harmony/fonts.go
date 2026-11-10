// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package main

import "C"

import "github.com/siyuan-note/siyuan/kernel/util"

// Harmony 字体由原生系统 API 发现，避免把 Android 字体目录当作系统支持列表。
//
//export NormalizeSysFonts
func NormalizeSysFonts(raw *C.char) *C.char {
	if raw == nil {
		return C.CString("[]")
	}
	return C.CString(util.NormalizeSysFontsJSON(C.GoString(raw)))
}
