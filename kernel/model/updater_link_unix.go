// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build !windows

package model

import "os"

func createInstallPackageDirectoryLink(target, link string) error {
	return os.Symlink(target, link)
}
