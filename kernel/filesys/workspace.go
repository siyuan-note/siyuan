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

package filesys

import (
	"os"
	"path/filepath"
	"sync"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type DataConf struct {
	Updated int64  `json:"updated"` // 最近一次数据更新时间
	SyncVer int64  `json:"syncVer"` // 同步版本号
	Device  string `json:"device"`  // 设备 ID
}

var incWorkspaceDataVerLock = sync.Mutex{}

func IncWorkspaceDataVer(inc bool, systemID string) {
	incWorkspaceDataVerLock.Lock()
	defer incWorkspaceDataVerLock.Unlock()

	confPath := filepath.Join(util.DataDir, ".siyuan")
	os.MkdirAll(confPath, 0755)
	confPath = filepath.Join(confPath, "conf.json")

	var data []byte
	var err error
	now := util.CurrentTimeMillis()
	conf := &DataConf{Updated: now, Device: systemID}
	if !gulu.File.IsExist(confPath) {
		data, _ = gulu.JSON.MarshalIndentJSON(conf, "", "  ")
		if err = filelock.LockFileWrite(confPath, data); nil != err {
			util.LogErrorf("save data conf [%s] failed: %s", confPath, err)
		}

		t := util.Millisecond2Time(now)
		if err = os.Chtimes(confPath, t, t); nil != err {
			util.LogErrorf("change file [%s] mod time failed: %s", confPath, err)
		}
		return
	}

	data, err = filelock.LockFileRead(confPath)
	if nil != err {
		data, err = recoverFrom(confPath)
		if nil != err {
			return
		}
	}

	if err = gulu.JSON.UnmarshalJSON(data, conf); nil != err {
		data, err = recoverFrom(confPath)
		if nil != err {
			return
		}
		if err = gulu.JSON.UnmarshalJSON(data, conf); nil != err {
			util.LogErrorf("parse data conf [%s] failed: %s", confPath, err)
		}
	}

	conf.Updated = now
	conf.Device = systemID
	if inc {
		conf.SyncVer++
	}

	data, _ = gulu.JSON.MarshalIndentJSON(conf, "", "  ")
	if err = filelock.LockFileWrite(confPath, data); nil != err {
		util.LogErrorf("save data conf [%s] failed: %s", confPath, err)
		return
	}
}

func recoverFrom(confPath string) (data []byte, err error) {
	// 尝试从临时文件恢复
	tmp := util.LatestTmpFile(confPath)
	if "" == tmp {
		return
	}

	data, err = filelock.NoLockFileRead(tmp)
	if nil != err {
		util.LogErrorf("read temp data conf [%s] failed: %s", tmp, err)
		return
	}
	util.LogInfof("recovered file [%s] from [%s]", confPath, tmp)
	os.RemoveAll(tmp)
	return
}
