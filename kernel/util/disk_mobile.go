// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

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
