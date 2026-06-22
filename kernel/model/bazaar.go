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

func getPackageInstallPath(pkgType, packageName string) (string, string, error) {
	switch pkgType {
	case "plugins":
		return filepath.Join(util.DataDir, "plugins", packageName), "plugin.json", nil
	case "themes":
		return filepath.Join(util.ThemesPath, packageName), "theme.json", nil
	case "icons":
		return filepath.Join(util.IconsPath, packageName), "icon.json", nil
	case "templates":
		return filepath.Join(util.DataDir, "templates", packageName), "template.json", nil
	case "widgets":
		return filepath.Join(util.DataDir, "widgets", packageName), "widget.json", nil
	default:
		logging.LogErrorf("invalid package type: %s", pkgType)
		return "", "", errors.New("invalid package type")
	}
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

// updatePackages 更新一组集市包；同类型批量更新时，安装后处理只执行一次
func updatePackages(packages []*bazaar.Package, pkgType string, successCount *int, planned int) {
	items := make([]batchInstallItem, 0, len(packages))
	for _, pkg := range packages {
		meta, err := installBazaarPackage(pkgType, pkg.RepoURL, pkg.RepoHash, pkg.Name)
		if err != nil {
			logging.LogErrorf("update %s [%s] failed: %s", pkgType, pkg.Name, err)
			util.PushErrMsg(fmt.Sprintf(Conf.language(238), pkg.Name), 5000)
			continue
		}
		items = append(items, batchInstallItem{name: pkg.Name, meta: meta})
		*successCount++
		util.PushEndlessProgress(fmt.Sprintf(Conf.language(236), *successCount, planned, pkg.Name))
	}
	finishInstall(pkgType, items, 0)
}

// filterUpdatableBazaarPackages 过滤出允许更新的集市包
func filterUpdatableBazaarPackages(packages []*bazaar.Package) []*bazaar.Package {
	updatable := make([]*bazaar.Package, 0, len(packages))
	for _, pkg := range packages {
		if !pkg.DisallowUpdate {
			updatable = append(updatable, pkg)
		}
	}
	return updatable
}

// BatchUpdatePackages 更新所有集市包
func BatchUpdatePackages(frontend string) {
	plugins, widgets, icons, themes, templates := GetUpdatedPackages(frontend)
	plugins = filterUpdatableBazaarPackages(plugins)
	widgets = filterUpdatableBazaarPackages(widgets)
	icons = filterUpdatableBazaarPackages(icons)
	themes = filterUpdatableBazaarPackages(themes)
	templates = filterUpdatableBazaarPackages(templates)

	planned := len(plugins) + len(widgets) + len(icons) + len(themes) + len(templates)
	if 1 > planned {
		return
	}

	defer util.PushClearProgress()
	successCount := 0
	updatePackages(plugins, "plugins", &successCount, planned)
	updatePackages(themes, "themes", &successCount, planned)
	updatePackages(icons, "icons", &successCount, planned)
	updatePackages(templates, "templates", &successCount, planned)
	updatePackages(widgets, "widgets", &successCount, planned)

	if 0 < successCount {
		util.PushMsg(fmt.Sprintf(Conf.language(237), successCount), 5000)
	}
}

// GetUpdatedPackages 获取所有类型集市包的更新列表
//
//   - frontend 仅用于插件环境兼容性判断
func GetUpdatedPackages(frontend string) (plugins, widgets, icons, themes, templates []*bazaar.Package) {
	wg := &sync.WaitGroup{}

	wg.Go(func() {
		plugins = getUpdatedPackages("plugins", frontend)
	})
	wg.Go(func() {
		themes = getUpdatedPackages("themes", "")
	})
	wg.Go(func() {
		icons = getUpdatedPackages("icons", "")
	})
	wg.Go(func() {
		templates = getUpdatedPackages("templates", "")
	})
	wg.Go(func() {
		widgets = getUpdatedPackages("widgets", "")
	})

	wg.Wait()
	return
}

// getUpdatedPackages 获取单个类型集市包的更新列表
func getUpdatedPackages(pkgType, frontend string) (updatedPackages []*bazaar.Package) {
	installedPackages := GetInstalledPackages(pkgType, frontend, "")
	updatedPackages = []*bazaar.Package{} // 确保返回空切片而非 nil
	for _, pkg := range installedPackages {
		if !pkg.Outdated {
			continue
		}
		updatedPackages = append(updatedPackages, pkg)
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

	bazaarPackagesMap := bazaar.GetBazaarPackagesMap(pkgType, frontend)

	for _, info := range installedInfos {
		pkg := info.Pkg
		installPath := filepath.Join(basePath, info.DirName)
		baseURLPath := baseURLPathPrefix + info.DirName + "/"
		// 设置本地集市包的通用元数据
		if !bazaar.SetInstalledPackageMetadata(pkg, installPath, baseURLPath, pkgType, frontend, bazaarPackagesMap) {
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
			installedIncompatible := bazaar.IsIncompatiblePlugin(pkg, frontend)
			pkg.InstalledIncompatible = &installedIncompatible
			var bazaarIncompatible bool
			if onlinePkg := bazaarPackagesMap[pkg.Name]; nil != onlinePkg {
				bazaarIncompatible = bazaar.IsIncompatiblePlugin(onlinePkg, frontend)
			}
			pkg.BazaarIncompatible = &bazaarIncompatible
			petal := getPetalByName(pkg.Name, petals)
			if nil != petal {
				enabled := petal.Enabled
				pkg.Enabled = &enabled
			}
		case "themes":
			pkg.Current = pkg.Name == Conf.Appearance.ThemeDark || pkg.Name == Conf.Appearance.ThemeLight
		case "icons":
			pkg.Current = pkg.Name == Conf.Appearance.Icon
		}
	}
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

	err = bazaar.InstallPackage(repoURL, repoHash, installPath, Conf.System.ID, pkgType, packageName)
	if err != nil {
		err = fmt.Errorf(Conf.Language(46), packageName, err)
	}
	return
}

// finishInstall 集市包安装后的处理（刷新外观、推送插件重载等）；批量更新时同类型只执行一次
//
//   - themeMode：0 浅色 / 1 深色，仅在新安装主题（meta.update 为 false）时写入外观；批量覆盖更新不会用到
func finishInstall(pkgType string, items []batchInstallItem, themeMode int) {
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
			if !item.meta.update {
				// 新安装主题时才自动切换 https://github.com/siyuan-note/siyuan/issues/4966
				if 0 == themeMode {
					Conf.Appearance.ThemeLight = item.name
				} else {
					Conf.Appearance.ThemeDark = item.name
				}
				Conf.Appearance.Mode = themeMode
				Conf.Appearance.ThemeJS = gulu.File.IsExist(filepath.Join(util.ThemesPath, item.name, "theme.js"))
				Conf.Save()
			}
		}
		InitAppearance()
		WatchThemes()
		util.BroadcastByType("main", "setAppearance", 0, "", Conf.Appearance)
	case "icons":
		for _, item := range items {
			if !item.meta.update {
				// 新安装图标时才自动切换
				Conf.Appearance.Icon = item.name
				Conf.Save()
			}
		}
		InitAppearance()
		util.BroadcastByType("main", "setAppearance", 0, "", Conf.Appearance)
	}
}

// InstallBazaarPackage 安装集市包，themeMode 仅在 pkgType 为 "themes" 时生效
func InstallBazaarPackage(pkgType, repoURL, repoHash, packageName string, themeMode int) error {
	meta, err := installBazaarPackage(pkgType, repoURL, repoHash, packageName)
	if err != nil {
		return err
	}
	finishInstall(pkgType, []batchInstallItem{{name: packageName, meta: meta}}, themeMode)
	return nil
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
	return "daylight" == name || "midnight" == name
}

// isBuiltInIcon 通过包名或目录名判断是否为内置图标
func isBuiltInIcon(name string) bool {
	return "litheness" == name
}
