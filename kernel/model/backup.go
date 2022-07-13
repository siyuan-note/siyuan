// SiYuan - Build Your Eternal Digital Garden
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

package model

import (
	"errors"
	"fmt"

	"github.com/dustin/go-humanize"
)

type Backup struct {
	Size    int64  `json:"size"`
	HSize   string `json:"hSize"`
	Updated string `json:"updated"`
	SaveDir string `json:"saveDir"` // 本地备份数据存放目录路径
}

type Sync struct {
	Size      int64  `json:"size"`
	HSize     string `json:"hSize"`
	Updated   string `json:"updated"`
	CloudName string `json:"cloudName"` // 云端同步数据存放目录名
	SaveDir   string `json:"saveDir"`   // 本地同步数据存放目录路径
}

func GetCloudSpace() (s *Sync, b *Backup, hSize, hAssetSize, hTotalSize string, err error) {
	sync, backup, assetSize, err := getCloudSpaceOSS()
	if nil != err {
		err = errors.New(Conf.Language(30) + " " + err.Error())
		return
	}

	var totalSize, syncSize, backupSize int64
	var syncUpdated, backupUpdated string
	if nil != sync {
		syncSize = int64(sync["size"].(float64))
		syncUpdated = sync["updated"].(string)
	}
	s = &Sync{
		Size:    syncSize,
		HSize:   humanize.Bytes(uint64(syncSize)),
		Updated: syncUpdated,
	}

	if nil != backup {
		backupSize = int64(backup["size"].(float64))
		backupUpdated = backup["updated"].(string)
	}
	b = &Backup{
		Size:    backupSize,
		HSize:   humanize.Bytes(uint64(backupSize)),
		Updated: backupUpdated,
	}
	totalSize = syncSize + backupSize + assetSize
	hAssetSize = humanize.Bytes(uint64(assetSize))
	hSize = humanize.Bytes(uint64(totalSize))
	hTotalSize = byteCountSI(int64(Conf.User.UserSiYuanRepoSize))
	return
}

func byteCountSI(b int64) string {
	const unit = 1000
	if b < unit {
		return fmt.Sprintf("%d B", b)
	}
	div, exp := int64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %cB", float64(b)/float64(div), "kMGTPE"[exp])
}
