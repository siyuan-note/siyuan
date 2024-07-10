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

package util

import (
	"bytes"
	"fmt"
	"io"
	"math/rand"
	"os"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/88250/gulu"
	"github.com/denisbrodbeck/machineid"
	"github.com/go-ole/go-ole"
	"github.com/go-ole/go-ole/oleutil"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
)

// UseSingleLineSave 是否使用单行保存 .sy 和数据库 .json 文件。
var UseSingleLineSave = true

// IsUILoaded 是否已经加载了 UI。
var IsUILoaded = false

func WaitForUILoaded() {
	for !IsUILoaded {
		time.Sleep(200 * time.Millisecond)
	}
}

func HookUILoaded() {
	for !IsUILoaded {
		if 0 < len(SessionsByType("main")) {
			IsUILoaded = true
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
}

// IsExiting 是否正在退出程序。
var IsExiting = atomic.Bool{}

// MobileOSVer 移动端操作系统版本。
var MobileOSVer string

// DatabaseVer 数据库版本。修改表结构的话需要修改这里。
const DatabaseVer = "20220501"

func logBootInfo() {
	plat := GetOSPlatform()
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
		Ver, runtime.GOARCH, plat, os.Getpid(), Mode, WorkingDir, ReadOnly, Container, DatabaseVer, WorkspaceDir)
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

func GetDeviceName() string {
	ret, err := os.Hostname()
	if nil != err {
		return "unknown"
	}
	return ret
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
	TrayMenuLangs   = map[string]map[string]interface{}{}
	AttrViewLangs   = map[string]map[string]interface{}{}
)

var (
	thirdPartySyncCheckTicker = time.NewTicker(time.Minute * 10)
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
	defer logging.Recover()

	if !checkFileSysStatusLock.TryLock() {
		logging.LogWarnf("check file system status is locked, skip")
		return
	}
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

func IsCloudDrivePath(workspaceAbsPath string) bool {
	if isICloudPath(workspaceAbsPath) {
		return true
	}

	if isKnownCloudDrivePath(workspaceAbsPath) {
		return true
	}

	if existAvailabilityStatus(workspaceAbsPath) {
		return true
	}

	return false
}

func isKnownCloudDrivePath(workspaceAbsPath string) bool {
	workspaceAbsPathLower := strings.ToLower(workspaceAbsPath)
	return strings.Contains(workspaceAbsPathLower, "onedrive") || strings.Contains(workspaceAbsPathLower, "dropbox") ||
		strings.Contains(workspaceAbsPathLower, "google drive") || strings.Contains(workspaceAbsPathLower, "pcloud") ||
		strings.Contains(workspaceAbsPathLower, "坚果云") ||
		strings.Contains(workspaceAbsPathLower, "天翼云")
}

func isICloudPath(workspaceAbsPath string) (ret bool) {
	if !gulu.OS.IsDarwin() {
		return false
	}

	workspaceAbsPathLower := strings.ToLower(workspaceAbsPath)

	// macOS 端对工作空间放置在 iCloud 路径下做检查 https://github.com/siyuan-note/siyuan/issues/7747
	iCloudRoot := filepath.Join(HomeDir, "Library", "Mobile Documents")
	WalkWithSymlinks(iCloudRoot, func(path string, info os.FileInfo, err error) error {
		if !info.IsDir() {
			return nil
		}

		if strings.HasPrefix(workspaceAbsPathLower, strings.ToLower(path)) {
			ret = true
			logging.LogWarnf("workspace [%s] is in iCloud path [%s]", workspaceAbsPath, path)
			return io.EOF
		}
		return nil
	})
	return
}

func existAvailabilityStatus(workspaceAbsPath string) bool {
	if !gulu.OS.IsWindows() {
		return false
	}

	if !gulu.File.IsExist(workspaceAbsPath) {
		return false
	}

	// 改进 Windows 端第三方同步盘检测 https://github.com/siyuan-note/siyuan/issues/7777

	defer logging.Recover()

	checkAbsPath := filepath.Join(workspaceAbsPath, "data")
	if !gulu.File.IsExist(checkAbsPath) {
		checkAbsPath = workspaceAbsPath
	}
	if !gulu.File.IsExist(checkAbsPath) {
		logging.LogWarnf("check path [%s] not exist", checkAbsPath)
		return false
	}

	runtime.LockOSThread()
	defer runtime.LockOSThread()
	if err := ole.CoInitializeEx(0, ole.COINIT_MULTITHREADED); nil != err {
		logging.LogWarnf("initialize ole failed: %s", err)
		return false
	}
	defer ole.CoUninitialize()
	dir, file := filepath.Split(checkAbsPath)
	unknown, err := oleutil.CreateObject("Shell.Application")
	if nil != err {
		logging.LogWarnf("create shell application failed: %s", err)
		return false
	}
	shell, err := unknown.QueryInterface(ole.IID_IDispatch)
	if nil != err {
		logging.LogWarnf("query shell interface failed: %s", err)
		return false
	}
	defer shell.Release()

	result, err := oleutil.CallMethod(shell, "NameSpace", dir)
	if nil != err {
		logging.LogWarnf("call shell [NameSpace] failed: %s", err)
		return false
	}
	folderObj := result.ToIDispatch()

	result, err = oleutil.CallMethod(folderObj, "ParseName", file)
	if nil != err {
		logging.LogWarnf("call shell [ParseName] failed: %s", err)
		return false
	}
	fileObj := result.ToIDispatch()
	if nil == fileObj {
		logging.LogWarnf("call shell [ParseName] file is nil [%s]", checkAbsPath)
		return false
	}

	result, err = oleutil.CallMethod(folderObj, "GetDetailsOf", fileObj, 303)
	if nil != err {
		logging.LogWarnf("call shell [GetDetailsOf] failed: %s", err)
		return false
	}
	value := result
	if nil == value {
		return false
	}
	status := strings.ToLower(value.ToString())
	if "" == status || "availability status" == status || "可用性状态" == status {
		return false
	}

	if strings.Contains(status, "sync") || strings.Contains(status, "同步") ||
		strings.Contains(status, "available on this device") || strings.Contains(status, "在此设备上可用") ||
		strings.Contains(status, "available when online") || strings.Contains(status, "联机时可用") {
		logging.LogErrorf("[%s] third party sync status [%s]", checkAbsPath, status)
		return true
	}
	return false
}

const (
	EvtConfPandocInitialized = "conf.pandoc.initialized"

	EvtSQLHistoryRebuild      = "sql.history.rebuild"
	EvtSQLAssetContentRebuild = "sql.assetContent.rebuild"
)
