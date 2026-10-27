// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build darwin

package plugin

import (
	"os"
	"syscall"
)

func readPluginSourceFileIdentity(info os.FileInfo) (device, inode uint64, ctime int64) {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return
	}
	device = uint64(stat.Dev)
	inode = stat.Ino
	ctime = stat.Ctimespec.Nano()
	return
}
