// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build ios || android

package util

import (
	"github.com/siyuan-note/logging"
	"golang.org/x/sys/unix"
)

func NeedWarnDiskUsage(dataSize int64) bool {
	return false
}

func GetDiskUsage(p string) (total, used, free uint64) {
	var stat unix.Statfs_t
	if err := unix.Statfs(p, &stat); err != nil {
		logging.LogWarnf("get disk usage failed: %s", err)
		return
	}
	blockSize := uint64(stat.Bsize)
	total = stat.Blocks * blockSize
	used = (stat.Blocks - stat.Bfree) * blockSize
	free = stat.Bavail * blockSize
	return
}
