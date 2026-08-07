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
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/88250/gulu"
	"github.com/emirpasic/gods/sets/hashset"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/mod/semver"
	"golang.org/x/sync/singleflight"
)

// installedPackageInfo 描述了本地集市包的包与目录名信息
type installedPackageInfo struct {
	Pkg     *bazaar.Package
	DirName string
}

// UpdatedPackage 描述本地已安装包及其在线可用更新
type UpdatedPackage struct {
	Installed *bazaar.Package `json:"installed"`
	Available *bazaar.Package `json:"available"`
}

var reservedPackageNames = map[string]bool{
	"CON": true, "PRN": true, "AUX": true, "NUL": true,
	"COM1": true, "COM2": true, "COM3": true, "COM4": true, "COM5": true,
	"COM6": true, "COM7": true, "COM8": true, "COM9": true,
	"LPT1": true, "LPT2": true, "LPT3": true, "LPT4": true, "LPT5": true,
	"LPT6": true, "LPT7": true, "LPT8": true, "LPT9": true,
}

func isValidPackageName(packageName string) bool {
	if len(packageName) < 1 || len(packageName) > 255 || packageName[0] == '.' || packageName[0] == ' ' ||
		packageName[len(packageName)-1] == '.' || packageName[len(packageName)-1] == ' ' || strings.Contains(packageName, "..") {
		return false
	}
	for _, char := range []byte(packageName) {
		if char < 0x20 || char > 0x7E || strings.ContainsRune(`<>&'":/\|?*`, rune(char)) {
			return false
		}
	}
	return !reservedPackageNames[strings.ToUpper(packageName)]
}

func getPackageInstallPath(pkgType, packageName string) (string, string, error) {
	// 校验包名必须是合法的目录名，不能包含路径分隔符或 ..，防止路径遍历
	// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-wr4w-7vjm-mmx3
	if !isValidPackageName(packageName) {
		return "", "", errors.New("invalid package name")
	}

	var baseDir, jsonFileName string
	switch pkgType {
	case "plugins":
		baseDir, jsonFileName = filepath.Join(util.DataDir, "plugins"), "plugin.json"
	case "themes":
		baseDir, jsonFileName = util.ThemesPath, "theme.json"
	case "icons":
		baseDir, jsonFileName = util.IconsPath, "icon.json"
	case "templates":
		baseDir, jsonFileName = filepath.Join(util.DataDir, "templates"), "template.json"
	case "widgets":
		baseDir, jsonFileName = filepath.Join(util.DataDir, "widgets"), "widget.json"
	default:
		logging.LogErrorf("invalid package type: %s", pkgType)
		return "", "", errors.New("invalid package type")
	}

	installPath := filepath.Join(baseDir, packageName)
	if !gulu.File.IsSubPath(baseDir, installPath) {
		return "", "", errors.New("invalid package name")
	}
	return installPath, jsonFileName, nil
}

// installMeta 记录安装前后的状态，供安装后处理使用
type installMeta struct {
	update bool
}

// batchInstallItem 同类型批量安装时单个包的结果
type batchInstallItem struct {
	name string
	meta installMeta
}

// ThemeInstallOptions 描述新安装主题后需要应用的外观模式
type ThemeInstallOptions struct {
	Mode   int
	ModeOS bool
}

// LocalBazaarPackageInstallResult 描述本地集市包的识别和安装结果。
type LocalBazaarPackageInstallResult struct {
	PackageType   string `json:"packageType"`
	PackageName   string `json:"packageName"`
	MinAppVersion string `json:"minAppVersion,omitempty"`
	Updated       bool   `json:"updated"`
}

var (
	ErrLocalBazaarPackageExists       = errors.New("marketplace package already exists")
	ErrLocalBazaarPackageIncompatible = errors.New("marketplace package is incompatible")
	localBazaarInstallLock            sync.Mutex
)

// updatePackages 更新一组集市包；同类型批量更新时，安装后处理只执行一次
func updatePackages(packages []*UpdatedPackage, pkgType string, successCount, failedCount *int, planned int) {
	items := make([]batchInstallItem, 0, len(packages))
	for _, updated := range packages {
		pkg := updated.Available
		meta, err := installBazaarPackage(pkgType, pkg.RepoURL, pkg.RepoHash, pkg.Name)
		if err != nil {
			logging.LogErrorf("update %s [%s] failed: %s", pkgType, pkg.Name, err)
			util.PushErrMsg(fmt.Sprintf(Conf.language(238), pkg.Name), 5000)
			*failedCount++
			continue
		}
		items = append(items, batchInstallItem{name: pkg.Name, meta: meta})
		*successCount++
		util.PushEndlessProgress(fmt.Sprintf(Conf.language(236), *successCount+*failedCount, planned, pkg.Name))
	}
	finishInstall(pkgType, items, nil, true)
}

// filterUpdatableBazaarPackages 过滤出允许更新的集市包
func filterUpdatableBazaarPackages(packages []*UpdatedPackage) (updatable []*UpdatedPackage, unmetRequirementCount int) {
	updatable = make([]*UpdatedPackage, 0, len(packages))
	for _, updated := range packages {
		if updated.Available != nil && !updated.Available.DisallowUpdate {
			updatable = append(updatable, updated)
		} else {
			unmetRequirementCount++
		}
	}
	return
}

// BatchUpdatePackages 更新所有集市包
func BatchUpdatePackages(frontend string) error {
	plugins, widgets, icons, themes, templates, err := GetUpdatedPackages(frontend)
	if err != nil {
		return err
	}
	unmetRequirementCount := 0
	var count int
	plugins, count = filterUpdatableBazaarPackages(plugins)
	unmetRequirementCount += count
	widgets, count = filterUpdatableBazaarPackages(widgets)
	unmetRequirementCount += count
	icons, count = filterUpdatableBazaarPackages(icons)
	unmetRequirementCount += count
	themes, count = filterUpdatableBazaarPackages(themes)
	unmetRequirementCount += count
	templates, count = filterUpdatableBazaarPackages(templates)
	unmetRequirementCount += count

	planned := len(plugins) + len(widgets) + len(icons) + len(themes) + len(templates)
	if 1 > planned {
		return nil
	}

	defer util.PushClearProgress()
	successCount := 0
	failedCount := 0
	updatePackages(plugins, "plugins", &successCount, &failedCount, planned)
	updatePackages(themes, "themes", &successCount, &failedCount, planned)
	updatePackages(icons, "icons", &successCount, &failedCount, planned)
	updatePackages(templates, "templates", &successCount, &failedCount, planned)
	updatePackages(widgets, "widgets", &successCount, &failedCount, planned)

	util.PushMsg(fmt.Sprintf(Conf.language(237), successCount, failedCount, unmetRequirementCount), 5000)
	return nil
}

// GetUpdatedPackages 获取所有类型集市包的更新列表
//
//   - frontend 仅用于插件和主题环境兼容性判断
func GetUpdatedPackages(frontend string) (plugins, widgets, icons, themes, templates []*UpdatedPackage, err error) {
	wg := &sync.WaitGroup{}
	errs := make([]error, 5)

	wg.Go(func() {
		plugins, errs[0] = getUpdatedPackages("plugins", frontend)
	})
	wg.Go(func() {
		themes, errs[1] = getUpdatedPackages("themes", frontend)
	})
	wg.Go(func() {
		icons, errs[2] = getUpdatedPackages("icons", "")
	})
	wg.Go(func() {
		templates, errs[3] = getUpdatedPackages("templates", "")
	})
	wg.Go(func() {
		widgets, errs[4] = getUpdatedPackages("widgets", "")
	})

	wg.Wait()
	err = errors.Join(errs...)
	return
}

// getUpdatedPackages 获取单个类型集市包的更新列表
func getUpdatedPackages(pkgType, frontend string) (updatedPackages []*UpdatedPackage, err error) {
	installedPackages := GetInstalledPackages(pkgType, frontend, "")
	updatedPackages = []*UpdatedPackage{}
	if len(installedPackages) == 0 {
		return
	}

	bazaarPackagesMap, err := bazaar.GetBazaarPackagesMap(pkgType, frontend)
	if err != nil {
		return
	}
	updatedPackages = buildUpdatedPackages(installedPackages, bazaarPackagesMap)
	return
}

func buildUpdatedPackages(installedPackages []*bazaar.Package, bazaarPackagesMap map[string]*bazaar.Package) (updatedPackages []*UpdatedPackage) {
	updatedPackages = []*UpdatedPackage{}
	for _, installed := range installedPackages {
		online := bazaarPackagesMap[installed.Name]
		if online == nil || 0 <= semver.Compare("v"+installed.Version, "v"+online.Version) {
			continue
		}
		available := *online
		available.Installed = true
		available.Outdated = true
		available.Current = installed.Current
		updatedPackages = append(updatedPackages, &UpdatedPackage{
			Installed: installed,
			Available: &available,
		})
	}
	return
}

// GetInstalledPackageInfos 获取本地集市包信息，并返回路径相关字段供调用方复用
func GetInstalledPackageInfos(pkgType string) (installedPackageInfos []installedPackageInfo, basePath, baseURLPathPrefix string, err error) {
	var jsonFileName string
	switch pkgType {
	case "plugins":
		basePath, jsonFileName, baseURLPathPrefix = filepath.Join(util.DataDir, "plugins"), "plugin.json", "/plugins/"
	case "themes":
		basePath, jsonFileName, baseURLPathPrefix = util.ThemesPath, "theme.json", "/appearance/themes/"
	case "icons":
		basePath, jsonFileName, baseURLPathPrefix = util.IconsPath, "icon.json", "/appearance/icons/"
	case "templates":
		basePath, jsonFileName, baseURLPathPrefix = filepath.Join(util.DataDir, "templates"), "template.json", "/templates/"
	case "widgets":
		basePath, jsonFileName, baseURLPathPrefix = filepath.Join(util.DataDir, "widgets"), "widget.json", "/widgets/"
	default:
		logging.LogErrorf("invalid package type: %s", pkgType)
		err = errors.New("invalid package type")
		return
	}

	dirs, err := bazaar.ReadInstalledPackageDirs(basePath)
	if err != nil {
		logging.LogWarnf("read %s folder failed: %s", pkgType, err)
		return
	}
	if len(dirs) == 0 {
		return
	}

	// 过滤内置包
	switch pkgType {
	case "themes":
		filtered := make([]os.DirEntry, 0, len(dirs))
		for _, d := range dirs {
			if isBuiltInTheme(d.Name()) {
				continue
			}
			filtered = append(filtered, d)
		}
		dirs = filtered
	case "icons":
		filtered := make([]os.DirEntry, 0, len(dirs))
		for _, d := range dirs {
			if isBuiltInIcon(d.Name()) {
				continue
			}
			filtered = append(filtered, d)
		}
		dirs = filtered
	}

	for _, dir := range dirs {
		dirName := dir.Name()
		pkg, parseErr := bazaar.ParsePackageJSON(filepath.Join(basePath, dirName, jsonFileName))
		if nil != parseErr || nil == pkg {
			continue
		}
		installedPackageInfos = append(installedPackageInfos, installedPackageInfo{Pkg: pkg, DirName: dirName})
	}
	return
}

var getInstalledPackagesFlight singleflight.Group

// GetInstalledPackages 获取本地集市包列表
func GetInstalledPackages(pkgType, frontend, keyword string) (installedPackages []*bazaar.Package) {
	key := "getInstalledPackages:" + pkgType + ":" + frontend + ":" + keyword
	v, err, _ := getInstalledPackagesFlight.Do(key, func() (any, error) {
		return getInstalledPackages0(pkgType, frontend, keyword), nil
	})
	if err != nil {
		return []*bazaar.Package{}
	}
	return v.([]*bazaar.Package)
}

func getInstalledPackages0(pkgType, frontend, keyword string) (installedPackages []*bazaar.Package) {
	installedPackages = []*bazaar.Package{}

	installedInfos, basePath, baseURLPathPrefix, err := GetInstalledPackageInfos(pkgType)
	if err != nil {
		return
	}
	// 本地没有该类型的集市包时，直接返回，避免请求云端数据
	if len(installedInfos) == 0 {
		return
	}

	for _, info := range installedInfos {
		pkg := info.Pkg
		installPath := filepath.Join(basePath, info.DirName)
		baseURLPath := baseURLPathPrefix + info.DirName + "/"
		// 设置本地集市包的通用元数据
		if !bazaar.SetInstalledPackageMetadata(pkg, installPath, baseURLPath, pkgType) {
			continue
		}
		installedPackages = append(installedPackages, pkg)
	}

	installedPackages = bazaar.FilterPackages(installedPackages, keyword)

	// 设置本地集市包的额外元数据
	var petals []*Petal
	if pkgType == "plugins" {
		petals = getPetals()
	}
	for _, pkg := range installedPackages {
		switch pkgType {
		case "plugins":
			pkg.InstalledIncompatible = new(bazaar.IsIncompatiblePlugin(pkg, frontend))
			petal := getPetalByName(pkg.Name, petals)
			if nil != petal {
				pkg.Enabled = new(petal.Enabled)
			}
		case "themes":
			pkg.InstalledIncompatible = new(bazaar.IsIncompatibleTheme(pkg, frontend))
			pkg.Current = pkg.Name == Conf.Appearance.ThemeDark || pkg.Name == Conf.Appearance.ThemeLight
		case "icons":
			pkg.Current = pkg.Name == Conf.Appearance.Icon
		}
	}
	return
}

// GetInstalledPackageSize 获取本地集市包的安装大小
func GetInstalledPackageSize(pkgType, packageName string) (size int64, hSize string, err error) {
	installedInfos, basePath, _, err := GetInstalledPackageInfos(pkgType)
	if err != nil {
		return
	}
	for _, info := range installedInfos {
		if info.Pkg.Name != packageName {
			continue
		}
		installPath := filepath.Join(basePath, info.DirName)
		return bazaar.GetInstalledPackageSize(pkgType, packageName, installPath)
	}
	err = errors.New("installed package not found")
	return
}

// GetBazaarPackageDetail 获取单个集市包的本地安装信息和在线信息。
//
// 在线集市不可用时仍返回本地信息，避免网络问题阻断已下载包详情。
func GetBazaarPackageDetail(pkgType, packageName, frontend string) (installed, available *bazaar.Package) {
	for _, pkg := range GetInstalledPackages(pkgType, frontend, "") {
		if pkg.Name == packageName {
			installed = pkg
			break
		}
	}

	availablePackages, err := bazaar.GetBazaarPackagesMap(pkgType, frontend)
	if err != nil {
		return
	}
	available = availablePackages[packageName]
	if available == nil || installed == nil {
		return
	}

	available.Installed = true
	available.Outdated = 0 > semver.Compare("v"+installed.Version, "v"+available.Version)
	available.Current = installed.Current
	return
}

// GetBazaarPackages 获取在线集市包列表
func GetBazaarPackages(pkgType, frontend, keyword string) (bazaarPackages []*bazaar.Package) {
	bazaarPackages = bazaar.GetBazaarPackages(pkgType, frontend)
	bazaarPackages = bazaar.FilterPackages(bazaarPackages, keyword)
	installedInfos, _, _, err := GetInstalledPackageInfos(pkgType)
	if err != nil {
		return
	}
	installedMap := make(map[string]*bazaar.Package, len(installedInfos))
	for _, info := range installedInfos {
		installedMap[info.Pkg.Name] = info.Pkg
	}
	for _, pkg := range bazaarPackages {
		installedPkg, ok := installedMap[pkg.Name]
		if !ok {
			continue
		}
		pkg.Installed = true
		pkg.Outdated = 0 > semver.Compare("v"+installedPkg.Version, "v"+pkg.Version)
		switch pkgType {
		case "themes":
			pkg.Current = pkg.Name == Conf.Appearance.ThemeDark || pkg.Name == Conf.Appearance.ThemeLight
		case "icons":
			pkg.Current = pkg.Name == Conf.Appearance.Icon
		}
	}
	return
}

func GetBazaarPackageREADME(ctx context.Context, repoURL, repoHash, pkgType string) (ret string) {
	ret = bazaar.GetBazaarPackageREADME(ctx, repoURL, repoHash, pkgType)
	return
}

// installBazaarPackage 下载并安装集市包
func installBazaarPackage(pkgType, repoURL, repoHash, packageName string) (meta installMeta, err error) {
	installPath, jsonFileName, err := getPackageInstallPath(pkgType, packageName)
	if err != nil {
		return
	}

	installedPkg, parseErr := bazaar.ParsePackageJSON(filepath.Join(installPath, jsonFileName))
	meta.update = parseErr == nil && installedPkg != nil && installedPkg.Name == packageName

	err = bazaar.InstallPackage(repoURL, repoHash, installPath, Conf.System.ID, pkgType, packageName, meta.update)
	if err != nil {
		err = fmt.Errorf(Conf.Language(46), packageName, err)
	}
	return
}

// finishInstall 集市包安装后的处理（刷新外观、推送插件重载等）；批量更新时同类型只执行一次
//
//   - themeOptions：仅在新安装主题（meta.update 为 false）时写入外观；批量覆盖更新不会用到
//   - applyNewAppearance：控制新安装图标是否自动应用；本地安装不自动应用
func finishInstall(pkgType string, items []batchInstallItem, themeOptions *ThemeInstallOptions, applyNewAppearance bool) {
	if 1 > len(items) {
		return
	}

	switch pkgType {
	case "plugins":
		reloadPluginSet := hashset.New()
		for _, item := range items {
			if !item.meta.update {
				continue
			}
			petal := GetPetalByName(item.name)
			if nil != petal && petal.Enabled {
				_, err := SetPetalEnabled(petal.Name, petal.Enabled) // 重新加载插件内容
				if err != nil {
					logging.LogErrorf("reload plugin [%s] after update failed: %s", item.name, err)
					util.PushErrMsg(err.Error(), 5000)
					continue
				}
				reloadPluginSet.Add(item.name)
			}
		}
		if 0 < reloadPluginSet.Size() {
			PushReloadPlugin(nil, nil, reloadPluginSet, nil, "")
		}
	case "themes":
		for _, item := range items {
			if !item.meta.update && nil != themeOptions {
				// 新安装主题时才自动切换 https://github.com/siyuan-note/siyuan/issues/4966
				applied := false
				theme, err := bazaar.ParsePackageJSON(filepath.Join(util.ThemesPath, item.name, "theme.json"))
				if nil == err && nil != theme && nil != theme.Modes {
					for _, mode := range *theme.Modes {
						switch mode {
						case "light":
							Conf.Appearance.ThemeLight = item.name
							applied = true
						case "dark":
							Conf.Appearance.ThemeDark = item.name
							applied = true
						}
					}
				}
				if !applied {
					if 0 == themeOptions.Mode {
						Conf.Appearance.ThemeLight = item.name
					} else {
						Conf.Appearance.ThemeDark = item.name
					}
				}
				Conf.Appearance.Mode = themeOptions.Mode
				Conf.Appearance.ModeOS = themeOptions.ModeOS
				Conf.Appearance.ThemeJS = gulu.File.IsExist(filepath.Join(util.ThemesPath, item.name, "theme.js"))
				Conf.Save()
			}
		}
		InitAppearance()
		WatchThemes()
		util.BroadcastByType("main", "setAppearance", 0, "", Conf.Appearance)
	case "icons":
		for _, item := range items {
			if !item.meta.update && applyNewAppearance {
				// 新安装图标时才自动切换
				Conf.Appearance.Icon = item.name
				Conf.Save()
			}
		}
		InitAppearance()
		util.BroadcastByType("main", "setAppearance", 0, "", Conf.Appearance)
	}
}

// InstallBazaarPackage 安装集市包，themeOptions 仅在 pkgType 为 "themes" 时生效
func InstallBazaarPackage(pkgType, repoURL, repoHash, packageName string, themeOptions *ThemeInstallOptions) error {
	meta, err := installBazaarPackage(pkgType, repoURL, repoHash, packageName)
	if err != nil {
		return err
	}
	finishInstall(pkgType, []batchInstallItem{{name: packageName, meta: meta}}, themeOptions, true)
	return nil
}

// InstallLocalBazaarPackage 安装上传的本地集市包。
func InstallLocalBazaarPackage(archivePath, frontend string, overwrite bool) (result *LocalBazaarPackageInstallResult, err error) {
	pkgType, pkg, sourcePath, cleanup, err := bazaar.ExtractLocalPackage(archivePath)
	if err != nil {
		return nil, err
	}
	defer cleanup()

	result = &LocalBazaarPackageInstallResult{
		PackageType:   pkgType,
		PackageName:   pkg.Name,
		MinAppVersion: pkg.MinAppVersion,
	}
	installPath, _, err := getPackageInstallPath(pkgType, pkg.Name)
	if err != nil {
		return result, err
	}
	if (pkgType == "themes" && isBuiltInTheme(pkg.Name)) || (pkgType == "icons" && isBuiltInIcon(pkg.Name)) {
		return result, errors.New("built-in marketplace package cannot be overwritten")
	}
	if bazaar.IsBelowRequiredAppVersion(pkg) {
		return result, fmt.Errorf("%w: SiYuan %s or later is required", ErrLocalBazaarPackageIncompatible, pkg.MinAppVersion)
	}
	if (pkgType == "plugins" && bazaar.IsIncompatiblePlugin(pkg, frontend)) ||
		(pkgType == "themes" && bazaar.IsIncompatibleTheme(pkg, frontend)) {
		return result, ErrLocalBazaarPackageIncompatible
	}

	localBazaarInstallLock.Lock()
	defer localBazaarInstallLock.Unlock()
	_, statErr := os.Lstat(installPath)
	if statErr != nil && !os.IsNotExist(statErr) {
		return result, statErr
	}
	result.Updated = statErr == nil
	if result.Updated && !overwrite {
		return result, ErrLocalBazaarPackageExists
	}
	if err = bazaar.InstallLocalPackage(sourcePath, installPath, pkgType, pkg.Name, result.Updated); err != nil {
		return result, fmt.Errorf(Conf.Language(46), pkg.Name, err)
	}
	finishInstall(pkgType, []batchInstallItem{{name: pkg.Name, meta: installMeta{update: result.Updated}}}, nil, false)
	return result, nil
}

// UpdateBazaarPackage 使用在线集市数据更新本地集市包
func UpdateBazaarPackage(pkgType, packageName, frontend string) error {
	if _, _, err := getPackageInstallPath(pkgType, packageName); err != nil {
		return err
	}
	updatedPackages, err := getUpdatedPackages(pkgType, frontend)
	if err != nil {
		return err
	}
	for _, updated := range updatedPackages {
		if updated.Installed == nil || updated.Available == nil || updated.Installed.Name != packageName {
			continue
		}
		if updated.Available.DisallowUpdate {
			return errors.New("marketplace package update is not allowed")
		}
		return InstallBazaarPackage(pkgType, updated.Available.RepoURL, updated.Available.RepoHash, packageName, nil)
	}
	return errors.New("marketplace package update not found")
}

func UninstallPackage(pkgType, packageName string) error {
	installPath, _, err := getPackageInstallPath(pkgType, packageName)
	if err != nil {
		return err
	}

	err = bazaar.UninstallPackage(installPath)
	if err != nil {
		return fmt.Errorf(Conf.Language(47), err.Error())
	}

	// 删除集市包的持久化信息
	bazaar.RemovePackageInfo(pkgType, packageName)
	bazaar.RemoveInstalledPackageSizeCache(pkgType, packageName)

	switch pkgType {
	case "plugins":
		petals := getPetals()
		var tmp []*Petal
		for i, petal := range petals {
			if petal.Name != packageName {
				tmp = append(tmp, petals[i])
			}
		}
		petals = tmp
		savePetals(petals)

		uninstallPluginSet := hashset.New(packageName)
		PushReloadPlugin(uninstallPluginSet, nil, nil, nil, "")
	case "themes":
		InitAppearance()
		WatchThemes()
		util.BroadcastByType("main", "setAppearance", 0, "", Conf.Appearance)
	case "icons":
		InitAppearance()
		util.BroadcastByType("main", "setAppearance", 0, "", Conf.Appearance)
	}

	return nil
}

// isBuiltInTheme 通过包名或目录名判断是否为内置主题
func isBuiltInTheme(name string) bool {
	return strings.EqualFold("daylight", name) || strings.EqualFold("midnight", name)
}

// isBuiltInIcon 通过包名或目录名判断是否为内置图标
func isBuiltInIcon(name string) bool {
	return strings.EqualFold("litheness", name)
}
