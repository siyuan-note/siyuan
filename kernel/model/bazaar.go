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

// installedPackageInfo 描述了本地集市包的包与目录名信息
type installedPackageInfo struct {
	Pkg     *bazaar.Package
	DirName string
}

func getPackageInstallPath(pkgType, packageName string) (string, error) {
	switch pkgType {
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
		logging.LogErrorf("invalid package type: %s", pkgType)
		return "", errors.New("invalid package type")
	}
}

// updatePackages 更新一组集市包
func updatePackages(packages []*bazaar.Package, pkgType string, count *int, total int) bool {
	for _, pkg := range packages {
		installPath, err := getPackageInstallPath(pkgType, pkg.Name)
		if err != nil {
			return false
		}
		err = bazaar.InstallPackage(pkg.RepoURL, pkg.RepoHash, installPath, Conf.System.ID)
		if err != nil {
			logging.LogErrorf("update %s [%s] failed: %s", pkgType, pkg.Name, err)
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
func getUpdatedPackages(pkgType, frontend, keyword string) (updatedPackages []*bazaar.Package) {
	installedPackages := GetInstalledPackages(pkgType, frontend, keyword)
	updatedPackages = []*bazaar.Package{} // 确保返回空切片而非 nil
	for _, pkg := range installedPackages {
		if !pkg.Outdated {
			continue
		}
		updatedPackages = append(updatedPackages, pkg)
		pkg.PreferredReadme = "" // 清空这个字段，前端会请求在线的 README
	}
	return
}

// GetInstalledPackageInfos 获取本地集市包信息，并返回路径相关字段供调用方复用
func GetInstalledPackageInfos(pkgType string) (installedPackageInfos []installedPackageInfo, basePath, jsonFileName, baseURLPathPrefix string, err error) {
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

// GetInstalledPackages 获取本地集市包列表
func GetInstalledPackages(pkgType, frontend, keyword string) (installedPackages []*bazaar.Package) {
	installedPackages = []*bazaar.Package{}
	bazaarPackages := bazaar.GetBazaarPackages(pkgType, frontend)
	installedInfos, basePath, jsonFileName, baseURLPathPrefix, err := GetInstalledPackageInfos(pkgType)
	if err != nil {
		return
	}
	bazaarPackagesMap := make(map[string]*bazaar.Package, len(bazaarPackages))
	for _, pkg := range bazaarPackages {
		if "" != pkg.Name {
			bazaarPackagesMap[pkg.Name] = pkg
		}
	}
	for _, info := range installedInfos {
		pkg := info.Pkg
		installPath := filepath.Join(basePath, info.DirName)
		baseURLPath := baseURLPathPrefix + info.DirName + "/"
		// 设置本地集市包的通用元数据
		if !bazaar.SetInstalledPackageMetadata(pkg, installPath, jsonFileName, baseURLPath, bazaarPackagesMap) {
			continue
		}
		installedPackages = append(installedPackages, pkg)
	}
	installedPackages = bazaar.FilterPackages(installedPackages, keyword)
	// 设置本地集市包的额外元数据
	for _, pkg := range installedPackages {
		switch pkgType {
		case "plugins":
			incompatible := bazaar.IsIncompatiblePlugin(pkg, frontend)
			pkg.Incompatible = &incompatible
			petals := getPetals()
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
	installedInfos, _, _, _, err := GetInstalledPackageInfos(pkgType)
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

// InstallBazaarPackage 安装集市包。update 为 true 表示更新已有包、themeMode 仅在 pkgType 为 "themes" 时生效
func InstallBazaarPackage(pkgType, repoURL, repoHash, packageName string, update bool, themeMode int) error {
	switch pkgType {
	case "themes":
		closeThemeWatchers()
	}

	installPath, err := getPackageInstallPath(pkgType, packageName)
	if err != nil {
		return err
	}

	err = bazaar.InstallPackage(repoURL, repoHash, installPath, Conf.System.ID)
	if err != nil {
		return fmt.Errorf(Conf.Language(46), packageName, err)
	}

	switch pkgType {
	case "themes":
		if !update {
			// 更新主题后不需要切换到该主题 https://github.com/siyuan-note/siyuan/issues/4966
			if 0 == themeMode {
				Conf.Appearance.ThemeLight = packageName
			} else {
				Conf.Appearance.ThemeDark = packageName
			}
			Conf.Appearance.Mode = themeMode
			Conf.Appearance.ThemeJS = gulu.File.IsExist(filepath.Join(util.ThemesPath, packageName, "theme.js"))
			Conf.Save()
		}
		InitAppearance()
		util.BroadcastByType("main", "setAppearance", 0, "", Conf.Appearance)
	case "icons":
		if !update {
			// 更新图标后不需要切换到该图标
			Conf.Appearance.Icon = packageName
			Conf.Save()
		}
		InitAppearance()
		util.BroadcastByType("main", "setAppearance", 0, "", Conf.Appearance)
	}
	return nil
}

func UninstallPackage(pkgType, packageName string) error {
	switch pkgType {
	case "themes":
		closeThemeWatchers()
	}

	installPath, err := getPackageInstallPath(pkgType, packageName)
	if err != nil {
		return err
	}

	err = bazaar.UninstallPackage(installPath)
	if err != nil {
		return fmt.Errorf(Conf.Language(47), err.Error())
	}

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
	case "icons", "themes":
		InitAppearance()
	}

	return nil
}

// isBuiltInTheme 通过包名或目录名判断是否为内置主题
func isBuiltInTheme(name string) bool {
	return "daylight" == name || "midnight" == name
}

// isBuiltInIcon 通过包名或目录名判断是否为内置图标
func isBuiltInIcon(name string) bool {
	return "ant" == name || "material" == name
}
