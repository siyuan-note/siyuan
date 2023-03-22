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
	"bytes"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/denisbrodbeck/machineid"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
)

const DatabaseVer = "20220501" // 修改表结构的话需要修改这里

// IsExiting 是否正在退出程序。
var IsExiting = false

// MobileOSVer 移动端操作系统版本。
var MobileOSVer string

func logBootInfo() {
	plat, platVer := GetOSPlatform()
	osInfo := plat
	if "" != platVer {
		osInfo += " " + platVer
	}
	logging.LogInfof("kernel is booting:\n"+
		"    * ver [%s]\n"+
		"    * arch [%s]\n"+
		"    * os [%s]\n"+
		"    * pid [%d]\n"+
		"    * runtime mode [%s]\n"+
		"    * working directory [%s]\n"+
		"    * read only [%v]\n"+
		"    * container [%s]\n"+
		"    * database [ver=%s]\n"+
		"    * workspace directory [%s]",
		Ver, runtime.GOARCH, osInfo, os.Getpid(), Mode, WorkingDir, ReadOnly, Container, DatabaseVer, WorkspaceDir)
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

var (
	Langs           = map[string]map[int]string{}
	TimeLangs       = map[string]map[string]interface{}{}
	TaskActionLangs = map[string]map[string]interface{}{}
)

var (
	thirdPartySyncCheckTicker = time.NewTicker(time.Second * 10)
)

func ReportFileSysFatalError(err error) {
	stack := debug.Stack()
	output := string(stack)
	if 5 < strings.Count(output, "\n") {
		lines := strings.Split(output, "\n")
		output = strings.Join(lines[5:], "\n")
	}
	logging.LogErrorf("check file system status failed: %s, %s", err, output)
	os.Exit(logging.ExitCodeFileSysErr)
}

var checkFileSysStatusLock = sync.Mutex{}

func CheckFileSysStatus() {
	if ContainerStd != Container {
		return
	}

	for {
		<-thirdPartySyncCheckTicker.C
		checkFileSysStatus()
	}
}

func checkFileSysStatus() {
	if IsMutexLocked(&checkFileSysStatusLock) {
		logging.LogWarnf("check file system status is locked, skip")
		return
	}

	checkFileSysStatusLock.Lock()
	defer checkFileSysStatusLock.Unlock()

	const fileSysStatusCheckFile = ".siyuan/filesys_status_check"
	if IsCloudDrivePath(WorkspaceDir) {
		ReportFileSysFatalError(fmt.Errorf("workspace dir [%s] is in third party sync dir", WorkspaceDir))
		return
	}

	dir := filepath.Join(DataDir, fileSysStatusCheckFile)
	if err := os.RemoveAll(dir); nil != err {
		ReportFileSysFatalError(err)
		return
	}

	if err := os.MkdirAll(dir, 0755); nil != err {
		ReportFileSysFatalError(err)
		return
	}

	for i := 0; i < 7; i++ {
		tmp := filepath.Join(dir, "check_consistency")
		data := make([]byte, 1024*4)
		_, err := rand.Read(data)
		if nil != err {
			ReportFileSysFatalError(err)
			return
		}

		if err = os.WriteFile(tmp, data, 0644); nil != err {
			ReportFileSysFatalError(err)
			return
		}

		time.Sleep(5 * time.Second)

		for j := 0; j < 32; j++ {
			renamed := tmp + "_renamed"
			if err = os.Rename(tmp, renamed); nil != err {
				ReportFileSysFatalError(err)
				break
			}

			RandomSleep(500, 1000)

			f, err := os.Open(renamed)
			if nil != err {
				ReportFileSysFatalError(err)
				return
			}

			if err = f.Close(); nil != err {
				ReportFileSysFatalError(err)
				return
			}

			if err = os.Rename(renamed, tmp); nil != err {
				ReportFileSysFatalError(err)
				return
			}

			entries, err := os.ReadDir(dir)
			if nil != err {
				ReportFileSysFatalError(err)
				return
			}

			checkFilenames := bytes.Buffer{}
			for _, entry := range entries {
				if !entry.IsDir() && strings.Contains(entry.Name(), "check_") {
					checkFilenames.WriteString(entry.Name())
					checkFilenames.WriteString("\n")
				}
			}
			lines := strings.Split(strings.TrimSpace(checkFilenames.String()), "\n")
			if 1 < len(lines) {
				buf := bytes.Buffer{}
				for _, line := range lines {
					buf.WriteString("  ")
					buf.WriteString(line)
					buf.WriteString("\n")
				}
				output := buf.String()
				ReportFileSysFatalError(fmt.Errorf("dir [%s] has more than 1 file:\n%s", dir, output))
				return
			}
		}

		if err = os.RemoveAll(tmp); nil != err {
			ReportFileSysFatalError(err)
			return
		}
	}
}

func IsCloudDrivePath(absPath string) bool {
	absPathLower := strings.ToLower(absPath)
	if isICloudPath(absPathLower) {
		return true
	}

	return strings.Contains(absPathLower, "onedrive") || strings.Contains(absPathLower, "dropbox") ||
		strings.Contains(absPathLower, "google drive") || strings.Contains(absPathLower, "pcloud")
}

func isICloudPath(absPath string) bool {
	if !gulu.OS.IsDarwin() {
		return false
	}

	// macOS 端对工作空间放置在 iCloud 路径下做检查 https://github.com/siyuan-note/siyuan/issues/7747

	iCloudRoot := "~/Library/Mobile Documents"
	err := filepath.Walk(iCloudRoot, func(path string, info os.FileInfo, err error) error {
		if nil != err {
			return err
		}

		logging.LogInfof("path: %s", path)
		return nil
	})
	if nil != err {
		logging.LogErrorf("walk iCloud dir [%s] failed: %s", iCloudRoot, err)
	}

	return false
}
