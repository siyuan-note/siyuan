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

package util

import (
	"os"
	"reflect"
	"runtime"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/denisbrodbeck/machineid"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
)

const DatabaseVer = "20220501" // 修改表结构的话需要修改这里

const (
	ExitCodeReadOnlyDatabase      = 20 // 数据库文件被锁
	ExitCodeUnavailablePort       = 21 // 端口不可用
	ExitCodeCreateConfDirErr      = 22 // 创建配置目录失败
	ExitCodeBlockTreeErr          = 23 // 无法读写 blocktree.msgpack 文件
	ExitCodeWorkspaceLocked       = 24 // 工作空间已被锁定
	ExitCodeCreateWorkspaceDirErr = 25 // 创建工作空间失败
	ExitCodeOk                    = 0  // 正常退出
	ExitCodeFatal                 = 1  // 致命错误
)

func logBootInfo() {
	logging.LogInfof("kernel is booting:\n"+
		"    * ver [%s]\n"+
		"    * arch [%s]\n"+
		"    * pid [%d]\n"+
		"    * runtime mode [%s]\n"+
		"    * working directory [%s]\n"+
		"    * read only [%v]\n"+
		"    * container [%s]\n"+
		"    * database [ver=%s]\n"+
		"    * workspace directory [%s]",
		Ver, runtime.GOARCH, os.Getpid(), Mode, WorkingDir, ReadOnly, Container, DatabaseVer, WorkspaceDir)
}

func IsMutexLocked(m *sync.Mutex) bool {
	state := reflect.ValueOf(m).Elem().FieldByName("state")
	return state.Int()&1 == 1
}

func RandomSleep(minMills, maxMills int) {
	r := gulu.Rand.Int(minMills, maxMills)
	time.Sleep(time.Duration(r) * time.Millisecond)
}

func GetDeviceID() string {
	if ContainerStd == Container {
		machineID, err := machineid.ID()
		if nil != err {
			return gulu.Rand.String(12)
		}
		return machineID
	}
	return gulu.Rand.String(12)
}

func SetNetworkProxy(proxyURL string) {
	if err := os.Setenv("HTTPS_PROXY", proxyURL); nil != err {
		logging.LogErrorf("set env [HTTPS_PROXY] failed: %s", err)
	}
	if err := os.Setenv("HTTP_PROXY", proxyURL); nil != err {
		logging.LogErrorf("set env [HTTP_PROXY] failed: %s", err)
	}

	if "" != proxyURL {
		logging.LogInfof("use network proxy [%s]", proxyURL)
	} else {
		logging.LogInfof("use network proxy [system]")
	}

	httpclient.CloseIdleConnections()
}

const (
	// FrontendQueueInterval 为前端请求队列轮询间隔。
	FrontendQueueInterval = 512 * time.Millisecond

	// SQLFlushInterval 为数据库事务队列写入间隔。
	SQLFlushInterval = 3000 * time.Millisecond
)
