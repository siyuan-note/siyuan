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
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/imroc/req/v3"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/mod/semver"
)

func execNewVerInstallPkg(newVerInstallPkgPath string) {
	logging.LogInfof("installing the new version [%s]", newVerInstallPkgPath)
	var cmd *exec.Cmd
	if gulu.OS.IsWindows() {
		cmd = exec.Command(newVerInstallPkgPath)
	} else if gulu.OS.IsDarwin() {
		exec.Command("chmod", "+x", newVerInstallPkgPath).CombinedOutput()
		cmd = exec.Command("open", newVerInstallPkgPath)
	} else {
		logging.LogErrorf("unsupported platform for auto-installing package")
		return
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
	if err != nil {
		return ""
	}

	pkg := path.Base(downloadPkgURLs[0])
	pkgPath := filepath.Join(util.TempDir, "install", pkg)
	localChecksum, _ := sha256Hash(pkgPath)
	if checksum != localChecksum {
		return ""
	}
	return pkgPath
}

var checkDownloadInstallPkgLock = sync.Mutex{}

func checkDownloadInstallPkg() {
	defer logging.Recover()

	if skipNewVerInstallPkg() {
		return
	}

	if !checkDownloadInstallPkgLock.TryLock() {
		return
	}
	defer checkDownloadInstallPkgLock.Unlock()

	downloadPkgURLs, checksum, err := getUpdatePkg()
	if err != nil {
		return
	}

	existingPkgPath := getNewVerInstallPkgPath()
	if "" != existingPkgPath {
		// 存在经过 sha256Hash 检查的安装包
		util.PushUpdateMsg("update-pkg-ready", Conf.Language(62), 15*1000)
		return
	}

	util.PushUpdateMsg("update-pkg-downloading", Conf.Language(103), 1000*7)
	success := false
	for _, downloadPkgURL := range downloadPkgURLs {
		err = downloadInstallPkg(downloadPkgURL, checksum)
		if err == nil {
			success = true
			break
		}
	}
	if success {
		util.PushUpdateMsg("update-pkg-ready", Conf.Language(62), 15*1000)
	} else {
		util.PushUpdateMsg("update-pkg-downloading", Conf.Language(104), 7000)
	}
}

func getUpdatePkg() (downloadPkgURLs []string, checksum string, err error) {
	defer logging.Recover()
	result, err := util.GetRhyResult(false)
	if err != nil {
		return
	}

	ver := result["ver"].(string)
	if isVersionUpToDate(ver) {
		err = fmt.Errorf("version is up to date")
		return
	}

	var suffix string
	if gulu.OS.IsWindows() {
		if "arm64" == runtime.GOARCH {
			suffix = "win-arm64.exe"
		} else {
			suffix = "win.exe"
		}
	} else if gulu.OS.IsDarwin() {
		if "arm64" == runtime.GOARCH {
			suffix = "mac-arm64.dmg"
		} else {
			suffix = "mac.dmg"
		}
	}
	pkg := "siyuan-" + ver + "-" + suffix

	b3logURL := "https://release.b3log.org/siyuan/" + pkg
	liuyunURL := "https://release.liuyun.io/siyuan/" + pkg
	githubURL := "https://github.com/siyuan-note/siyuan/releases/download/v" + ver + "/" + pkg
	ghproxyURL := "https://ghfast.top/" + githubURL
	if util.IsChinaCloud() {
		downloadPkgURLs = append(downloadPkgURLs, b3logURL)
		downloadPkgURLs = append(downloadPkgURLs, liuyunURL)
		downloadPkgURLs = append(downloadPkgURLs, ghproxyURL)
		downloadPkgURLs = append(downloadPkgURLs, githubURL)
	} else {
		downloadPkgURLs = append(downloadPkgURLs, b3logURL)
		downloadPkgURLs = append(downloadPkgURLs, liuyunURL)
		downloadPkgURLs = append(downloadPkgURLs, githubURL)
		downloadPkgURLs = append(downloadPkgURLs, ghproxyURL)
	}

	checksums := result["checksums"].(map[string]interface{})
	checksum = checksums[pkg].(string)

	if "" == checksum {
		err = fmt.Errorf("checksum is empty")
		return
	}
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
	if err != nil {
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
	if err != nil {
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
	if err != nil {
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

func getAnnouncements() (ret []*Announcement) {
	result, err := util.GetRhyResult(false)
	if err != nil {
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

	if Conf.System.IsMicrosoftStore {
		return
	}

	result, err := util.GetRhyResult(showMsg)
	if err != nil {
		return
	}

	ver := result["ver"].(string)
	releaseLang := result["release"].(string)
	if releaseLangArg := result["release_"+Conf.Lang]; nil != releaseLangArg {
		releaseLang = releaseLangArg.(string)
	}

	if isVersionUpToDate(ver) {
		util.PushUpdateMsg("update-notify", Conf.Language(10), 3000)
	} else {
		util.PushUpdateMsg("update-notify", fmt.Sprintf(Conf.Language(9), "<a href=\""+releaseLang+"\">"+releaseLang+"</a>"), 15000)
	}
	go func() {
		defer logging.Recover()
		checkDownloadInstallPkg()
	}()
}

func isVersionUpToDate(releaseVer string) bool {
	return semver.Compare("v"+releaseVer, "v"+util.Ver) <= 0
}

// skipInstallPkgPlatformCached 缓存平台相关判断，-1 未初始化，0 表示不跳过，1 表示跳过
var skipInstallPkgPlatformCached = -1

func skipNewVerInstallPkg() bool {
	if skipInstallPkgPlatformCached == -1 {
		skipInstallPkgPlatformCached = 0
		if !gulu.OS.IsWindows() && !gulu.OS.IsDarwin() {
			skipInstallPkgPlatformCached = 1
		} else if util.ISMicrosoftStore || util.ContainerStd != util.Container {
			skipInstallPkgPlatformCached = 1
		} else if gulu.OS.IsWindows() {
			plat := strings.ToLower(Conf.System.OSPlatform)
			// Windows 7, 8 and Server 2012 are no longer supported https://github.com/siyuan-note/siyuan/issues/7347
			if strings.Contains(plat, " 7 ") || strings.Contains(plat, " 8 ") || strings.Contains(plat, "2012") {
				skipInstallPkgPlatformCached = 1
			}
		}
	}

	if skipInstallPkgPlatformCached == 1 || !Conf.System.DownloadInstallPkg {
		return true
	}
	return false
}
