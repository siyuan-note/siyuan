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

package main

import (
	"C"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/job"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/server"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

//export StartKernelFast
func StartKernelFast(container, appDir, workspaceBaseDir, localIPs *C.char) {
	go server.Serve(true, model.Conf.CookieKey)
}

//export StartKernel
func StartKernel(container, appDir, workspaceBaseDir, timezoneID, localIPs, lang, osVer *C.char) {
	SetTimezone(C.GoString(container), C.GoString(appDir), C.GoString(timezoneID))
	util.Mode = "prod"
	util.MobileOSVer = C.GoString(osVer)
	util.LocalIPs = strings.Split(C.GoString(localIPs), ",")
	util.BootMobile(C.GoString(container), C.GoString(appDir), C.GoString(workspaceBaseDir), C.GoString(lang))

	model.InitConf()
	go server.Serve(false, model.Conf.CookieKey)
	go func() {
		model.InitAppearance()
		sql.InitDatabase(false)
		sql.InitHistoryDatabase(false)
		sql.InitAssetContentDatabase(false)
		sql.SetCaseSensitive(model.Conf.Search.CaseSensitive)
		sql.SetIndexAssetPath(model.Conf.Search.IndexAssetPath)

		model.BootSyncData()
		model.InitBoxes()
		model.LoadFlashcards()
		util.LoadAssetsTexts()

		util.SetBooted()
		util.PushClearAllMsg()

		job.StartCron()
		go model.AutoGenerateFileHistory()
		go cache.LoadAssets()
	}()
}

//export Language
func Language(num int) string {
	return model.Conf.Language(num)
}

//export ShowMsg
func ShowMsg(msg string, timeout int) {
	util.PushMsg(msg, timeout)
}

//export IsHttpServing
func IsHttpServing() bool {
	return util.HttpServing
}

//export SetHttpServerPort
func SetHttpServerPort(port int) {
	filelock.AndroidServerPort = port
}

//export GetCurrentWorkspacePath
func GetCurrentWorkspacePath() *C.char {
	return C.CString(util.WorkspaceDir)
}

//export GetAssetAbsPath
func GetAssetAbsPath(relativePath *C.char) *C.char {
	absPath, err := model.GetAssetAbsPath(C.GoString(relativePath))
	if nil != err {
		logging.LogErrorf("get asset abs path failed: %s", err)
		return relativePath
	}
	return C.CString(absPath)
}

//export GetMimeTypeByExt
func GetMimeTypeByExt(ext string) string {
	return util.GetMimeTypeByExt(ext)
}

//export SetTimezone
func SetTimezone(container, appDir, timezoneID string) {
	if "ios" == container {
		os.Setenv("ZONEINFO", filepath.Join(appDir, "app", "zoneinfo.zip"))
	}
	z, err := time.LoadLocation(strings.TrimSpace(timezoneID))
	if err != nil {
		fmt.Printf("load location failed: %s\n", err)
		time.Local = time.FixedZone("CST", 8*3600)
		return
	}
	time.Local = z
}

//export DisableFeature
func DisableFeature(feature *C.char) {
	util.DisableFeature(C.GoString(feature))
}

//export Unzip
func Unzip(zipFilePath, destination *C.char) {
	if err := gulu.Zip.Unzip(C.GoString(zipFilePath), C.GoString(destination)); nil != err {
		logging.LogErrorf("unzip [%s] failed: %s", zipFilePath, err)
	}
}

//export Exit
func Exit() {
	os.Exit(logging.ExitCodeOk)
}

func main() {}
