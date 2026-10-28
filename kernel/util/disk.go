// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build !ios && !android

package util

import (
	"github.com/88250/go-humanize"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/siyuan-note/logging"
)

func NeedWarnDiskUsage(dataSize int64) bool {
	usage, err := disk.Usage(WorkspaceDir)
	if err != nil {
		logging.LogErrorf("get disk usage failed: %s", err)
		return false
	}
	logging.LogInfof("disk usage [total=%s, used=%s, free=%s]", humanize.BytesCustomCeil(usage.Total, 2), humanize.BytesCustomCeil(usage.Used, 2), humanize.BytesCustomCeil(usage.Free, 2))
	return usage.Free < uint64(dataSize*2)
}

func GetDiskUsage(p string) (total, used, free uint64) {
	usage, err := disk.Usage(p)
	if err != nil {
		logging.LogErrorf("get disk usage failed: %s", err)
		return
	}
	return usage.Total, usage.Used, usage.Free
}
