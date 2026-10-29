// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build !windows

package model

// flushDNS 非 Windows 平台暂不支持刷新系统 DNS 缓存。
func flushDNS() {
}
