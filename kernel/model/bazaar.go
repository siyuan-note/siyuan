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

func GetBazaarPackageREADME(ctx context.Context, repoURL, repoHash, pkgType string) (ret string) {
	ret = bazaar.GetBazaarPackageREADME(ctx, repoURL, repoHash, pkgType)
	return
}

// getInstalledPackagesWithBazaarMap 获取已安装的集市包列表，并给 bazaarPackagesMap（可能经过过滤）中的集市包设置元数据
func getInstalledPackagesWithBazaarMap(pkgType, frontend string, bazaarPackagesMap map[string]*bazaar.Package) (ret []*bazaar.Package) {
	ret = []*bazaar.Package{}
	var basePath string
	var jsonFileName string
	var baseURLPathPrefix string

	switch pkgType {
	case "plugins":
		basePath = filepath.Join(util.DataDir, "plugins")
		jsonFileName = "plugin.json"
		baseURLPathPrefix = "/plugins/"
	case "themes":
		basePath = util.ThemesPath
		jsonFileName = "theme.json"
		baseURLPathPrefix = "/appearance/themes/"
	case "icons":
		basePath = util.IconsPath
		jsonFileName = "icon.json"
		baseURLPathPrefix = "/appearance/icons/"
	case "templates":
		basePath = filepath.Join(util.DataDir, "templates")
		jsonFileName = "template.json"
		baseURLPathPrefix = "/templates/"
	case "widgets":
		basePath = filepath.Join(util.DataDir, "widgets")
		jsonFileName = "widget.json"
		baseURLPathPrefix = "/widgets/"
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

	// 过滤内置包
	switch pkgType {
	case "themes":
		filtered := make([]os.DirEntry, 0, len(dirs))
		for _, d := range dirs {
			if bazaar.IsBuiltInTheme(d.Name()) {
				continue
			}
			filtered = append(filtered, d)
		}
		dirs = filtered
	case "icons":
		filtered := make([]os.DirEntry, 0, len(dirs))
		for _, d := range dirs {
			if bazaar.IsBuiltInIcon(d.Name()) {
				continue
			}
			filtered = append(filtered, d)
		}
		dirs = filtered
	}

	infos := bazaar.GetInstalledPackageInfos(dirs, basePath, jsonFileName)
	for _, info := range infos {
		pkg := info.Pkg
		dirName := info.DirName
		installPath := filepath.Join(basePath, dirName)
		baseURLPath := baseURLPathPrefix + dirName

		// 设置元数据
		if !bazaar.SetInstalledPackageMetadata(pkg, installPath, jsonFileName, baseURLPath, bazaarPackagesMap) {
			continue
		}
		// 添加额外信息
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
		ret = append(ret, pkg)
	}
	return
}

// GetBazaarPackages 获取在线集市包列表
func GetBazaarPackages(pkgType, frontend, keyword string) (packages []*bazaar.Package) {
	packages = bazaar.GetBazaarPackages(pkgType, frontend)
	packages = bazaar.FilterPackages(packages, keyword)

	switch pkgType {
	case "themes":
		installedSet := make(map[string]struct{}, len(Conf.Appearance.DarkThemes)+len(Conf.Appearance.LightThemes))
		for _, t := range Conf.Appearance.DarkThemes {
			installedSet[t.Name] = struct{}{}
		}
		for _, t := range Conf.Appearance.LightThemes {
			installedSet[t.Name] = struct{}{}
		}
		for _, pkg := range packages {
			if _, installed := installedSet[pkg.Name]; !installed {
				continue
			}
			pkg.Installed = true
			if themeConf, err := bazaar.ParsePackageJSON(filepath.Join(util.ThemesPath, pkg.Name, "theme.json")); err == nil {
				pkg.Outdated = 0 > semver.Compare("v"+themeConf.Version, "v"+pkg.Version)
			}
			pkg.Current = pkg.Name == Conf.Appearance.ThemeDark || pkg.Name == Conf.Appearance.ThemeLight
		}
	case "icons":
		installedSet := make(map[string]struct{}, len(Conf.Appearance.Icons))
		for _, name := range Conf.Appearance.Icons {
			installedSet[name] = struct{}{}
		}
		for _, pkg := range packages {
			if _, installed := installedSet[pkg.Name]; !installed {
				continue
			}
			pkg.Installed = true
			if iconConf, err := bazaar.ParsePackageJSON(filepath.Join(util.IconsPath, pkg.Name, "icon.json")); err == nil {
				pkg.Outdated = 0 > semver.Compare("v"+iconConf.Version, "v"+pkg.Version)
			}
			pkg.Current = pkg.Name == Conf.Appearance.Icon
		}
	default:
		// 复用过滤后的 packages 构建 map：最终只对过滤后的 packages 设置字段，故 map 仅需覆盖过滤后的包名即可，无需完整的 packages
		bazaarPackagesMap := make(map[string]*bazaar.Package, len(packages))
		for _, pkg := range packages {
			if "" != pkg.Name {
				bazaarPackagesMap[pkg.Name] = pkg
			}
		}
		installedPackages := getInstalledPackagesWithBazaarMap(pkgType, frontend, bazaarPackagesMap)
		installedMap := make(map[string]*bazaar.Package, len(installedPackages))
		for _, pkg := range installedPackages {
			installedMap[pkg.Name] = pkg
		}
		for _, pkg := range packages {
			if installedPkg, ok := installedMap[pkg.Name]; ok {
				pkg.Installed = true
				pkg.Outdated = 0 > semver.Compare("v"+installedPkg.Version, "v"+pkg.Version)
			} else {
				pkg.Installed = false
				pkg.Outdated = false
			}
		}
	}
	return
}

// GetInstalledPackages 获取已安装的指定类型集市包列表
func GetInstalledPackages(pkgType, frontend, keyword string) (ret []*bazaar.Package) {
	packages := bazaar.GetBazaarPackages(pkgType, frontend)
	bazaarPackagesMap := make(map[string]*bazaar.Package, len(packages))
	for _, pkg := range packages {
		if "" != pkg.Name {
			bazaarPackagesMap[pkg.Name] = pkg
		}
	}
	ret = getInstalledPackagesWithBazaarMap(pkgType, frontend, bazaarPackagesMap)
	ret = bazaar.FilterPackages(ret, keyword)
	return
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
		PushReloadPlugin(nil, nil, nil, uninstallPluginSet, "")
	case "icons", "themes":
		InitAppearance()
	}

	return nil
}
