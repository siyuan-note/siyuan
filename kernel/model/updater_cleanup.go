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
	checkDownloadInstallPkgLock.Lock()
	defer checkDownloadInstallPkgLock.Unlock()
	clearOldInstallPackagesLocked("v"+util.Ver, preservePath)
}

// clearOldInstallPackagesLocked 与下载共用互斥锁，保留当前版本及交给桌面宿主的安装包。
func clearOldInstallPackagesLocked(beforeVersion, preservePath string) {
	clearInstallPackagesBefore(filepath.Join(util.TempDir, "install"), "v"+util.Ver, beforeVersion, preservePath)
}

func clearInstallPackagesBefore(installDir, currentVersion, beforeVersion, preservePath string) {
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
		version := installPackageVersion(entry.Name())
		pkgPath := filepath.Join(installDir, entry.Name())
		if version == "" || !entry.Type().IsRegular() || pkgPath == preservePath ||
			semver.Compare(version, currentVersion) == 0 || semver.Compare(version, beforeVersion) >= 0 {
			continue
		}
		if err = os.Remove(pkgPath); err != nil && !os.IsNotExist(err) {
			logging.LogErrorf("remove old install package [%s] failed: %s", pkgPath, err)
		}
	}
}
