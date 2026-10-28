// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build !ios && !android

package util

import (
	"github.com/shirou/gopsutil/v4/host"
	"github.com/siyuan-note/logging"
)

func GetOSPlatform() (plat string) {
	plat, _, _, err := host.PlatformInformation()
	if err != nil {
		logging.LogWarnf("get os platform failed: %s", err)
		return "Unknown"
	}
	return
}
