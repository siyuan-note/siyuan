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

var validPackageTypes = map[string]bool{
	"plugins":   true,
	"themes":    true,
	"icons":     true,
	"templates": true,
	"widgets":   true,
}

func batchUpdatePackage(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	model.BatchUpdatePackages()
}

func getUpdatedPackage(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	plugins, widgets, icons, themes, templates := model.GetUpdatedPackages()
	ret.Data = map[string]interface{}{
		"plugins":   plugins,
		"widgets":   widgets,
		"icons":     icons,
		"themes":    themes,
		"templates": templates,
	}
}

func getBazaarPackageREADME(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var repoURL, repoHash, pkgType string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("repoURL", &repoURL, true, true),
		util.BindJsonArg("repoHash", &repoHash, true, true),
		util.BindJsonArg("packageType", &pkgType, true, true),
	) {
		return
	}
	if !validPackageTypes[pkgType] {
		ret.Code = -1
		ret.Msg = "Invalid package type"
		return
	}
	ret.Data = map[string]interface{}{
		"html": model.GetBazaarPackageREADME(c.Request.Context(), repoURL, repoHash, pkgType),
	}
}

func getBazaarPlugin(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var frontend, keyword string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("frontend", &frontend, true, true),
		util.BindJsonArg("keyword", &keyword, false, false),
	) {
		return
	}

	ret.Data = map[string]interface{}{
		"packages": model.GetBazaarPackages("plugins", frontend, keyword),
	}
}

func getInstalledPlugin(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var frontend, keyword string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("frontend", &frontend, true, true),
		util.BindJsonArg("keyword", &keyword, false, false),
	) {
		return
	}

	ret.Data = map[string]interface{}{
		"packages": model.GetInstalledPackages("plugins", frontend, keyword),
	}
}

func installBazaarPlugin(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var frontend, keyword, repoURL, repoHash, packageName string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("frontend", &frontend, true, true),
		util.BindJsonArg("keyword", &keyword, false, false),
		util.BindJsonArg("repoURL", &repoURL, true, true),
		util.BindJsonArg("repoHash", &repoHash, true, true),
		util.BindJsonArg("packageName", &packageName, true, true),
	) {
		return
	}
	err := model.InstallBazaarPackage("plugins", repoURL, repoHash, packageName, 0)
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}

	util.PushMsg(model.Conf.Language(69), 3000)
	ret.Data = map[string]interface{}{
		"packages": model.GetBazaarPackages("plugins", frontend, keyword),
	}
}

func uninstallBazaarPlugin(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var frontend, keyword, packageName string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("frontend", &frontend, false, false),
		util.BindJsonArg("keyword", &keyword, false, false),
		util.BindJsonArg("packageName", &packageName, true, true),
	) {
		return
	}
	err := model.UninstallPackage("plugins", packageName)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	// 兼容旧行为：如果不指定 frontend，则卸载插件但不返回插件列表
	var packages any
	if "" == frontend {
		packages = []any{}
	} else {
		packages = model.GetBazaarPackages("plugins", frontend, keyword)
	}

	ret.Data = map[string]any{
		"packages": packages,
	}
}

func getBazaarWidget(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var keyword string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("keyword", &keyword, false, false)) {
		return
	}

	ret.Data = map[string]interface{}{
		"packages": model.GetBazaarPackages("widgets", "", keyword),
	}
}

func getInstalledWidget(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var keyword string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("keyword", &keyword, false, false)) {
		return
	}

	ret.Data = map[string]interface{}{
		"packages": model.GetInstalledPackages("widgets", "", keyword),
	}
}

func installBazaarWidget(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var keyword, repoURL, repoHash, packageName string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("keyword", &keyword, false, false),
		util.BindJsonArg("repoURL", &repoURL, true, true),
		util.BindJsonArg("repoHash", &repoHash, true, true),
		util.BindJsonArg("packageName", &packageName, true, true),
	) {
		return
	}
	err := model.InstallBazaarPackage("widgets", repoURL, repoHash, packageName, 0)
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}

	util.PushMsg(model.Conf.Language(69), 3000)
	ret.Data = map[string]interface{}{
		"packages": model.GetBazaarPackages("widgets", "", keyword),
	}
}

func uninstallBazaarWidget(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var keyword, packageName string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("keyword", &keyword, false, false),
		util.BindJsonArg("packageName", &packageName, true, true),
	) {
		return
	}
	err := model.UninstallPackage("widgets", packageName)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"packages": model.GetBazaarPackages("widgets", "", keyword),
	}
}

func getBazaarIcon(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var keyword string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("keyword", &keyword, false, false)) {
		return
	}

	ret.Data = map[string]interface{}{
		"packages": model.GetBazaarPackages("icons", "", keyword),
	}
}

func getInstalledIcon(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var keyword string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("keyword", &keyword, false, false)) {
		return
	}

	ret.Data = map[string]interface{}{
		"packages": model.GetInstalledPackages("icons", "", keyword),
	}
}

func installBazaarIcon(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var keyword, repoURL, repoHash, packageName string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("keyword", &keyword, false, false),
		util.BindJsonArg("repoURL", &repoURL, true, true),
		util.BindJsonArg("repoHash", &repoHash, true, true),
		util.BindJsonArg("packageName", &packageName, true, true),
	) {
		return
	}
	err := model.InstallBazaarPackage("icons", repoURL, repoHash, packageName, 0)
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}
	util.PushMsg(model.Conf.Language(69), 3000)

	ret.Data = map[string]interface{}{
		"packages":   model.GetBazaarPackages("icons", "", keyword),
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

	var keyword, packageName string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("keyword", &keyword, false, false),
		util.BindJsonArg("packageName", &packageName, true, true),
	) {
		return
	}
	err := model.UninstallPackage("icons", packageName)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"packages":   model.GetBazaarPackages("icons", "", keyword),
		"appearance": model.Conf.Appearance,
	}
}

func getBazaarTemplate(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var keyword string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("keyword", &keyword, false, false)) {
		return
	}

	ret.Data = map[string]interface{}{
		"packages": model.GetBazaarPackages("templates", "", keyword),
	}
}

func getInstalledTemplate(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var keyword string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("keyword", &keyword, false, false)) {
		return
	}

	ret.Data = map[string]interface{}{
		"packages": model.GetInstalledPackages("templates", "", keyword),
	}
}

func installBazaarTemplate(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var keyword, repoURL, repoHash, packageName string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("keyword", &keyword, false, false),
		util.BindJsonArg("repoURL", &repoURL, true, true),
		util.BindJsonArg("repoHash", &repoHash, true, true),
		util.BindJsonArg("packageName", &packageName, true, true),
	) {
		return
	}
	err := model.InstallBazaarPackage("templates", repoURL, repoHash, packageName, 0)
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"packages": model.GetBazaarPackages("templates", "", keyword),
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

	var keyword, packageName string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("keyword", &keyword, false, false),
		util.BindJsonArg("packageName", &packageName, true, true),
	) {
		return
	}
	err := model.UninstallPackage("templates", packageName)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"packages": model.GetBazaarPackages("templates", "", keyword),
	}
}

func getBazaarTheme(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var keyword string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("keyword", &keyword, false, false)) {
		return
	}

	ret.Data = map[string]interface{}{
		"packages": model.GetBazaarPackages("themes", "", keyword),
	}
}

func getInstalledTheme(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var keyword string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("keyword", &keyword, false, false)) {
		return
	}

	ret.Data = map[string]interface{}{
		"packages": model.GetInstalledPackages("themes", "", keyword),
	}
}

func installBazaarTheme(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var keyword, repoURL, repoHash, packageName string
	var mode float64
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("keyword", &keyword, false, false),
		util.BindJsonArg("repoURL", &repoURL, true, true),
		util.BindJsonArg("repoHash", &repoHash, true, true),
		util.BindJsonArg("packageName", &packageName, true, true),
		util.BindJsonArg("mode", &mode, true, false),
	) {
		return
	}
	err := model.InstallBazaarPackage("themes", repoURL, repoHash, packageName, int(mode))
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}

	// TODO 安装新主题之后，不应该始终取消外观模式“跟随系统” https://github.com/siyuan-note/siyuan/issues/16990
	// 安装集市主题后不跟随系统切换外观模式
	model.Conf.Appearance.ModeOS = false
	model.Conf.Save()

	util.PushMsg(model.Conf.Language(69), 3000)
	ret.Data = map[string]interface{}{
		"packages":   model.GetBazaarPackages("themes", "", keyword),
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

	var keyword, packageName string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("keyword", &keyword, false, false),
		util.BindJsonArg("packageName", &packageName, true, true),
	) {
		return
	}
	err := model.UninstallPackage("themes", packageName)
	if err != nil {
		ret.Code = -1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]interface{}{
		"packages":   model.GetBazaarPackages("themes", "", keyword),
		"appearance": model.Conf.Appearance,
	}
}
