// SiYuan - Refactor your thinking
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

//go:build !ios && !android

package util

import (
	"github.com/dustin/go-humanize"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/siyuan-note/logging"
)

func NeedWarnDiskUsage(dataSize int64) bool {
	usage, err := disk.Usage(WorkspaceDir)
	if nil != err {
		logging.LogErrorf("get disk usage failed: %s", err)
		return false
	}
	logging.LogInfof("disk usage [total=%s, used=%s, free=%s]", humanize.Bytes(usage.Total), humanize.Bytes(usage.Used), humanize.Bytes(usage.Free))
	return usage.Free < uint64(dataSize*2)
}
