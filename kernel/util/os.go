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
	"github.com/shirou/gopsutil/v3/host"
	"github.com/siyuan-note/logging"
)

func GetOSPlatform() (plat string) {
	plat, _, _, err := host.PlatformInformation()
	if nil != err {
		logging.LogWarnf("get os platform failed: %s", err)
		return "Unknown"
	}
	return
}
