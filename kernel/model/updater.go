// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"html"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/imroc/req/v3"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/mod/semver"
)

func getNewVerInstallPkgPath(preserve bool) string {
	if skipNewVerInstallPkg() {
		return ""
	}

	for _, installDir := range []string{sharedInstallPackageDir(), filepath.Join(util.TempDir, "install")} {
		if path := readyInstallPackagePath(installDir, util.Ver,
			Conf.LoadSystem().UpdateChannel, currentInstallPackageSuffix(), Conf.CookieKey, preserve); path != "" {
			return path
		}
	}
	return ""
}

type installPackageDownload struct {
	Metadata installPackageMetadata
	URLs     []string
}

var checkDownloadInstallPkgLock = sync.Mutex{}
var errUpdatePackageUnavailable = errors.New("update package is unavailable")

func checkDownloadInstallPkg(notifyPackageUnavailable bool) {
	defer logging.Recover()

	if skipNewVerInstallPkg() || !Conf.LoadSystem().DownloadInstallPkg {
		return
	}

	if !checkDownloadInstallPkgLock.TryLock() {
		return
	}
	defer checkDownloadInstallPkgLock.Unlock()

	pkg, err := getUpdatePkg()
	if err != nil {
		if notifyPackageUnavailable && errors.Is(err, errUpdatePackageUnavailable) {
			if release, releaseErr := getUpdateRelease(false); nil == releaseErr && !isVersionUpToDate(release.Version) {
				pushNewVersionNotification(release)
			}
		}
		return
	}

	installUpdatePackage(pkg)
}

func installUpdatePackage(pkg *installPackageDownload) {
	existingPkgPath, err := reuseInstallPackage(sharedInstallPackageDir(), &pkg.Metadata, Conf.CookieKey)
	if err != nil {
		logging.LogErrorf("prepare existing install package failed: %s", err)
		return
	}
	if "" != existingPkgPath {
		clearOldInstallPackagesLocked(installPackageVersion(filepath.Base(existingPkgPath)), existingPkgPath)
		util.PushUpdateMsg("update-pkg-ready", Conf.Language(62), 15*1000)
		return
	}

	if err = downloadInstallPkgSources(pkg.URLs, &pkg.Metadata); err == nil {
		pkgPath := filepath.Join(sharedInstallPackageDir(), pkg.Metadata.FileName)
		clearOldInstallPackagesLocked(installPackageVersion(filepath.Base(pkgPath)), pkgPath)
		util.PushUpdateMsg("update-pkg-ready", Conf.Language(62), 15*1000)
		return
	}
	if errors.Is(err, errInstallPackageDownloadBusy) {
		util.PushUpdateMsg("update-pkg-downloading", Conf.Language(421), 7000)
		return
	}
	util.PushUpdateMsg("update-pkg-downloading", Conf.Language(104), 7000)
}

func getUpdatePkg() (ret *installPackageDownload, err error) {
	release, err := getUpdateRelease(false)
	if err != nil {
		return
	}
	return getReleaseInstallPackage(release)
}

func getReleaseInstallPackage(release *updateRelease) (ret *installPackageDownload, err error) {
	if isVersionUpToDate(release.Version) {
		err = fmt.Errorf("version is up to date")
		return
	}

	pkgName := currentInstallPackageName(release.Version)
	if "" == pkgName {
		err = fmt.Errorf("%w for the current platform", errUpdatePackageUnavailable)
		return
	}
	pkg := release.Packages[pkgName]
	if nil == pkg || 0 == len(pkg.URLs) {
		err = fmt.Errorf("%w: [%s]", errUpdatePackageUnavailable, pkgName)
		return
	}
	if "" == pkg.Checksum {
		err = fmt.Errorf("%w: [%s] checksum is unavailable", errUpdatePackageUnavailable, pkgName)
		return
	}
	ret = &installPackageDownload{
		Metadata: installPackageMetadata{
			FormatVersion: installPackageMetadataVersion,
			Version:       release.Version,
			Channel:       release.Channel,
			FileName:      pkgName,
			Checksum:      pkg.Checksum,
		},
		URLs: append([]string(nil), pkg.URLs...),
	}
	return
}

// DownloadUpdate 只下载当前通道中与通知版本一致的安装包，不修改自动下载设置。
func DownloadUpdate(version string) error {
	if skipNewVerInstallPkg() || version == "" {
		return errUpdatePackageUnavailable
	}
	release, err := getUpdateRelease(false)
	if err != nil {
		return err
	}
	if release.Version != version {
		pushNewVersionNotification(release)
		return errUpdatePackageUnavailable
	}
	pkg, err := getReleaseInstallPackage(release)
	if err != nil {
		return err
	}
	go func() {
		defer logging.Recover()
		if !checkDownloadInstallPkgLock.TryLock() {
			util.PushUpdateMsg("update-pkg-downloading", Conf.Language(421), 7000)
			return
		}
		defer checkDownloadInstallPkgLock.Unlock()
		installUpdatePackage(pkg)
	}()
	return nil
}

func downloadInstallPkg(pkgURL string, metadata *installPackageMetadata) (err error) {
	return downloadInstallPkgSources([]string{pkgURL}, metadata)
}

// downloadInstallPkgSources 在下载锁保护下并发探测各源吞吐量，让最快的源在同一个连接上继续下载。
// 探测即下载：各源都在真实读取，胜出源的探测字节直接落盘后继续读完，其余源立即断开。
// 胜出源失败时按原顺序重新完整下载，保持原有的顺序回退能力。
func downloadInstallPkgSources(urls []string, metadata *installPackageMetadata) (err error) {
	if !validInstallPackageMetadata(metadata) {
		err = errors.New("update package metadata is invalid")
		return
	}
	if 1 > len(urls) {
		err = errors.New("update package URL is invalid")
		return
	}
	for _, pkgURL := range urls {
		if "" == pkgURL {
			err = errors.New("update package URL is invalid")
			return
		}
	}

	installDir := sharedInstallPackageDir()
	lock, err := tryInstallPackageDownloadLock(installDir)
	if err != nil {
		return err
	}
	defer lock.Close()
	if existingPath, reuseErr := reuseInstallPackage(installDir, metadata, Conf.CookieKey); reuseErr != nil || existingPath != "" {
		return reuseErr
	}
	if err = copyLegacyInstallPackage(filepath.Join(util.TempDir, "install"), installDir, metadata, Conf.CookieKey); err != nil {
		return err
	}
	if existingPath, reuseErr := reuseInstallPackage(installDir, metadata, Conf.CookieKey); reuseErr != nil || existingPath != "" {
		return reuseErr
	}

	// 探测阶段也在真实下载，先提示用户，避免这段时间看起来没有反应
	util.PushUpdateMsg("update-pkg-downloading", Conf.Language(103), 7000)
	if 2 > len(urls) {
		if err = downloadInstallPkgURL(urls[0], installDir, metadata); nil == err {
			logging.LogInfof("downloaded install package [%s]", urls[0])
			util.PushStatusBar(Conf.Language(62))
		}
		return
	}

	if probeErr := probeAndDownloadInstallPkg(installDir, urls, metadata); nil != probeErr {
		logging.LogWarnf("download install package from the fastest source failed: %s", probeErr)
		if errors.Is(probeErr, errNoUsableInstallPkgSource) {
			// 探测阶段每个源都拿不到可用连接，逐个重试不会改善
			err = probeErr
			return
		}
		for _, pkgURL := range urls {
			if err = downloadInstallPkgURL(pkgURL, installDir, metadata); nil == err {
				logging.LogInfof("downloaded install package [%s]", pkgURL)
				util.PushStatusBar(Conf.Language(62))
				return nil
			}
			logging.LogErrorf("download install package [%s] failed: %s", pkgURL, err)
		}
		return
	}
	util.PushStatusBar(Conf.Language(62))
	return nil
}

// downloadInstallPkgURL 从单个源完整下载并发布安装包，调用方需持有下载锁。
func downloadInstallPkgURL(pkgURL, installDir string, metadata *installPackageMetadata) (err error) {
	pkg := metadata.FileName
	savePath := filepath.Join(installDir, pkg)
	temporaryFile, err := os.CreateTemp(installDir, pkg+".*.part")
	if err != nil {
		logging.LogErrorf("create temporary install package failed: %s", err)
		return
	}
	temporaryPath := temporaryFile.Name()
	defer func() {
		if removeErr := os.Remove(temporaryPath); removeErr != nil && !os.IsNotExist(removeErr) {
			logging.LogErrorf("remove incomplete install package [%s] failed: %s", temporaryPath, removeErr)
		}
	}()
	if err = temporaryFile.Close(); err != nil {
		return
	}

	logging.LogInfof("downloading install package [%s]", pkgURL)
	client := req.C().SetTLSHandshakeTimeout(7 * time.Second).SetTimeout(10 * time.Minute).DisableInsecureSkipVerify().SetUserAgent(util.UserAgent)
	callback := func(info req.DownloadInfo) {
		progress := fmt.Sprintf("%.2f%%", float64(info.DownloadedSize)/float64(info.Response.ContentLength)*100.0)
		// logging.LogDebugf("downloading install package [%s %s]", pkgURL, progress)
		util.PushStatusBar(fmt.Sprintf(Conf.Language(133), progress))
	}
	_, err = client.R().SetOutputFile(temporaryPath).SetDownloadCallbackWithInterval(callback, 1*time.Second).Get(pkgURL)
	if err != nil {
		logging.LogErrorf("download install package [%s] failed: %s", pkgURL, err)
		return
	}

	if err = verifyAndPublishInstallPkg(installDir, temporaryPath, metadata); err != nil {
		logging.LogErrorf("publish install package [%s] failed: %s", pkgURL, err)
		return
	}
	logging.LogInfof("downloaded install package [%s] to [%s]", pkgURL, savePath)
	return
}

func sha256Hash(filename string) (ret string, err error) {
	file, err := os.Open(filename)
	if err != nil {
		return
	}
	defer file.Close()

	hash := sha256.New()
	if _, err = io.Copy(hash, file); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", hash.Sum(nil)), nil
}

type Announcement struct {
	Id     string `json:"id"`
	Title  string `json:"title"`
	URL    string `json:"url"`
	Region int    `json:"region"`
}

func getAnnouncements() (ret []*Announcement) {
	result, err := util.GetRhyResult(context.TODO(), false)
	if err != nil {
		logging.LogErrorf("get announcement failed: %s", err)
		return
	}

	if nil == result["announcement"] {
		return
	}

	announcements := result["announcement"].([]any)
	for _, announcement := range announcements {
		ann := announcement.(map[string]any)
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

	if Conf.System.Load().IsMicrosoftStore {
		return
	}

	release, err := getUpdateRelease(showMsg)
	if err != nil {
		return
	}

	if isVersionUpToDate(release.Version) {
		util.PushUpdateMsg("update-notify", Conf.Language(10), 3000)
	} else {
		pushNewVersionNotification(release)
	}
	go func() {
		defer logging.Recover()
		checkDownloadInstallPkg(false)
	}()
}

func pushNewVersionNotification(release *updateRelease) {
	releaseLink := "<a href=\"" + release.ReleaseURL + "\">" + release.ReleaseURL + "</a>"
	message := fmt.Sprintf(Conf.Language(9), releaseLink)
	if !skipNewVerInstallPkg() {
		if _, err := getReleaseInstallPackage(release); err == nil {
			message += fmt.Sprintf(` <button type="button" class="b3-button b3-button--white" data-type="download-update" data-version="%s">%s</button>`,
				html.EscapeString(release.Version), html.EscapeString(Conf.Language(437)))
		}
	}
	util.PushUpdateMsg("update-notify", message, 15000)
}

func isVersionUpToDate(releaseVer string) bool {
	return semver.Compare("v"+releaseVer, "v"+util.Ver) <= 0
}

// skipInstallPkgPlatformCached 缓存平台相关判断，-1 未初始化，0 表示不跳过，1 表示跳过
var skipInstallPkgPlatformCached = -1

func skipNewVerInstallPkg() bool {
	confSystemSnapshot := Conf.LoadSystem()

	if skipInstallPkgPlatformCached == -1 {
		skipInstallPkgPlatformCached = 0
		if !gulu.OS.IsWindows() && !gulu.OS.IsDarwin() {
			skipInstallPkgPlatformCached = 1
		} else if util.ISMicrosoftStore || util.ContainerStd != util.Container {
			skipInstallPkgPlatformCached = 1
		} else if gulu.OS.IsWindows() {
			plat := strings.ToLower(confSystemSnapshot.OSPlatform)
			// Windows 7, 8 and Server 2012 are no longer supported https://github.com/siyuan-note/siyuan/issues/7347
			if strings.Contains(plat, " 7 ") || strings.Contains(plat, " 8 ") || strings.Contains(plat, "2012") {
				skipInstallPkgPlatformCached = 1
			}
		}
	}

	if skipInstallPkgPlatformCached == 1 {
		return true
	}
	return false
}
