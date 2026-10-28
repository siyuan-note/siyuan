// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build !linux && !windows

package server

import "path/filepath"

func evalAppearanceSymlinks(name string) (string, error) {
	return filepath.EvalSymlinks(name)
}
