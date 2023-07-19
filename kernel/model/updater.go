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
	}
	gulu.CmdAttr(cmd)
	cmdErr := cmd.Run()
	if nil != cmdErr {
		logging.LogErrorf("exec install new version failed: %s", cmdErr)
		return
	}
}

func getNewVerInstallPkgPath() string {
	if skipNewVerInstallPkg() {
		return ""
	}

	downloadPkgURLs, checksum, err := getUpdatePkg()
	if nil != err || 1 > len(downloadPkgURLs) || "" == checksum {
		return ""
	}

	pkg := path.Base(downloadPkgURLs[0])
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

	downloadPkgURLs, checksum, err := getUpdatePkg()
	if nil != err || 1 > len(downloadPkgURLs) || "" == checksum {
		return
	}

	msgId := util.PushMsg(Conf.Language(103), 1000*7)
	succ := false
	for _, downloadPkgURL := range downloadPkgURLs {
		err = downloadInstallPkg(downloadPkgURL, checksum)
		if nil == err {
			succ = true
			break

		}
	}
	if !succ {
		util.PushUpdateMsg(msgId, Conf.Language(104), 7000)
	}
}

func getUpdatePkg() (downloadPkgURLs []string, checksum string, err error) {
	defer logging.Recover()
	result, err := util.GetRhyResult(false)
	if nil != err {
		return
	}

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
	}
	pkg := "siyuan-" + ver + "-" + suffix

	b3logURL := "https://release.b3log.org/siyuan/" + pkg
	downloadPkgURLs = append(downloadPkgURLs, b3logURL)
	githubURL := "https://github.com/siyuan-note/siyuan/releases/download/v" + ver + "/" + pkg
	ghproxyURL := "https://ghproxy.com/" + githubURL
	downloadPkgURLs = append(downloadPkgURLs, ghproxyURL)
	downloadPkgURLs = append(downloadPkgURLs, githubURL)

	checksums := result["checksums"].(map[string]interface{})
	checksum = checksums[pkg].(string)
	return
}

func downloadInstallPkg(pkgURL, checksum string) (err error) {
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

	err = os.MkdirAll(filepath.Join(util.TempDir, "install"), 0755)
	if nil != err {
		logging.LogErrorf("create temp install dir failed: %s", err)
		return
	}

	logging.LogInfof("downloading install package [%s]", pkgURL)
	client := req.C().SetTLSHandshakeTimeout(7 * time.Second).SetTimeout(10 * time.Minute).DisableInsecureSkipVerify()
	callback := func(info req.DownloadInfo) {
		progress := fmt.Sprintf("%.2f%%", float64(info.DownloadedSize)/float64(info.Response.ContentLength)*100.0)
		// logging.LogDebugf("downloading install package [%s %s]", pkgURL, progress)
		util.PushStatusBar(fmt.Sprintf(Conf.Language(133), progress))
	}
	_, err = client.R().SetOutputFile(savePath).SetDownloadCallbackWithInterval(callback, 1*time.Second).Get(pkgURL)
	if nil != err {
		logging.LogErrorf("download install package [%s] failed: %s", pkgURL, err)
		return
	}

	localChecksum, _ := sha256Hash(savePath)
	if checksum != localChecksum {
		logging.LogErrorf("verify checksum failed, download install package [%s] checksum [%s] not equal to downloaded [%s] checksum [%s]", pkgURL, checksum, savePath, localChecksum)
		return
	}
	logging.LogInfof("downloaded install package [%s] to [%s]", pkgURL, savePath)
	util.PushStatusBar(Conf.Language(62))
	return
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
	Id     string `json:"id"`
	Title  string `json:"title"`
	URL    string `json:"url"`
	Region int    `json:"region"`
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
			Id:     ann["id"].(string),
			Title:  ann["title"].(string),
			URL:    ann["url"].(string),
			Region: int(ann["region"].(float64)),
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
	releaseLang := result["release"].(string)
	if releaseLangArg := result["release_"+Conf.Lang]; nil != releaseLangArg {
		releaseLang = releaseLangArg.(string)
	}

	var msg string
	var timeout int
	if isVersionUpToDate(ver) {
		msg = Conf.Language(10)
		timeout = 3000
	} else {
		msg = fmt.Sprintf(Conf.Language(9), "<a href=\""+releaseLang+"\">"+releaseLang+"</a>")
		showMsg = true
		timeout = 15000
	}
	if showMsg {
		util.PushMsg(msg, timeout)
		go func() {
			defer logging.Recover()
			checkDownloadInstallPkg()
			if "" != getNewVerInstallPkgPath() {
				util.PushMsg(Conf.Language(62), 15*1000)
			}
		}()
	}
}

func isVersionUpToDate(releaseVer string) bool {
	return ver2num(releaseVer) <= ver2num(util.Ver)
}

func skipNewVerInstallPkg() bool {
	if !gulu.OS.IsWindows() && !gulu.OS.IsDarwin() {
		return true
	}
	if util.ISMicrosoftStore || util.ContainerStd != util.Container {
		return true
	}
	if !Conf.System.DownloadInstallPkg {
		return true
	}
	if gulu.OS.IsWindows() {
		plat := strings.ToLower(Conf.System.OSPlatform)
		// Windows 7, 8 and Server 2012 are no longer supported https://github.com/siyuan-note/siyuan/issues/7347
		if strings.Contains(plat, " 7 ") || strings.Contains(plat, " 8 ") || strings.Contains(plat, "2012") {
			return true
		}
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
