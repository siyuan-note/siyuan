// SiYuan - From thought to insight, with agents
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
	"errors"
	"io"
	"math"
	"net/http"
	"os"
	"path/filepath"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
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

var (
	getBazaarPackageUserRatingsModel = model.GetInstalledBazaarPackageUserRatings
	setBazaarPackageRatingModel      = model.SetBazaarPackageRating
)

func installLocalBazaarPackage(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, bazaar.MaxLocalPackageArchiveSize+1024*1024)
	fileHeader, err := c.FormFile("file")
	if err != nil {
		ret.Code = 1
		ret.Msg = "Marketplace package file is required"
		return
	}
	if fileHeader.Size > bazaar.MaxLocalPackageArchiveSize {
		ret.Code = 1
		ret.Msg = "Marketplace package file is too large"
		return
	}

	tempDir := filepath.Join(util.TempDir, "bazaar", "upload", gulu.Rand.String(7))
	if err = os.MkdirAll(tempDir, 0755); err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}
	defer os.RemoveAll(tempDir)
	archivePath := filepath.Join(tempDir, "package.zip")
	uploaded, err := fileHeader.Open()
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}
	defer uploaded.Close()
	target, err := os.OpenFile(archivePath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}
	written, copyErr := io.Copy(target, io.LimitReader(uploaded, bazaar.MaxLocalPackageArchiveSize+1))
	closeErr := target.Close()
	if copyErr != nil {
		ret.Code = 1
		ret.Msg = copyErr.Error()
		return
	}
	if closeErr != nil {
		ret.Code = 1
		ret.Msg = closeErr.Error()
		return
	}
	if written > bazaar.MaxLocalPackageArchiveSize {
		ret.Code = 1
		ret.Msg = "Marketplace package file is too large"
		return
	}

	result, installErr := model.InstallLocalBazaarPackage(archivePath, c.PostForm("frontend"), c.PostForm("overwrite") == "true")
	if installErr != nil {
		ret.Code = 1
		ret.Msg = installErr.Error()
		if result != nil {
			reason := "install-failed"
			if errors.Is(installErr, model.ErrLocalBazaarPackageExists) {
				reason = "package-exists"
			} else if errors.Is(installErr, model.ErrLocalBazaarPackageIncompatible) {
				reason = "package-incompatible"
			}
			ret.Data = map[string]any{
				"reason":        reason,
				"packageType":   result.PackageType,
				"packageName":   result.PackageName,
				"minAppVersion": result.MinAppVersion,
			}
		}
		return
	}
	ret.Data = result
}

func batchUpdatePackage(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var frontend string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("frontend", &frontend, true, true)) {
		return
	}

	if err := model.BatchUpdatePackages(frontend); err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
	}
}

func getUpdatedPackage(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var frontend string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("frontend", &frontend, true, true)) {
		return
	}

	plugins, widgets, icons, themes, templates, err := model.GetUpdatedPackages(frontend)
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}
	ret.Data = map[string]any{
		"plugins":   plugins,
		"widgets":   widgets,
		"icons":     icons,
		"themes":    themes,
		"templates": templates,
	}
}

func updateBazaarPackage(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var pkgType, packageName, frontend, keyword string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("packageType", &pkgType, true, true),
		util.BindJsonArg("packageName", &packageName, true, true),
		util.BindJsonArg("frontend", &frontend, true, true),
		util.BindJsonArg("keyword", &keyword, false, false),
	) {
		return
	}
	if !validPackageTypes[pkgType] {
		ret.Code = 1
		ret.Msg = "Invalid package type"
		return
	}
	if err := model.UpdateBazaarPackage(pkgType, packageName, frontend); err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}
	util.PushMsg(model.Conf.Language(69), 3000)
	ret.Data = map[string]any{
		"packages": model.GetBazaarPackages(pkgType, frontend, keyword),
	}
}

func getInstalledPackageSize(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var pkgType, packageName string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("packageType", &pkgType, true, true),
		util.BindJsonArg("packageName", &packageName, true, true),
	) {
		return
	}
	if !validPackageTypes[pkgType] {
		ret.Code = 1
		ret.Msg = "Invalid package type"
		return
	}
	size, hSize, err := model.GetInstalledPackageSize(pkgType, packageName)
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}
	ret.Data = map[string]any{
		"installSize":  size,
		"hInstallSize": hSize,
	}
}

func getBazaarPackage(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var pkgType, packageName, frontend string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("packageType", &pkgType, true, true),
		util.BindJsonArg("packageName", &packageName, true, true),
		util.BindJsonArg("frontend", &frontend, false, true),
	) {
		return
	}
	if !validPackageTypes[pkgType] {
		ret.Code = 1
		ret.Msg = "Invalid package type"
		return
	}
	installed, available := model.GetBazaarPackageDetail(pkgType, packageName, frontend)
	ret.Data = map[string]any{
		"installed": installed,
		"available": available,
	}
}

func getBazaarPackageRatings(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var pkgType string
	var packageNamesArg []any
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("packageType", &pkgType, true, true),
		util.BindJsonArg("packageNames", &packageNamesArg, true, false),
	) {
		return
	}
	if !validPackageTypes[pkgType] {
		ret.Code = 1
		ret.Msg = "Invalid package type"
		return
	}

	packageNames := make([]string, 0, len(packageNamesArg))
	for _, item := range packageNamesArg {
		packageName, elemOK := item.(string)
		if !elemOK {
			ret.Code = -1
			ret.Msg = "Field [packageNames]: each element should be of type [String]"
			return
		}
		packageNames = append(packageNames, packageName)
	}

	ratings, eligiblePackageNames, err := model.GetInstalledBazaarPackageRatings(c.Request.Context(), pkgType, packageNames)
	if nil != err {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}
	ret.Data = bazaarPackageRatingsResponseData(ratings, eligiblePackageNames)
}

func bazaarPackageRatingsResponseData(ratings map[string]*bazaar.PackageRating,
	eligiblePackageNames []string) map[string]any {
	return map[string]any{
		"ratings":              ratings,
		"eligiblePackageNames": eligiblePackageNames,
	}
}

func getBazaarPackageUserRatings(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var pkgType string
	var packageNamesArg []any
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("packageType", &pkgType, true, true),
		util.BindJsonArg("packageNames", &packageNamesArg, true, false),
	) {
		return
	}
	if !validPackageTypes[pkgType] {
		ret.Code = 1
		ret.Msg = "Invalid package type"
		return
	}

	packageNames := make([]string, 0, len(packageNamesArg))
	for _, item := range packageNamesArg {
		packageName, elemOK := item.(string)
		if !elemOK {
			ret.Code = -1
			ret.Msg = "Field [packageNames]: each element should be of type [String]"
			return
		}
		packageNames = append(packageNames, packageName)
	}

	userRatings, eligiblePackageNames, err := getBazaarPackageUserRatingsModel(
		c.Request.Context(), pkgType, packageNames)
	if nil != err {
		setBazaarPackageRatingError(ret, err)
		return
	}
	ret.Data = bazaarPackageUserRatingsResponseData(userRatings, eligiblePackageNames)
}

func bazaarPackageUserRatingsResponseData(userRatings map[string]int, eligiblePackageNames []string) map[string]any {
	return map[string]any{
		"userRatings":          userRatings,
		"eligiblePackageNames": eligiblePackageNames,
	}
}

func getBazaarPackageRating(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var pkgType, packageName string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("packageType", &pkgType, true, true),
		util.BindJsonArg("packageName", &packageName, true, true),
	) {
		return
	}
	if !validPackageTypes[pkgType] {
		ret.Code = 1
		ret.Msg = "Invalid package type"
		return
	}

	rating, ratingAvailable, userRating, err := model.GetBazaarPackageRating(c.Request.Context(), pkgType, packageName)
	if nil != err {
		setBazaarPackageRatingError(ret, err)
		return
	}
	ret.Data = bazaarPackageRatingResponseData(rating, ratingAvailable, userRating)
}

func setBazaarPackageRating(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var pkgType, packageName string
	var ratingArg float64
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("packageType", &pkgType, true, true),
		util.BindJsonArg("packageName", &packageName, true, true),
		util.BindJsonArg("rating", &ratingArg, true, false),
	) {
		return
	}
	if !validPackageTypes[pkgType] {
		ret.Code = 1
		ret.Msg = "Invalid package type"
		return
	}
	if ratingArg < 0 || 5 < ratingArg || ratingArg != math.Trunc(ratingArg) {
		ret.Code = 1
		ret.Msg = "Rating must be an integer from 0 to 5"
		return
	}

	rating, ratingAvailable, userRating, err := setBazaarPackageRatingModel(
		c.Request.Context(), pkgType, packageName, int(ratingArg))
	if nil != err {
		setBazaarPackageRatingError(ret, err)
		return
	}
	ret.Data = bazaarPackageRatingResponseData(rating, ratingAvailable, userRating)
}

func setBazaarPackageRatingError(ret *gulu.Result, err error) {
	ret.Code = 1
	ret.Msg = err.Error()
	if errors.Is(err, model.ErrBazaarRatingRateLimited) {
		ret.Data = map[string]any{"errorCode": "bazaarRatingRateLimited"}
	}
}

func bazaarPackageRatingResponseData(rating *bazaar.PackageRating, ratingAvailable bool, userRating int) map[string]any {
	ret := map[string]any{
		"ratingAvailable": ratingAvailable,
		"userRating":      userRating,
	}
	if nil != rating {
		ret["rating"] = rating
	}
	return ret
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
	ret.Data = map[string]any{
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

	ret.Data = map[string]any{
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

	ret.Data = map[string]any{
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

	var frontend, keyword, repoURL, repoHash, repoRef, packageName string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("frontend", &frontend, true, true),
		util.BindJsonArg("keyword", &keyword, false, false),
		util.BindJsonArg("repoURL", &repoURL, true, true),
		util.BindJsonArg("repoHash", &repoHash, true, true),
		util.BindJsonArg("repoRef", &repoRef, false, false),
		util.BindJsonArg("packageName", &packageName, true, true),
	) {
		return
	}
	err := model.InstallBazaarPackage("plugins", repoURL, repoHash, repoRef, packageName, nil)
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}

	util.PushMsg(model.Conf.Language(69), 3000)
	ret.Data = map[string]any{
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

	ret.Data = map[string]any{
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

	ret.Data = map[string]any{
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

	var keyword, repoURL, repoHash, repoRef, packageName string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("keyword", &keyword, false, false),
		util.BindJsonArg("repoURL", &repoURL, true, true),
		util.BindJsonArg("repoHash", &repoHash, true, true),
		util.BindJsonArg("repoRef", &repoRef, false, false),
		util.BindJsonArg("packageName", &packageName, true, true),
	) {
		return
	}
	err := model.InstallBazaarPackage("widgets", repoURL, repoHash, repoRef, packageName, nil)
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}

	util.PushMsg(model.Conf.Language(69), 3000)
	ret.Data = map[string]any{
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

	ret.Data = map[string]any{
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

	ret.Data = map[string]any{
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

	ret.Data = map[string]any{
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

	var keyword, repoURL, repoHash, repoRef, packageName string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("keyword", &keyword, false, false),
		util.BindJsonArg("repoURL", &repoURL, true, true),
		util.BindJsonArg("repoHash", &repoHash, true, true),
		util.BindJsonArg("repoRef", &repoRef, false, false),
		util.BindJsonArg("packageName", &packageName, true, true),
	) {
		return
	}
	err := model.InstallBazaarPackage("icons", repoURL, repoHash, repoRef, packageName, nil)
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}
	util.PushMsg(model.Conf.Language(69), 3000)

	ret.Data = map[string]any{
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

	ret.Data = map[string]any{
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

	ret.Data = map[string]any{
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

	ret.Data = map[string]any{
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

	var keyword, repoURL, repoHash, repoRef, packageName string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("keyword", &keyword, false, false),
		util.BindJsonArg("repoURL", &repoURL, true, true),
		util.BindJsonArg("repoHash", &repoHash, true, true),
		util.BindJsonArg("repoRef", &repoRef, false, false),
		util.BindJsonArg("packageName", &packageName, true, true),
	) {
		return
	}
	err := model.InstallBazaarPackage("templates", repoURL, repoHash, repoRef, packageName, nil)
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}

	ret.Data = map[string]any{
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

	ret.Data = map[string]any{
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

	var frontend, keyword string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("frontend", &frontend, false, false),
		util.BindJsonArg("keyword", &keyword, false, false),
	) {
		return
	}

	ret.Data = map[string]any{
		"packages": model.GetBazaarPackages("themes", frontend, keyword),
	}
}

func getInstalledTheme(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var frontend, keyword string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("frontend", &frontend, false, false),
		util.BindJsonArg("keyword", &keyword, false, false),
	) {
		return
	}

	ret.Data = map[string]any{
		"packages": model.GetInstalledPackages("themes", frontend, keyword),
	}
}

func installBazaarTheme(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var frontend, keyword, repoURL, repoHash, repoRef, packageName string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("frontend", &frontend, false, false),
		util.BindJsonArg("keyword", &keyword, false, false),
		util.BindJsonArg("repoURL", &repoURL, true, true),
		util.BindJsonArg("repoHash", &repoHash, true, true),
		util.BindJsonArg("repoRef", &repoRef, false, false),
		util.BindJsonArg("packageName", &packageName, true, true),
	) {
		return
	}

	_, hasMode := arg["mode"]
	_, hasModeOS := arg["modeOS"]
	if hasMode != hasModeOS {
		ret.Code = -1
		ret.Msg = "Fields [mode] and [modeOS] must be provided together"
		return
	}

	var themeOptions *model.ThemeInstallOptions
	if hasMode {
		var mode float64
		var modeOS bool
		if !util.ParseJsonArgs(arg, ret,
			util.BindJsonArg("mode", &mode, true, false),
			util.BindJsonArg("modeOS", &modeOS, true, false),
		) {
			return
		}
		if 0 != mode && 1 != mode {
			ret.Code = -1
			ret.Msg = "Field [mode] must be 0 or 1"
			return
		}
		themeOptions = &model.ThemeInstallOptions{Mode: int(mode), ModeOS: modeOS}
	}

	err := model.InstallBazaarPackage("themes", repoURL, repoHash, repoRef, packageName, themeOptions)
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		return
	}

	util.PushMsg(model.Conf.Language(69), 3000)
	ret.Data = map[string]any{
		"packages":   model.GetBazaarPackages("themes", frontend, keyword),
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

	var frontend, keyword, packageName string
	if !util.ParseJsonArgs(arg, ret,
		util.BindJsonArg("frontend", &frontend, false, false),
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

	ret.Data = map[string]any{
		"packages":   model.GetBazaarPackages("themes", frontend, keyword),
		"appearance": model.Conf.Appearance,
	}
}
