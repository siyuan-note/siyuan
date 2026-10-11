package model

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/mod/semver"
)

// installPackageVersion 仅识别桌面端自动下载的安装包名称。
func installPackageVersion(name string) string {
	if !strings.HasPrefix(name, "siyuan-") {
		return ""
	}
	for _, suffix := range []string{"-win.exe", "-win-arm64.exe", "-mac.dmg", "-mac-arm64.dmg"} {
		if strings.HasSuffix(name, suffix) {
			version := "v" + strings.TrimSuffix(strings.TrimPrefix(name, "siyuan-"), suffix)
			if semver.IsValid(version) {
				return version
			}
		}
	}
	return ""
}

func clearOldInstallPackages(preservePath string) {
	// 退出时不等待正在下载的安装包，下载完成或下次启动时仍会清理旧包。
	if util.IsExiting.Load() {
		if !checkDownloadInstallPkgLock.TryLock() {
			return
		}
	} else {
		checkDownloadInstallPkgLock.Lock()
	}
	defer checkDownloadInstallPkgLock.Unlock()
	clearOldInstallPackagesLocked("v"+util.Ver, preservePath)
}

// clearOldInstallPackagesLocked 与下载共用互斥锁，保留当前版本及交给桌面宿主的安装包。
// 调用方持有下载锁，清理时不会有正在写入的临时安装包。
func clearOldInstallPackagesLocked(beforeVersion, preservePath string) {
	clearInstallPackagesBefore(filepath.Join(util.TempDir, "install"), "v"+util.Ver, beforeVersion, preservePath)
}

func clearInstallPackagesBefore(installDir, currentVersion, beforeVersion, preservePath string) {
	installPackageFiles.Lock()
	defer installPackageFiles.Unlock()

	if !semver.IsValid(beforeVersion) || !semver.IsValid(currentVersion) {
		return
	}
	entries, err := os.ReadDir(installDir)
	if os.IsNotExist(err) {
		return
	}
	if err != nil {
		logging.LogErrorf("read install directory [%s] failed: %s", installDir, err)
		return
	}
	for _, entry := range entries {
		if entry.Type().IsRegular() && isTemporaryInstallPackage(entry.Name()) {
			// 上次进程在下载期间退出时不会执行 defer，由下次启动或下载完成时回收。
			path := filepath.Join(installDir, entry.Name())
			if err = os.Remove(path); err != nil && !os.IsNotExist(err) {
				logging.LogErrorf("remove incomplete install package [%s] failed: %s", path, err)
			}
			continue
		}
		packageName := strings.TrimSuffix(entry.Name(), ".json")
		version := installPackageVersion(packageName)
		pkgPath := filepath.Join(installDir, entry.Name())
		if version == "" || !entry.Type().IsRegular() || filepath.Join(installDir, packageName) == preservePath ||
			filepath.Join(installDir, packageName) == installPackageFiles.preservedPath ||
			semver.Compare(version, currentVersion) == 0 || semver.Compare(version, beforeVersion) >= 0 {
			continue
		}
		if err = os.Remove(pkgPath); err != nil && !os.IsNotExist(err) {
			logging.LogErrorf("remove old install package [%s] failed: %s", pkgPath, err)
		}
	}
}

func isTemporaryInstallPackage(name string) bool {
	if !strings.HasSuffix(name, ".part") {
		return false
	}
	name = strings.TrimSuffix(name, ".part")
	separator := strings.LastIndexByte(name, '.')
	if separator < 0 || installPackageVersion(name[:separator]) == "" {
		return false
	}
	random := name[separator+1:]
	return random != "" && strings.Trim(random, "0123456789") == ""
}
