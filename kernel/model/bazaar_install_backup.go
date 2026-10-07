// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// Licensed under the GNU Affero General Public License, version 3 or later.

package model

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"github.com/emirpasic/gods/sets/hashset"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const installCodeBackupWarning = "The recovery copy contains plugin code only; runtime data, workspace configuration and credentials are not backed up or restored."
const installRestoreWarning = "The restored plugin is configured disabled. A disable notification does not acknowledge unload in every frontend; old code may still be running."

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

// PreviewLocalBazaarRestore 保持恢复归档路径私有，供确认卡只读获取待恢复制品和当前目标状态。
func PreviewLocalBazaarRestore(backupID, expectedPackageHash string) (*LocalBazaarPackagePreview, error) {
	backup, archivePath, err := bazaar.ReadInstallBackup(bazaar.DefaultInstallBackupRoot(), backupID)
	if err != nil {
		return nil, err
	}
	if expectedPackageHash != "" && expectedPackageHash != backup.PackageHash {
		return nil, bazaar.ErrPackageHashConflict
	}
	preview, err := PreviewLocalBazaarPackage(archivePath, backup.PackageHash)
	if err != nil {
		return nil, err
	}
	if preview.PackageType != "plugins" || preview.PackageName != backup.PackageName {
		return nil, errors.New("install backup package identity mismatch")
	}
	return preview, nil
}

func bazaarInstallOptions(pkgType, packageName, expectedRevision string) (bazaar.PackageInstallOptions, error) {
	options := bazaar.PackageInstallOptions{
		ExpectedInstalledRevision: expectedRevision, PackageType: pkgType, PackageName: packageName,
	}
	if pkgType == "plugins" {
		options.BackupRoot = bazaar.DefaultInstallBackupRoot()
		if options.BackupRoot == "" {
			return options, errors.New("backup_failed: private install backup root is unavailable")
		}
		options.PriorEnabled = func() (bool, error) { return readPluginEnabledForInstall(packageName) }
	}
	return options, nil
}

// GetInstalledBazaarPackageRevision 返回代码树摘要；目标不存在时返回 missing。
func GetInstalledBazaarPackageRevision(pkgType, packageName string) (string, error) {
	installPath, _, err := getPackageInstallPath(pkgType, packageName)
	if err != nil {
		return "", err
	}
	return bazaar.InstalledPackageRevision(installPath)
}

func GetLocalBazaarInstallBackup(backupID string) (*bazaar.InstallBackupInfo, error) {
	backup, _, err := bazaar.ReadInstallBackup(bazaar.DefaultInstallBackupRoot(), backupID)
	return backup, err
}

func ListLocalBazaarInstallBackups(packageName string) ([]*bazaar.InstallBackupInfo, error) {
	return bazaar.ListInstallBackups(bazaar.DefaultInstallBackupRoot(), packageName)
}

// RestoreLocalBazaarPackage 只通过正常安装器恢复代码，并绑定当前目标版本，保持插件禁用。
// 工具层必须在调用前确认可能仍在运行的旧代码和此次恢复的具体制品。
func RestoreLocalBazaarPackage(backupID, frontend, expectedInstalledRevision string, expectedPackageHash ...string) (*LocalBazaarPackageInstallResult, error) {
	if expectedInstalledRevision == "" {
		return nil, errors.New("expectedInstalledRevision is required for restore")
	}
	backup, archivePath, err := bazaar.ReadInstallBackup(bazaar.DefaultInstallBackupRoot(), backupID)
	if err != nil {
		return nil, err
	}
	if len(expectedPackageHash) > 1 || (len(expectedPackageHash) == 1 && (expectedPackageHash[0] == "" || expectedPackageHash[0] != backup.PackageHash)) {
		return nil, bazaar.ErrPackageHashConflict
	}
	return InstallLocalBazaarPackageWithOptions(archivePath, frontend, true, LocalBazaarInstallOptions{
		ExpectedPackageHash: backup.PackageHash, ExpectedInstalledRevision: expectedInstalledRevision, restoreBackup: backup,
	})
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

func disablePluginForRestore(packageName string, installed bool) error {
	if installed {
		if _, err := SetPetalEnabled(packageName, false); err != nil {
			return err
		}
		PushReloadPlugin(nil, hashset.New(packageName), nil, nil, "", "")
		return nil
	}
	_, err := updatePetal(packageName, func(petal *Petal) error {
		petal.Enabled = false
		return nil
	})
	return err
}
