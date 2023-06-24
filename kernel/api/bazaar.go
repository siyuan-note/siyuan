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

package api

import (
	"net/http"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func getBazaarPackageREAME(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	repoURL := arg["repoURL"].(string)
	repoHash := arg["repoHash"].(string)
	packageType := arg["packageType"].(string)
	ret.Data = map[string]interface{}{
		"html": model.GetPackageREADME(repoURL, repoHash, packageType),
	}
}

func getBazaarPlugin(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	frontend := arg["frontend"].(string)

	ret.Data = map[string]interface{}{
		"packages": model.BazaarPlugins(frontend),
	}
}

func getInstalledPlugin(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	frontend := arg["frontend"].(string)

	ret.Data = map[string]interface{}{
		"packages": model.InstalledPlugins(frontend),
	}
}

func installBazaarPlugin(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	repoURL := arg["repoURL"].(string)
	repoHash := arg["repoHash"].(string)
	packageName := arg["packageName"].(string)
	err := model.InstallBazaarPlugin(repoURL, repoHash, packageName)
	if nil != err {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}

	frontend := arg["frontend"].(string)

	util.PushMsg(model.Conf.Language(69), 3000)
	ret.Data = map[string]interface{}{
		"packages": model.BazaarPlugins(frontend),
	}
}

func uninstallBazaarPlugin(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	frontend := arg["frontend"].(string)
	packageName := arg["packageName"].(string)
	err := model.UninstallBazaarPlugin(packageName, frontend)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"packages": model.BazaarPlugins(frontend),
	}
}

func getBazaarWidget(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	ret.Data = map[string]interface{}{
		"packages": model.BazaarWidgets(),
	}
}

func getInstalledWidget(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	ret.Data = map[string]interface{}{
		"packages": model.InstalledWidgets(),
	}
}

func installBazaarWidget(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	repoURL := arg["repoURL"].(string)
	repoHash := arg["repoHash"].(string)
	packageName := arg["packageName"].(string)
	err := model.InstallBazaarWidget(repoURL, repoHash, packageName)
	if nil != err {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}

	util.PushMsg(model.Conf.Language(69), 3000)
	ret.Data = map[string]interface{}{
		"packages": model.BazaarWidgets(),
	}
}

func uninstallBazaarWidget(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	packageName := arg["packageName"].(string)
	err := model.UninstallBazaarWidget(packageName)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"packages": model.BazaarWidgets(),
	}
}

func getBazaarIcon(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	ret.Data = map[string]interface{}{
		"packages": model.BazaarIcons(),
	}
}

func getInstalledIcon(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	ret.Data = map[string]interface{}{
		"packages": model.InstalledIcons(),
	}
}

func installBazaarIcon(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	repoURL := arg["repoURL"].(string)
	repoHash := arg["repoHash"].(string)
	packageName := arg["packageName"].(string)
	err := model.InstallBazaarIcon(repoURL, repoHash, packageName)
	if nil != err {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}
	util.PushMsg(model.Conf.Language(69), 3000)

	ret.Data = map[string]interface{}{
		"packages":   model.BazaarIcons(),
		"appearance": model.Conf.Appearance,
	}
}

func uninstallBazaarIcon(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	packageName := arg["packageName"].(string)
	err := model.UninstallBazaarIcon(packageName)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"packages":   model.BazaarIcons(),
		"appearance": model.Conf.Appearance,
	}
}

func getBazaarTemplate(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	ret.Data = map[string]interface{}{
		"packages": model.BazaarTemplates(),
	}
}

func getInstalledTemplate(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	ret.Data = map[string]interface{}{
		"packages": model.InstalledTemplates(),
	}
}

func installBazaarTemplate(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	repoURL := arg["repoURL"].(string)
	repoHash := arg["repoHash"].(string)
	packageName := arg["packageName"].(string)
	err := model.InstallBazaarTemplate(repoURL, repoHash, packageName)
	if nil != err {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"packages": model.BazaarTemplates(),
	}

	util.PushMsg(model.Conf.Language(69), 3000)
}

func uninstallBazaarTemplate(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	packageName := arg["packageName"].(string)
	err := model.UninstallBazaarTemplate(packageName)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"packages": model.BazaarTemplates(),
	}
}

func getBazaarTheme(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	ret.Data = map[string]interface{}{
		"packages": model.BazaarThemes(),
	}
}

func getInstalledTheme(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	ret.Data = map[string]interface{}{
		"packages": model.InstalledThemes(),
	}
}

func installBazaarTheme(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	repoURL := arg["repoURL"].(string)
	repoHash := arg["repoHash"].(string)
	packageName := arg["packageName"].(string)
	mode := arg["mode"].(float64)
	update := false
	if nil != arg["update"] {
		update = arg["update"].(bool)
	}
	err := model.InstallBazaarTheme(repoURL, repoHash, packageName, int(mode), update)
	if nil != err {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}

	// 安装集市主题后不跟随系统切换外观模式
	model.Conf.Appearance.ModeOS = false
	model.Conf.Save()

	util.PushMsg(model.Conf.Language(69), 3000)
	ret.Data = map[string]interface{}{
		"packages":   model.BazaarThemes(),
		"appearance": model.Conf.Appearance,
	}
}

func uninstallBazaarTheme(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	packageName := arg["packageName"].(string)
	err := model.UninstallBazaarTheme(packageName)
	if nil != err {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"packages":   model.BazaarThemes(),
		"appearance": model.Conf.Appearance,
	}
}
