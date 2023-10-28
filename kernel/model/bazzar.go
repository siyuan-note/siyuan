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
	"errors"
	"fmt"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/siyuan-note/siyuan/kernel/util"

	"github.com/siyuan-note/siyuan/kernel/bazaar"
)

func GetPackageREADME(repoURL, repoHash, packageType string) (ret string) {
	ret = bazaar.GetPackageREADME(repoURL, repoHash, packageType)
	return
}

func BazaarPlugins(frontend, keyword string) (plugins []*bazaar.Plugin) {
	plugins = bazaar.Plugins(frontend)
	plugins = filterPlugins(plugins, keyword)
	for _, plugin := range plugins {
		plugin.Installed = util.IsPathRegularDirOrSymlinkDir(filepath.Join(util.DataDir, "plugins", plugin.Name))
		if plugin.Installed {
			if pluginConf, err := bazaar.PluginJSON(plugin.Name); nil == err && nil != plugin {
				if plugin.Version != pluginConf.Version {
					plugin.Outdated = true
				}
			}
		}
	}
	return
}

func filterPlugins(plugins []*bazaar.Plugin, keyword string) (ret []*bazaar.Plugin) {
	ret = []*bazaar.Plugin{}
	keywords := getSearchKeywords(keyword)
	for _, plugin := range plugins {
		if matchPackage(keywords, plugin.Package) {
			ret = append(ret, plugin)
		}
	}
	return
}

func InstalledPlugins(frontend string) (plugins []*bazaar.Plugin) {
	plugins = bazaar.InstalledPlugins(frontend, true)

	petals := getPetals()
	for _, plugin := range plugins {
		petal := getPetalByName(plugin.Name, petals)
		if nil != petal {
			plugin.Enabled = petal.Enabled
		}
	}
	return
}

func InstallBazaarPlugin(repoURL, repoHash, pluginName string) error {
	installPath := filepath.Join(util.DataDir, "plugins", pluginName)
	err := bazaar.InstallPlugin(repoURL, repoHash, installPath, Conf.System.ID)
	if nil != err {
		return errors.New(fmt.Sprintf(Conf.Language(46), pluginName, err))
	}
	return nil
}

func UninstallBazaarPlugin(pluginName, frontend string) error {
	installPath := filepath.Join(util.DataDir, "plugins", pluginName)
	err := bazaar.UninstallPlugin(installPath)
	if nil != err {
		return errors.New(fmt.Sprintf(Conf.Language(47), err.Error()))
	}

	petals := getPetals()
	var tmp []*Petal
	for i, petal := range petals {
		if petal.Name != pluginName {
			tmp = append(tmp, petals[i])
		}
	}
	petals = tmp
	if 1 > len(petals) {
		petals = []*Petal{}
	}
	savePetals(petals)
	return nil
}

func BazaarWidgets(keyword string) (widgets []*bazaar.Widget) {
	widgets = bazaar.Widgets()
	widgets = filterWidgets(widgets, keyword)
	for _, widget := range widgets {
		widget.Installed = util.IsPathRegularDirOrSymlinkDir(filepath.Join(util.DataDir, "widgets", widget.Name))
		if widget.Installed {
			if widgetConf, err := bazaar.WidgetJSON(widget.Name); nil == err && nil != widget {
				if widget.Version != widgetConf.Version {
					widget.Outdated = true
				}
			}
		}
	}
	return
}

func filterWidgets(widgets []*bazaar.Widget, keyword string) (ret []*bazaar.Widget) {
	ret = []*bazaar.Widget{}
	keywords := getSearchKeywords(keyword)
	for _, w := range widgets {
		if matchPackage(keywords, w.Package) {
			ret = append(ret, w)
		}
	}
	return
}

func InstalledWidgets() (widgets []*bazaar.Widget) {
	widgets = bazaar.InstalledWidgets()
	return
}

func InstallBazaarWidget(repoURL, repoHash, widgetName string) error {
	installPath := filepath.Join(util.DataDir, "widgets", widgetName)
	err := bazaar.InstallWidget(repoURL, repoHash, installPath, Conf.System.ID)
	if nil != err {
		return errors.New(fmt.Sprintf(Conf.Language(46), widgetName, err))
	}
	return nil
}

func UninstallBazaarWidget(widgetName string) error {
	installPath := filepath.Join(util.DataDir, "widgets", widgetName)
	err := bazaar.UninstallWidget(installPath)
	if nil != err {
		return errors.New(fmt.Sprintf(Conf.Language(47), err.Error()))
	}
	return nil
}

func BazaarIcons(keyword string) (icons []*bazaar.Icon) {
	icons = bazaar.Icons()
	icons = filterIcons(icons, keyword)
	for _, installed := range Conf.Appearance.Icons {
		for _, icon := range icons {
			if installed == icon.Name {
				icon.Installed = true
				if themeConf, err := bazaar.IconJSON(icon.Name); nil == err {
					if icon.Version != themeConf.Version {
						icon.Outdated = true
					}
				}
			}
			icon.Current = icon.Name == Conf.Appearance.Icon
		}
	}
	return
}

func filterIcons(icons []*bazaar.Icon, keyword string) (ret []*bazaar.Icon) {
	ret = []*bazaar.Icon{}
	keywords := getSearchKeywords(keyword)
	for _, i := range icons {
		if matchPackage(keywords, i.Package) {
			ret = append(ret, i)
		}
	}
	return
}

func InstalledIcons() (icons []*bazaar.Icon) {
	icons = bazaar.InstalledIcons()
	for _, icon := range icons {
		icon.Current = icon.Name == Conf.Appearance.Icon
	}
	return
}

func InstallBazaarIcon(repoURL, repoHash, iconName string) error {
	installPath := filepath.Join(util.IconsPath, iconName)
	err := bazaar.InstallIcon(repoURL, repoHash, installPath, Conf.System.ID)
	if nil != err {
		return errors.New(fmt.Sprintf(Conf.Language(46), iconName, err))
	}
	Conf.Appearance.Icon = iconName
	Conf.Save()
	InitAppearance()
	return nil
}

func UninstallBazaarIcon(iconName string) error {
	installPath := filepath.Join(util.IconsPath, iconName)
	err := bazaar.UninstallIcon(installPath)
	if nil != err {
		return errors.New(fmt.Sprintf(Conf.Language(47), err.Error()))
	}

	InitAppearance()
	return nil
}

func BazaarThemes(keyword string) (ret []*bazaar.Theme) {
	ret = bazaar.Themes()
	ret = filterThemes(ret, keyword)
	installs := Conf.Appearance.DarkThemes
	installs = append(installs, Conf.Appearance.LightThemes...)
	for _, installed := range installs {
		for _, theme := range ret {
			if installed == theme.Name {
				theme.Installed = true
				if themeConf, err := bazaar.ThemeJSON(theme.Name); nil == err {
					theme.Outdated = theme.Version != themeConf.Version
				}
				theme.Current = theme.Name == Conf.Appearance.ThemeDark || theme.Name == Conf.Appearance.ThemeLight
			}
		}
	}
	return
}

func filterThemes(themes []*bazaar.Theme, keyword string) (ret []*bazaar.Theme) {
	ret = []*bazaar.Theme{}
	keywords := getSearchKeywords(keyword)
	for _, t := range themes {
		if matchPackage(keywords, t.Package) {
			ret = append(ret, t)
		}
	}
	return
}

func InstalledThemes() (ret []*bazaar.Theme) {
	ret = bazaar.InstalledThemes()
	for _, theme := range ret {
		theme.Current = theme.Name == Conf.Appearance.ThemeDark || theme.Name == Conf.Appearance.ThemeLight
	}
	return
}

func InstallBazaarTheme(repoURL, repoHash, themeName string, mode int, update bool) error {
	closeThemeWatchers()

	installPath := filepath.Join(util.ThemesPath, themeName)
	err := bazaar.InstallTheme(repoURL, repoHash, installPath, Conf.System.ID)
	if nil != err {
		return errors.New(fmt.Sprintf(Conf.Language(46), themeName, err))
	}

	if !update {
		// 更新主题后不需要对该主题进行切换 https://github.com/siyuan-note/siyuan/issues/4966
		if 0 == mode {
			Conf.Appearance.ThemeLight = themeName
		} else {
			Conf.Appearance.ThemeDark = themeName
		}
		Conf.Appearance.Mode = mode
		Conf.Appearance.ThemeJS = gulu.File.IsExist(filepath.Join(installPath, "theme.js"))
		Conf.Save()
	}

	InitAppearance()
	return nil
}

func UninstallBazaarTheme(themeName string) error {
	closeThemeWatchers()

	installPath := filepath.Join(util.ThemesPath, themeName)
	err := bazaar.UninstallTheme(installPath)
	if nil != err {
		return errors.New(fmt.Sprintf(Conf.Language(47), err.Error()))
	}

	InitAppearance()
	return nil
}

func BazaarTemplates(keyword string) (templates []*bazaar.Template) {
	templates = bazaar.Templates()
	templates = filterTemplates(templates, keyword)
	for _, template := range templates {
		template.Installed = util.IsPathRegularDirOrSymlinkDir(filepath.Join(util.DataDir, "templates", template.Name))
		if template.Installed {
			if themeConf, err := bazaar.TemplateJSON(template.Name); nil == err && nil != themeConf {
				if template.Version != themeConf.Version {
					template.Outdated = true
				}
			}
		}
	}
	return
}

func filterTemplates(templates []*bazaar.Template, keyword string) (ret []*bazaar.Template) {
	ret = []*bazaar.Template{}
	keywords := getSearchKeywords(keyword)
	for _, t := range templates {
		if matchPackage(keywords, t.Package) {
			ret = append(ret, t)
		}
	}
	return
}

func InstalledTemplates() (templates []*bazaar.Template) {
	templates = bazaar.InstalledTemplates()
	return
}

func InstallBazaarTemplate(repoURL, repoHash, templateName string) error {
	installPath := filepath.Join(util.DataDir, "templates", templateName)
	err := bazaar.InstallTemplate(repoURL, repoHash, installPath, Conf.System.ID)
	if nil != err {
		return errors.New(fmt.Sprintf(Conf.Language(46), templateName, err))
	}
	return nil
}

func UninstallBazaarTemplate(templateName string) error {
	installPath := filepath.Join(util.DataDir, "templates", templateName)
	err := bazaar.UninstallTemplate(installPath)
	if nil != err {
		return errors.New(fmt.Sprintf(Conf.Language(47), err.Error()))
	}
	return nil
}

func matchPackage(keywords []string, pkg *bazaar.Package) bool {
	if 1 > len(keywords) {
		return true
	}

	for _, keyword := range keywords {
		if strings.Contains(strings.ToLower(pkg.DisplayName.Default), keyword) ||
			strings.Contains(strings.ToLower(pkg.DisplayName.ZhCN), keyword) ||
			strings.Contains(strings.ToLower(pkg.DisplayName.ZhCHT), keyword) ||
			strings.Contains(strings.ToLower(pkg.DisplayName.EnUS), keyword) ||
			strings.Contains(strings.ToLower(pkg.Description.Default), keyword) ||
			strings.Contains(strings.ToLower(pkg.Description.ZhCN), keyword) ||
			strings.Contains(strings.ToLower(pkg.Description.ZhCHT), keyword) ||
			strings.Contains(strings.ToLower(pkg.Description.EnUS), keyword) {
			return true
		}

		for _, pkgKeyword := range pkg.Keywords {
			if strings.Contains(strings.ToLower(pkgKeyword), keyword) {
				return true
			}
		}
	}
	return false
}

func getSearchKeywords(query string) (ret []string) {
	query = strings.TrimSpace(query)
	if "" == query {
		return
	}

	keywords := strings.Split(query, " ")
	for _, k := range keywords {
		if "" != k {
			ret = append(ret, strings.ToLower(k))
		}
	}
	return
}
