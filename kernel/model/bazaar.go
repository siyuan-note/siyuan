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
	"time"

	"github.com/88250/gulu"
	"github.com/emirpasic/gods/sets/hashset"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/mod/semver"
)

// updatePackages 更新一组集市包
func updatePackages(packages []*bazaar.Package, packageType string, count *int, total int) bool {
	for _, pkg := range packages {
		installPath, err := getPackageInstallPath(packageType, pkg.Name)
		if err != nil {
			return false
		}
		err = bazaar.InstallPackage(pkg.RepoURL, pkg.RepoHash, installPath, Conf.System.ID)
		if err != nil {
			logging.LogErrorf("update %s [%s] failed: %s", packageType, pkg.Name, err)
			util.PushErrMsg(fmt.Sprintf(Conf.language(238), pkg.Name), 5000)
			return false
		}
		*count++
		util.PushEndlessProgress(fmt.Sprintf(Conf.language(236), *count, total, pkg.Name))
	}
	return true
}

// BatchUpdatePackages 更新所有集市包
func BatchUpdatePackages(frontend string) {
	plugins, widgets, icons, themes, templates := GetUpdatedPackages(frontend)

	total := len(plugins) + len(widgets) + len(icons) + len(themes) + len(templates)
	if 1 > total {
		return
	}

	util.PushEndlessProgress(fmt.Sprintf(Conf.language(235), 1, total))
	defer util.PushClearProgress()
	count := 1

	if !updatePackages(plugins, "plugins", &count, total) {
		return
	}
	if !updatePackages(themes, "themes", &count, total) {
		return
	}
	if !updatePackages(icons, "icons", &count, total) {
		return
	}
	if !updatePackages(templates, "templates", &count, total) {
		return
	}
	if !updatePackages(widgets, "widgets", &count, total) {
		return
	}

	util.ReloadUI()
	task.AppendAsyncTaskWithDelay(task.PushMsg, 3*time.Second, util.PushMsg, fmt.Sprintf(Conf.language(237), total), 5000)
}

// GetUpdatedPackages 获取所有类型集市包的更新列表
func GetUpdatedPackages(frontend string) (plugins, widgets, icons, themes, templates []*bazaar.Package) {
	wg := &sync.WaitGroup{}
	wg.Add(5)

	go func() {
		defer wg.Done()
		plugins = getUpdatedPackages("plugins", frontend, "")
	}()
	go func() {
		defer wg.Done()
		themes = getUpdatedPackages("themes", "", "")
	}()
	go func() {
		defer wg.Done()
		icons = getUpdatedPackages("icons", "", "")
	}()
	go func() {
		defer wg.Done()
		templates = getUpdatedPackages("templates", "", "")
	}()
	go func() {
		defer wg.Done()
		widgets = getUpdatedPackages("widgets", "", "")
	}()

	wg.Wait()
	return
}

// getUpdatedPackages 获取单个类型集市包的更新列表
func getUpdatedPackages(pkgType, frontend, keyword string) []*bazaar.Package {
	installedPackages := GetInstalledPackages(pkgType, frontend, keyword)
	var outdated []*bazaar.Package
	for _, pkg := range installedPackages {
		if pkg.Outdated {
			outdated = append(outdated, pkg)
		}
		pkg.PreferredReadme = "" // 清空这个字段，前端会请求在线的 README
	}
	// 确保返回空切片而非 nil
	if len(outdated) == 0 {
		return []*bazaar.Package{}
	}
	return outdated
}

func GetBazaarPackageREADME(ctx context.Context, repoURL, repoHash, packageType string) (ret string) {
	ret = bazaar.GetBazaarPackageREADME(ctx, repoURL, repoHash, packageType)
	return
}

// getInstalledPackagesMap 获取已安装集市包的映射表
func getInstalledPackagesMap(pkgType, frontend string) map[string]*bazaar.Package {
	installedMap := make(map[string]*bazaar.Package)
	installedPackages := GetInstalledPackages(pkgType, frontend, "")

	for _, pkg := range installedPackages {
		installedMap[pkg.Name] = pkg
	}
	return installedMap
}

// GetBazaarPackages 获取在线集市包列表
func GetBazaarPackages(pkgType, frontend, keyword string) (packages []*bazaar.Package) {
	packages = bazaar.GetBazaarPackages(pkgType, frontend)
	packages = bazaar.FilterPackages(packages, keyword)

	installedMap := getInstalledPackagesMap(pkgType, frontend)
	for _, pkg := range packages {
		if installedPkg, ok := installedMap[pkg.Name]; ok {
			pkg.Installed = true
			pkg.Outdated = 0 > semver.Compare("v"+installedPkg.Version, "v"+pkg.Version)
		} else {
			pkg.Installed = false
			pkg.Outdated = false
		}
	}
	return
}

// GetInstalledPackages 获取已安装的指定类型集市包列表
func GetInstalledPackages(pkgType, frontend, keyword string) (ret []*bazaar.Package) {
	ret = []*bazaar.Package{}

	var basePath string
	var jsonFileName string
	var baseURLPathPrefix string
	var filterFunc func([]os.DirEntry) []os.DirEntry // 用于过滤内置包
	var postProcessFunc func(*bazaar.Package)        // 用于添加额外字段

	switch pkgType {
	case "plugins":
		basePath = filepath.Join(util.DataDir, "plugins")
		jsonFileName = "plugin.json"
		baseURLPathPrefix = "/plugins/"
		postProcessFunc = func(pkg *bazaar.Package) {
			incompatible := bazaar.IsIncompatiblePlugin(pkg, frontend)
			pkg.Incompatible = &incompatible
			petals := getPetals()
			petal := getPetalByName(pkg.Name, petals)
			if nil != petal {
				enabled := petal.Enabled
				pkg.Enabled = &enabled
			}
		}
	case "widgets":
		basePath = filepath.Join(util.DataDir, "widgets")
		jsonFileName = "widget.json"
		baseURLPathPrefix = "/widgets/"
	case "icons":
		basePath = util.IconsPath
		jsonFileName = "icon.json"
		baseURLPathPrefix = "/appearance/icons/"
		filterFunc = func(dirs []os.DirEntry) []os.DirEntry {
			var filtered []os.DirEntry
			for _, d := range dirs {
				if bazaar.IsBuiltInIcon(d.Name()) {
					continue
				}
				filtered = append(filtered, d)
			}
			return filtered
		}
		postProcessFunc = func(pkg *bazaar.Package) {
			pkg.Current = pkg.Name == Conf.Appearance.Icon
		}
	case "themes":
		basePath = util.ThemesPath
		jsonFileName = "theme.json"
		baseURLPathPrefix = "/appearance/themes/"
		filterFunc = func(dirs []os.DirEntry) []os.DirEntry {
			var filtered []os.DirEntry
			for _, d := range dirs {
				if bazaar.IsBuiltInTheme(d.Name()) {
					continue
				}
				filtered = append(filtered, d)
			}
			return filtered
		}
		postProcessFunc = func(pkg *bazaar.Package) {
			pkg.Current = pkg.Name == Conf.Appearance.ThemeDark || pkg.Name == Conf.Appearance.ThemeLight
		}
	case "templates":
		basePath = filepath.Join(util.DataDir, "templates")
		jsonFileName = "template.json"
		baseURLPathPrefix = "/templates/"
	default:
		logging.LogWarnf("invalid package type: %s", pkgType)
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

	if filterFunc != nil {
		dirs = filterFunc(dirs)
	}

	bazaarPackagesMap := bazaar.BuildBazaarPackagesMap(pkgType, frontend)
	infos := bazaar.GetInstalledPackageInfos(dirs, basePath, jsonFileName)

	for _, info := range infos {
		pkg := info.Pkg
		dirName := info.DirName
		installPath := filepath.Join(basePath, dirName)
		baseURLPath := baseURLPathPrefix + dirName

		if !bazaar.SetInstalledPackageMetadata(pkg, installPath, jsonFileName, baseURLPath, bazaarPackagesMap) {
			continue
		}

		if postProcessFunc != nil {
			postProcessFunc(pkg)
		}

		ret = append(ret, pkg)
	}

	ret = bazaar.FilterPackages(ret, keyword)
	return
}

func getPackageInstallPath(packageType, packageName string) (string, error) {
	switch packageType {
	case "plugins":
		return filepath.Join(util.DataDir, "plugins", packageName), nil
	case "themes":
		return filepath.Join(util.ThemesPath, packageName), nil
	case "icons":
		return filepath.Join(util.IconsPath, packageName), nil
	case "templates":
		return filepath.Join(util.DataDir, "templates", packageName), nil
	case "widgets":
		return filepath.Join(util.DataDir, "widgets", packageName), nil
	default:
		logging.LogErrorf("invalid package type: %s", packageType)
		return "", errors.New("invalid package type")
	}
}

func InstallBazaarPackage(packageType, repoURL, repoHash, packageName string) error {
	installPath, err := getPackageInstallPath(packageType, packageName)
	if err != nil {
		return err
	}

	err = bazaar.InstallPackage(repoURL, repoHash, installPath, Conf.System.ID)
	if err != nil {
		return fmt.Errorf(Conf.Language(46), packageName, err)
	}
	return nil
}

func UninstallPackage(packageType, packageName string) error {
	switch packageType {
	case "themes":
		closeThemeWatchers()
	}

	installPath, err := getPackageInstallPath(packageType, packageName)
	if err != nil {
		return err
	}

	err = bazaar.UninstallPackage(installPath)
	if err != nil {
		return fmt.Errorf(Conf.Language(47), err.Error())
	}

	switch packageType {
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
		PushReloadPlugin(nil, nil, nil, uninstallPluginSet, "")
	case "icons", "themes":
		InitAppearance()
	}

	return nil
}

func BazaarIcons(keyword string) (icons []*bazaar.Package) {
	icons = bazaar.GetBazaarPackages("icons", "")
	icons = bazaar.FilterPackages(icons, keyword)
	for _, installed := range Conf.Appearance.Icons {
		for _, icon := range icons {
			if installed == icon.Name {
				icon.Installed = true
				if iconConf, err := bazaar.ParsePackageJSON(filepath.Join(util.IconsPath, icon.Name, "icon.json")); err == nil {
					icon.Outdated = 0 > semver.Compare("v"+iconConf.Version, "v"+icon.Version)
				}
			}
			icon.Current = icon.Name == Conf.Appearance.Icon
		}
	}
	return
}

func InstallBazaarIcon(repoURL, repoHash, iconName string) error {
	if err := InstallBazaarPackage("icons", repoURL, repoHash, iconName); err != nil {
		return err
	}
	Conf.Appearance.Icon = iconName
	Conf.Save()
	InitAppearance()
	util.BroadcastByType("main", "setAppearance", 0, "", Conf.Appearance)
	return nil
}

func BazaarThemes(keyword string) (ret []*bazaar.Package) {
	ret = bazaar.GetBazaarPackages("themes", "")
	ret = bazaar.FilterPackages(ret, keyword)
	installs := Conf.Appearance.DarkThemes
	installs = append(installs, Conf.Appearance.LightThemes...)
	for _, installed := range installs {
		for _, theme := range ret {
			if installed.Name == theme.Name {
				theme.Installed = true
				if themeConf, err := bazaar.ParsePackageJSON(filepath.Join(util.ThemesPath, theme.Name, "theme.json")); err == nil {
					theme.Outdated = 0 > semver.Compare("v"+themeConf.Version, "v"+theme.Version)
				}
				theme.Current = theme.Name == Conf.Appearance.ThemeDark || theme.Name == Conf.Appearance.ThemeLight
			}
		}
	}
	return
}

func InstallBazaarTheme(repoURL, repoHash, themeName string, mode int, update bool) error {
	closeThemeWatchers()

	if err := InstallBazaarPackage("themes", repoURL, repoHash, themeName); err != nil {
		return err
	}

	if !update {
		// 更新主题后不需要对该主题进行切换 https://github.com/siyuan-note/siyuan/issues/4966
		if 0 == mode {
			Conf.Appearance.ThemeLight = themeName
		} else {
			Conf.Appearance.ThemeDark = themeName
		}
		Conf.Appearance.Mode = mode
		Conf.Appearance.ThemeJS = gulu.File.IsExist(filepath.Join(util.ThemesPath, themeName, "theme.js"))
		Conf.Save()
	}

	InitAppearance()
	util.BroadcastByType("main", "setAppearance", 0, "", Conf.Appearance)
	return nil
}
