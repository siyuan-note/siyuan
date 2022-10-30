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
	"bufio"
	"crypto/sha256"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/imroc/req/v3"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func execNewVerInstallPkg(newVerInstallPkgPath string) {
	logging.LogInfof("installing the new version [%s]", newVerInstallPkgPath)
	var cmd *exec.Cmd
	if gulu.OS.IsWindows() {
		cmd = exec.Command(newVerInstallPkgPath)
	} else if gulu.OS.IsDarwin() {
		exec.Command("chmod", "+x", newVerInstallPkgPath).CombinedOutput()
		cmd = exec.Command("open", newVerInstallPkgPath)
	} else if gulu.OS.IsLinux() {
		exec.Command("chmod", "+x", newVerInstallPkgPath).CombinedOutput()
		cmd = exec.Command("sh", "-c", newVerInstallPkgPath)
	}
	gulu.CmdAttr(cmd)
	cmdErr := cmd.Start()
	if nil != cmdErr {
		logging.LogErrorf("exec install new version failed: %s", cmdErr)
		return
	}
}

func getNewVerInstallPkgPath() string {
	if skipNewVerInstallPkg() {
		return ""
	}

	downloadPkgURL, checksum, err := getUpdatePkg()
	if nil != err || "" == downloadPkgURL || "" == checksum {
		return ""
	}

	pkg := path.Base(downloadPkgURL)
	ret := filepath.Join(util.TempDir, "install", pkg)
	localChecksum, _ := sha256Hash(ret)
	if checksum != localChecksum {
		return ""
	}
	return ret
}

var checkDownloadInstallPkgLock = sync.Mutex{}

func checkDownloadInstallPkg() {
	defer logging.Recover()

	if skipNewVerInstallPkg() {
		return
	}

	if util.IsMutexLocked(&checkDownloadInstallPkgLock) {
		return
	}

	checkDownloadInstallPkgLock.Lock()
	defer checkDownloadInstallPkgLock.Unlock()

	downloadPkgURL, checksum, err := getUpdatePkg()
	if nil != err || "" == downloadPkgURL || "" == checksum {
		return
	}

	downloadInstallPkg(downloadPkgURL, checksum)
}

func getUpdatePkg() (downloadPkgURL, checksum string, err error) {
	result, err := util.GetRhyResult(false)
	if nil != err {
		return
	}

	installPkgSite := result["installPkg"].(string)
	ver := result["ver"].(string)
	if isVersionUpToDate(ver) {
		return
	}

	var suffix string
	if gulu.OS.IsWindows() {
		suffix = "win.exe"
	} else if gulu.OS.IsDarwin() {
		if "arm64" == runtime.GOARCH {
			suffix = "mac-arm64.dmg"
		} else {
			suffix = "mac.dmg"
		}
	} else if gulu.OS.IsLinux() {
		suffix = "linux.AppImage"
	}
	pkg := "siyuan-" + ver + "-" + suffix
	downloadPkgURL = installPkgSite + "siyuan/" + pkg
	checksums := result["checksums"].(map[string]interface{})
	checksum = checksums[pkg].(string)
	return
}

func downloadInstallPkg(pkgURL, checksum string) {
	if "" == pkgURL || "" == checksum {
		return
	}

	pkg := path.Base(pkgURL)
	savePath := filepath.Join(util.TempDir, "install", pkg)
	if gulu.File.IsExist(savePath) {
		localChecksum, _ := sha256Hash(savePath)
		if localChecksum == checksum {
			return
		}
	}

	err := os.MkdirAll(filepath.Join(util.TempDir, "install"), 0755)
	if nil != err {
		logging.LogErrorf("create temp install dir failed: %s", err)
		return
	}

	logging.LogInfof("downloading install package [%s]", pkgURL)
	msgId := util.PushMsg(Conf.Language(103), 60*1000*10)
	client := req.C().SetTLSHandshakeTimeout(7 * time.Second).SetTimeout(10 * time.Minute)
	callback := func(info req.DownloadInfo) {
		//logging.LogDebugf("downloading install package [%s %.2f%%]", pkgURL, float64(info.DownloadedSize)/float64(info.Response.ContentLength)*100.0)
	}
	_, err = client.R().SetOutputFile(savePath).SetDownloadCallback(callback).Get(pkgURL)
	if nil != err {
		logging.LogErrorf("download install package failed: %s", err)
		util.PushUpdateMsg(msgId, Conf.Language(104), 7000)
		return
	}

	localChecksum, _ := sha256Hash(savePath)
	if checksum != localChecksum {
		logging.LogErrorf("verify checksum failed, download install package [%s] checksum [%s] not equal to downloaded [%s] checksum [%s]", pkgURL, checksum, savePath, localChecksum)
		return
	}
	logging.LogInfof("downloaded install package [%s] to [%s]", pkgURL, savePath)
}

func sha256Hash(filename string) (ret string, err error) {
	file, err := os.Open(filename)
	if nil != err {
		return
	}
	defer file.Close()

	hash := sha256.New()
	reader := bufio.NewReader(file)
	buf := make([]byte, 1024*1024*4)
	for {
		switch n, readErr := reader.Read(buf); readErr {
		case nil:
			hash.Write(buf[:n])
		case io.EOF:
			return fmt.Sprintf("%x", hash.Sum(nil)), nil
		default:
			return "", err
		}
	}
}

type Announcement struct {
	Id    string `json:"id"`
	Title string `json:"title"`
	URL   string `json:"url"`
}

func GetAnnouncements() (ret []*Announcement) {
	result, err := util.GetRhyResult(false)
	if nil != err {
		logging.LogErrorf("get announcement failed: %s", err)
		return
	}

	if nil == result["announcement"] {
		return
	}

	announcements := result["announcement"].([]interface{})
	for _, announcement := range announcements {
		ann := announcement.(map[string]interface{})
		ret = append(ret, &Announcement{
			Id:    ann["id"].(string),
			Title: ann["title"].(string),
			URL:   ann["url"].(string),
		})
	}
	return
}

func CheckUpdate(showMsg bool) {
	if !showMsg {
		return
	}

	result, err := util.GetRhyResult(showMsg)
	if nil != err {
		return
	}

	ver := result["ver"].(string)
	release := result["release"].(string)
	var msg string
	var timeout int
	if isVersionUpToDate(ver) {
		msg = Conf.Language(10)
		timeout = 3000
	} else {
		msg = fmt.Sprintf(Conf.Language(9), "<a href=\""+release+"\">"+release+"</a>")
		showMsg = true
		timeout = 15000
	}
	if showMsg {
		util.PushMsg(msg, timeout)
		go func() {
			checkDownloadInstallPkg()
			if "" != getNewVerInstallPkgPath() {
				util.PushMsg(Conf.Language(62), 0)
			}
		}()
	}
}

func isVersionUpToDate(releaseVer string) bool {
	return ver2num(releaseVer) <= ver2num(util.Ver)
}

func skipNewVerInstallPkg() bool {
	if !gulu.OS.IsWindows() && !gulu.OS.IsDarwin() && !gulu.OS.IsLinux() {
		return true
	}
	if util.ISMicrosoftStore {
		return true
	}
	if !Conf.System.DownloadInstallPkg {
		return true
	}
	return false
}

func ver2num(a string) int {
	var version string
	var suffixpos int
	var suffixStr string
	var suffix string
	a = strings.Trim(a, " ")
	if strings.Contains(a, "alpha") {
		suffixpos = strings.Index(a, "-alpha")
		version = a[0:suffixpos]
		suffixStr = a[suffixpos+6 : len(a)]
		suffix = "0" + fmt.Sprintf("%03s", suffixStr)
	} else if strings.Contains(a, "beta") {
		suffixpos = strings.Index(a, "-beta")
		version = a[0:suffixpos]
		suffixStr = a[suffixpos+5 : len(a)]
		suffix = "1" + fmt.Sprintf("%03s", suffixStr)
	} else {
		version = a
		suffix = "5000"
	}
	split := strings.Split(version, ".")
	var verArr []string

	verArr = append(verArr, "1")
	var tmp string
	for i := 0; i < 3; i++ {
		if i < len(split) {
			tmp = split[i]
		} else {
			tmp = "0"
		}
		verArr = append(verArr, fmt.Sprintf("%04s", tmp))
	}
	verArr = append(verArr, suffix)

	ver := strings.Join(verArr, "")
	verNum, _ := strconv.Atoi(ver)
	return verNum
}
