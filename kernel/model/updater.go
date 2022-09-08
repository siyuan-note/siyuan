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
	"path"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/imroc/req/v3"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func GetNewVerInstallPkgPath() string {
	if !Conf.System.DownloadInstallPkg || util.ISMicrosoftStore {
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

	if !Conf.System.DownloadInstallPkg || util.ISMicrosoftStore {
		return
	}

	if util.IsMutexLocked(&checkDownloadInstallPkgLock) {
		return
	}

	checkDownloadInstallPkgLock.Lock()
	defer checkDownloadInstallPkgLock.Unlock()

	downloadPkgURL, checksum, err := getUpdatePkg()
	if nil != err {
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
	if ver == util.Ver {
		return
	}

	var suffix string
	if gulu.OS.IsWindows() {
		if "386" == runtime.GOARCH {
			suffix = "win32.exe"
		} else {
			suffix = "win.exe"
		}
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
	pkg := path.Base(pkgURL)
	savePath := filepath.Join(util.TempDir, "install", pkg)
	if gulu.File.IsExist(savePath) {
		localChecksum, _ := sha256Hash(savePath)
		if localChecksum == checksum {
			return
		}
	}

	logging.LogInfof("downloading install package [%s]", pkgURL)
	client := req.C().SetTimeout(60 * time.Minute)
	callback := func(info req.DownloadInfo) {
		//logging.LogDebugf("downloading install package [%s %.2f%%]", pkgURL, float64(info.DownloadedSize)/float64(info.Response.ContentLength)*100.0)
	}
	resp, err := client.R().SetOutputFile(savePath).SetDownloadCallback(callback).Get(pkgURL)
	if nil != err {
		logging.LogErrorf("download install package failed: %s", err)
		return
	}
	if 200 != resp.StatusCode {
		logging.LogErrorf("download install package [%s] failed [sc=%d]", pkgURL, resp.StatusCode)
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
	if ver == util.Ver {
		msg = Conf.Language(10)
		timeout = 3000
	} else {
		msg = fmt.Sprintf(Conf.Language(9), "<a href=\""+release+"\">"+release+"</a>")
		showMsg = true
		timeout = 15000
	}
	if showMsg {
		util.PushMsg(msg, timeout)
	}
}
