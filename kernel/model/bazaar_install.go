// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// Licensed under the GNU Affero General Public License, version 3 or later.

package model

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type LocalBazaarPackagePreview struct {
	PackageType       string `json:"packageType"`
	PackageName       string `json:"packageName"`
	Version           string `json:"version"`
	PackageHash       string `json:"packageHash"`
	InstalledRevision string `json:"installedRevision"`
	ConfiguredEnabled bool   `json:"configuredEnabled"`
}

// PreviewLocalBazaarPackage 在确认前只读核验归档身份和目标状态，不创建项目、解压目录或配置文件。
// 启用标志仅是观测，不证明任何前端已卸载，也不缩小安装可能执行代码的授权范围。
func PreviewLocalBazaarPackage(archivePath, expectedPackageHash string) (*LocalBazaarPackagePreview, error) {
	pkgType, pkg, hash, err := bazaar.InspectLocalPackageWithHash(archivePath, expectedPackageHash)
	if err != nil {
		return nil, err
	}
	if len(pkg.Version) > 256 {
		return nil, errors.New("invalid marketplace package version")
	}
	revision, err := GetInstalledBazaarPackageRevision(pkgType, pkg.Name)
	if err != nil {
		return nil, err
	}
	preview := &LocalBazaarPackagePreview{
		PackageType: pkgType, PackageName: pkg.Name, Version: pkg.Version, PackageHash: hash, InstalledRevision: revision,
	}
	if pkgType == "plugins" {
		preview.ConfiguredEnabled, err = readPluginEnabledForInstall(pkg.Name)
		if err != nil {
			return nil, err
		}
	}
	return preview, nil
}

// GetInstalledBazaarPackageRevision 返回代码树摘要；目标不存在时返回 missing。
func GetInstalledBazaarPackageRevision(pkgType, packageName string) (string, error) {
	installPath, _, err := getPackageInstallPath(pkgType, packageName)
	if err != nil {
		return "", err
	}
	return bazaar.InstalledPackageRevision(installPath)
}

func readPluginEnabledForInstall(packageName string) (bool, error) {
	petalsStoreLock.Lock()
	defer petalsStoreLock.Unlock()
	data, err := os.ReadFile(filepath.Join(util.DataDir, "storage", "petal", "petals.json"))
	if os.IsNotExist(err) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	var petals []struct {
		Name    string `json:"name"`
		Enabled bool   `json:"enabled"`
	}
	if err = json.Unmarshal(data, &petals); err != nil {
		return false, err
	}
	for _, petal := range petals {
		if petal.Name == packageName {
			return petal.Enabled, nil
		}
	}
	return false, nil
}
