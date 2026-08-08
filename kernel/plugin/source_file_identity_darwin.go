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
