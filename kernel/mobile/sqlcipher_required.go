// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build (android || ios) && !sqlcipher && !libsqlcipher

package mobile

// 移动端内核必须启用 SQLCipher，否则无法打开加密笔记本。
var _ = sqlcipher_or_libsqlcipher_build_tag_required
