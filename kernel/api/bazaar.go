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
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/conf"
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

var installLocalBazaarPackage = contractHandler(apicontract.InstallLocalBazaarPackage, func(c *gin.Context, request apicontract.InstallLocalBazaarPackageRequest) apicontract.Response[apicontract.BazaarLocalInstallResult] {
	fileHeader := request.File
	if fileHeader == nil {
		return apicontract.Failure[apicontract.BazaarLocalInstallResult](1, "Marketplace package file is required")
	}
	var err error

	if fileHeader.Size > bazaar.MaxLocalPackageArchiveSize {
		return apicontract.Failure[apicontract.BazaarLocalInstallResult](1, "Marketplace package file is too large")
	}

	tempDir := filepath.Join(util.TempDir, "bazaar", "upload", gulu.Rand.String(7))
	if err = os.MkdirAll(tempDir, 0755); err != nil {
		return apicontract.Failure[apicontract.BazaarLocalInstallResult](1, err.Error())
	}
	defer os.RemoveAll(tempDir)
	archivePath := filepath.Join(tempDir, "package.zip")
	uploaded, err := fileHeader.Open()
	if err != nil {
		return apicontract.Failure[apicontract.BazaarLocalInstallResult](1, err.Error())
	}
	defer uploaded.Close()
	target, err := os.OpenFile(archivePath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
	if err != nil {
		return apicontract.Failure[apicontract.BazaarLocalInstallResult](1, err.Error())
	}
	written, copyErr := io.Copy(target, io.LimitReader(uploaded, bazaar.MaxLocalPackageArchiveSize+1))
	closeErr := target.Close()
	if copyErr != nil {
		return apicontract.Failure[apicontract.BazaarLocalInstallResult](1, copyErr.Error())
	}
	if closeErr != nil {
		return apicontract.Failure[apicontract.BazaarLocalInstallResult](1, closeErr.Error())
	}
	if written > bazaar.MaxLocalPackageArchiveSize {
		return apicontract.Failure[apicontract.BazaarLocalInstallResult](1, "Marketplace package file is too large")
	}

	result, installErr := model.InstallLocalBazaarPackage(archivePath, request.Frontend, request.Overwrite == "true")
	if installErr != nil {
		if result != nil {
			reason := "install-failed"
			if errors.Is(installErr, model.ErrLocalBazaarPackageExists) {
				reason = "package-exists"
			} else if errors.Is(installErr, model.ErrLocalBazaarPackageIncompatible) {
				reason = "package-incompatible"
			}
			return apicontract.InstallLocalBazaarPackage.FailureWithData(1, installErr.Error(), apicontract.NewBazaarLocalInstallResultError(apicontract.BazaarLocalInstallError{Reason: reason, PackageType: result.PackageType, PackageName: result.PackageName, MinAppVersion: result.MinAppVersion}))
		}
		return apicontract.Failure[apicontract.BazaarLocalInstallResult](1, installErr.Error())
	}
	return apicontract.Success(apicontract.NewBazaarLocalInstallResult(apicontract.BazaarLocalInstallData{PackageType: result.PackageType, PackageName: result.PackageName, MinAppVersion: result.MinAppVersion, Updated: result.Updated}))
}, prepareLocalBazaarUpload)

var batchUpdatePackage = contractHandler(apicontract.BatchUpdatePackage, func(c *gin.Context, request apicontract.BatchUpdatePackageRequest) apicontract.Response[apicontract.Null] {
	if err := model.BatchUpdatePackages(request.Frontend); err != nil {
		return apicontract.Failure[apicontract.Null](1, err.Error())
	}

	return apicontract.Success(apicontract.Null{})
})

var getUpdatedPackage = contractHandler(apicontract.GetUpdatedPackage, func(c *gin.Context, request apicontract.GetUpdatedPackageRequest) apicontract.Response[apicontract.BazaarUpdatedData] {
	plugins, widgets, icons, themes, templates, err := model.GetUpdatedPackages(request.Frontend)
	if err != nil {
		return apicontract.Failure[apicontract.BazaarUpdatedData](1, err.Error())
	}
	data := apicontract.BazaarUpdatedData{Plugins: bazaarUpdatedPackages(plugins), Widgets: bazaarUpdatedPackages(widgets), Icons: bazaarUpdatedPackages(icons), Themes: bazaarUpdatedPackages(themes), Templates: bazaarUpdatedPackages(templates)}

	return apicontract.Success(data)
})

var updateBazaarPackage = contractHandler(apicontract.UpdateBazaarPackage, func(c *gin.Context, request apicontract.UpdateBazaarPackageRequest) apicontract.Response[apicontract.BazaarPackagesData] {
	if !validPackageTypes[request.PackageType] {
		return apicontract.Failure[apicontract.BazaarPackagesData](1, "Invalid package type")
	}
	if err := model.UpdateBazaarPackage(request.PackageType, request.PackageName, request.Frontend); err != nil {
		return apicontract.Failure[apicontract.BazaarPackagesData](1, err.Error())
	}
	util.PushMsg(model.Conf.Language(69), 3000)
	data := apicontract.BazaarPackagesData{Packages: bazaarPackages(model.GetBazaarPackages(request.PackageType, request.Frontend, request.Keyword))}

	return apicontract.Success(data)
})

var getInstalledPackageSize = contractHandler(apicontract.GetInstalledPackageSize, func(c *gin.Context, request apicontract.GetInstalledPackageSizeRequest) apicontract.Response[apicontract.BazaarPackageSizeData] {
	if !validPackageTypes[request.PackageType] {
		return apicontract.Failure[apicontract.BazaarPackageSizeData](1, "Invalid package type")
	}
	size, hSize, err := model.GetInstalledPackageSize(request.PackageType, request.PackageName)
	if err != nil {
		return apicontract.Failure[apicontract.BazaarPackageSizeData](1, err.Error())
	}
	data := apicontract.BazaarPackageSizeData{InstallSize: size, HInstallSize: hSize}

	return apicontract.Success(data)
})

var getBazaarPackage = contractHandler(apicontract.GetBazaarPackage, func(c *gin.Context, request apicontract.GetBazaarPackageRequest) apicontract.Response[apicontract.BazaarPackageDetail] {
	if !validPackageTypes[request.PackageType] {
		return apicontract.Failure[apicontract.BazaarPackageDetail](1, "Invalid package type")
	}
	installed, available := model.GetBazaarPackageDetail(request.PackageType, request.PackageName, request.Frontend)
	data := apicontract.BazaarPackageDetail{Installed: bazaarPackage(installed), Available: bazaarPackage(available)}

	return apicontract.Success(data)
})

var getBazaarPackageRatings = contractHandler(apicontract.GetBazaarPackageRatings, func(c *gin.Context, request apicontract.GetBazaarPackageRatingsRequest) apicontract.Response[apicontract.BazaarRatingsData] {
	if !validPackageTypes[request.PackageType] {
		return apicontract.Failure[apicontract.BazaarRatingsData](1, "Invalid package type")
	}

	if request.NamesError != nil {
		return apicontract.Failure[apicontract.BazaarRatingsData](-1, request.NamesError.Error())
	}

	ratings, eligiblePackageNames, err := model.GetInstalledBazaarPackageRatings(c.Request.Context(), request.PackageType, request.PackageNames)
	if nil != err {
		return apicontract.Failure[apicontract.BazaarRatingsData](1, err.Error())
	}
	return apicontract.Success(apicontract.BazaarRatingsData{Ratings: bazaarRatings(ratings), EligiblePackageNames: eligiblePackageNames})
})

var getBazaarPackageUserRatings = contractHandler(apicontract.GetBazaarPackageUserRatings, func(c *gin.Context, request apicontract.GetBazaarPackageUserRatingsRequest) apicontract.Response[apicontract.BazaarUserRatingsResult] {
	if !validPackageTypes[request.PackageType] {
		return apicontract.Failure[apicontract.BazaarUserRatingsResult](1, "Invalid package type")
	}

	if request.NamesError != nil {
		return apicontract.Failure[apicontract.BazaarUserRatingsResult](-1, request.NamesError.Error())
	}

	userRatings, eligiblePackageNames, err := getBazaarPackageUserRatingsModel(
		c.Request.Context(), request.PackageType, request.PackageNames)
	if nil != err {
		if data := bazaarRatingError(err); data != nil {
			return apicontract.GetBazaarPackageUserRatings.FailureWithData(1, err.Error(), apicontract.NewBazaarUserRatingsResultError(*data))
		}
		return apicontract.Failure[apicontract.BazaarUserRatingsResult](1, err.Error())
	}
	return apicontract.Success(apicontract.NewBazaarUserRatingsResult(apicontract.BazaarUserRatingsData{UserRatings: userRatings, EligiblePackageNames: eligiblePackageNames}))
})

var getBazaarPackageRating = contractHandler(apicontract.GetBazaarPackageRating, func(c *gin.Context, request apicontract.GetBazaarPackageRatingRequest) apicontract.Response[apicontract.BazaarRatingResult] {
	if !validPackageTypes[request.PackageType] {
		return apicontract.Failure[apicontract.BazaarRatingResult](1, "Invalid package type")
	}

	rating, ratingAvailable, userRating, err := model.GetBazaarPackageRating(c.Request.Context(), request.PackageType, request.PackageName)
	if nil != err {
		if data := bazaarRatingError(err); data != nil {
			return apicontract.GetBazaarPackageRating.FailureWithData(1, err.Error(), apicontract.NewBazaarRatingResultError(*data))
		}
		return apicontract.Failure[apicontract.BazaarRatingResult](1, err.Error())
	}
	return apicontract.Success(apicontract.NewBazaarRatingResult(apicontract.BazaarRatingData{Rating: bazaarRating(rating), RatingAvailable: ratingAvailable, UserRating: userRating}))
})

var setBazaarPackageRating = contractHandler(apicontract.SetBazaarPackageRating, func(c *gin.Context, request apicontract.SetBazaarPackageRatingRequest) apicontract.Response[apicontract.BazaarRatingResult] {
	if !validPackageTypes[request.PackageType] {
		return apicontract.Failure[apicontract.BazaarRatingResult](1, "Invalid package type")
	}
	if request.Rating < 0 || 5 < request.Rating || request.Rating != math.Trunc(request.Rating) {
		return apicontract.Failure[apicontract.BazaarRatingResult](1, "Rating must be an integer from 0 to 5")
	}

	rating, ratingAvailable, userRating, err := setBazaarPackageRatingModel(
		c.Request.Context(), request.PackageType, request.PackageName, int(request.Rating))
	if nil != err {
		if data := bazaarRatingError(err); data != nil {
			return apicontract.SetBazaarPackageRating.FailureWithData(1, err.Error(), apicontract.NewBazaarRatingResultError(*data))
		}
		return apicontract.Failure[apicontract.BazaarRatingResult](1, err.Error())
	}
	return apicontract.Success(apicontract.NewBazaarRatingResult(apicontract.BazaarRatingData{Rating: bazaarRating(rating), RatingAvailable: ratingAvailable, UserRating: userRating}))
})

var getBazaarPackageREADME = contractHandler(apicontract.GetBazaarPackageREADME, func(c *gin.Context, request apicontract.GetBazaarPackageREADMERequest) apicontract.Response[apicontract.BazaarREADMEData] {
	if !validPackageTypes[request.PackageType] {
		return apicontract.Failure[apicontract.BazaarREADMEData](-1, "Invalid package type")
	}
	data := apicontract.BazaarREADMEData{HTML: model.GetBazaarPackageREADME(c.Request.Context(), request.RepoURL, request.RepoHash, request.PackageType)}

	return apicontract.Success(data)
})

var getBazaarPlugin = contractHandler(apicontract.GetBazaarPlugin, func(c *gin.Context, request apicontract.GetBazaarPluginRequest) apicontract.Response[apicontract.BazaarPackagesData] {
	data := apicontract.BazaarPackagesData{Packages: bazaarPackages(model.GetBazaarPackages("plugins", request.Frontend, request.Keyword))}

	return apicontract.Success(data)
})

var getInstalledPlugin = contractHandler(apicontract.GetInstalledPlugin, func(c *gin.Context, request apicontract.GetInstalledPluginRequest) apicontract.Response[apicontract.BazaarPackagesData] {
	data := apicontract.BazaarPackagesData{Packages: bazaarPackages(model.GetInstalledPackages("plugins", request.Frontend, request.Keyword))}

	return apicontract.Success(data)
})

var installBazaarPlugin = contractHandler(apicontract.InstallBazaarPlugin, func(c *gin.Context, request apicontract.InstallBazaarPluginRequest) apicontract.Response[apicontract.BazaarPackagesData] {
	err := model.InstallBazaarPackage("plugins", request.RepoURL, request.RepoHash, request.RepoRef, request.PackageName, nil)
	if err != nil {
		return apicontract.Failure[apicontract.BazaarPackagesData](1, err.Error())
	}

	util.PushMsg(model.Conf.Language(69), 3000)
	data := apicontract.BazaarPackagesData{Packages: bazaarPackages(model.GetBazaarPackages("plugins", request.Frontend, request.Keyword))}

	return apicontract.Success(data)
})

var uninstallBazaarPlugin = contractHandler(apicontract.UninstallBazaarPlugin, func(c *gin.Context, request apicontract.UninstallBazaarPluginRequest) apicontract.Response[apicontract.BazaarPackagesData] {
	err := model.UninstallPackage("plugins", request.PackageName)
	if err != nil {
		return apicontract.Failure[apicontract.BazaarPackagesData](-1, err.Error())
	}

	packages := []*apicontract.BazaarPackage{}
	if request.Frontend != "" {
		packages = bazaarPackages(model.GetBazaarPackages("plugins", request.Frontend, request.Keyword))
	}

	data := apicontract.BazaarPackagesData{Packages: packages}

	return apicontract.Success(data)
})

var getBazaarWidget = contractHandler(apicontract.GetBazaarWidget, func(c *gin.Context, request apicontract.GetBazaarWidgetRequest) apicontract.Response[apicontract.BazaarPackagesData] {
	data := apicontract.BazaarPackagesData{Packages: bazaarPackages(model.GetBazaarPackages("widgets", "", request.Keyword))}

	return apicontract.Success(data)
})

var getInstalledWidget = contractHandler(apicontract.GetInstalledWidget, func(c *gin.Context, request apicontract.GetInstalledWidgetRequest) apicontract.Response[apicontract.BazaarPackagesData] {
	data := apicontract.BazaarPackagesData{Packages: bazaarPackages(model.GetInstalledPackages("widgets", "", request.Keyword))}

	return apicontract.Success(data)
})

var installBazaarWidget = contractHandler(apicontract.InstallBazaarWidget, func(c *gin.Context, request apicontract.InstallBazaarWidgetRequest) apicontract.Response[apicontract.BazaarPackagesData] {
	err := model.InstallBazaarPackage("widgets", request.RepoURL, request.RepoHash, request.RepoRef, request.PackageName, nil)
	if err != nil {
		return apicontract.Failure[apicontract.BazaarPackagesData](1, err.Error())
	}

	util.PushMsg(model.Conf.Language(69), 3000)
	data := apicontract.BazaarPackagesData{Packages: bazaarPackages(model.GetBazaarPackages("widgets", "", request.Keyword))}

	return apicontract.Success(data)
})

var uninstallBazaarWidget = contractHandler(apicontract.UninstallBazaarWidget, func(c *gin.Context, request apicontract.UninstallBazaarWidgetRequest) apicontract.Response[apicontract.BazaarPackagesData] {
	err := model.UninstallPackage("widgets", request.PackageName)
	if err != nil {
		return apicontract.Failure[apicontract.BazaarPackagesData](-1, err.Error())
	}

	data := apicontract.BazaarPackagesData{Packages: bazaarPackages(model.GetBazaarPackages("widgets", "", request.Keyword))}

	return apicontract.Success(data)
})

var getBazaarIcon = contractHandler(apicontract.GetBazaarIcon, func(c *gin.Context, request apicontract.GetBazaarIconRequest) apicontract.Response[apicontract.BazaarPackagesData] {
	data := apicontract.BazaarPackagesData{Packages: bazaarPackages(model.GetBazaarPackages("icons", "", request.Keyword))}

	return apicontract.Success(data)
})

var getInstalledIcon = contractHandler(apicontract.GetInstalledIcon, func(c *gin.Context, request apicontract.GetInstalledIconRequest) apicontract.Response[apicontract.BazaarPackagesData] {
	data := apicontract.BazaarPackagesData{Packages: bazaarPackages(model.GetInstalledPackages("icons", "", request.Keyword))}

	return apicontract.Success(data)
})

var installBazaarIcon = contractHandler(apicontract.InstallBazaarIcon, func(c *gin.Context, request apicontract.InstallBazaarIconRequest) apicontract.Response[apicontract.BazaarAppearancePackagesData] {
	err := model.InstallBazaarPackage("icons", request.RepoURL, request.RepoHash, request.RepoRef, request.PackageName, nil)
	if err != nil {
		return apicontract.Failure[apicontract.BazaarAppearancePackagesData](1, err.Error())
	}
	util.PushMsg(model.Conf.Language(69), 3000)

	data := apicontract.BazaarAppearancePackagesData{Packages: bazaarPackages(model.GetBazaarPackages("icons", "", request.Keyword)), Appearance: bazaarAppearance(model.Conf.Appearance)}

	return apicontract.Success(data)
})

var uninstallBazaarIcon = contractHandler(apicontract.UninstallBazaarIcon, func(c *gin.Context, request apicontract.UninstallBazaarIconRequest) apicontract.Response[apicontract.BazaarAppearancePackagesData] {
	err := model.UninstallPackage("icons", request.PackageName)
	if err != nil {
		return apicontract.Failure[apicontract.BazaarAppearancePackagesData](-1, err.Error())
	}

	data := apicontract.BazaarAppearancePackagesData{Packages: bazaarPackages(model.GetBazaarPackages("icons", "", request.Keyword)), Appearance: bazaarAppearance(model.Conf.Appearance)}

	return apicontract.Success(data)
})

var getBazaarTemplate = contractHandler(apicontract.GetBazaarTemplate, func(c *gin.Context, request apicontract.GetBazaarTemplateRequest) apicontract.Response[apicontract.BazaarPackagesData] {
	data := apicontract.BazaarPackagesData{Packages: bazaarPackages(model.GetBazaarPackages("templates", "", request.Keyword))}

	return apicontract.Success(data)
})

var getInstalledTemplate = contractHandler(apicontract.GetInstalledTemplate, func(c *gin.Context, request apicontract.GetInstalledTemplateRequest) apicontract.Response[apicontract.BazaarPackagesData] {
	data := apicontract.BazaarPackagesData{Packages: bazaarPackages(model.GetInstalledPackages("templates", "", request.Keyword))}

	return apicontract.Success(data)
})

var installBazaarTemplate = contractHandler(apicontract.InstallBazaarTemplate, func(c *gin.Context, request apicontract.InstallBazaarTemplateRequest) apicontract.Response[apicontract.BazaarPackagesData] {
	err := model.InstallBazaarPackage("templates", request.RepoURL, request.RepoHash, request.RepoRef, request.PackageName, nil)
	if err != nil {
		return apicontract.Failure[apicontract.BazaarPackagesData](1, err.Error())
	}

	data := apicontract.BazaarPackagesData{Packages: bazaarPackages(model.GetBazaarPackages("templates", "", request.Keyword))}

	util.PushMsg(model.Conf.Language(69), 3000)

	return apicontract.Success(data)
})

var uninstallBazaarTemplate = contractHandler(apicontract.UninstallBazaarTemplate, func(c *gin.Context, request apicontract.UninstallBazaarTemplateRequest) apicontract.Response[apicontract.BazaarPackagesData] {
	err := model.UninstallPackage("templates", request.PackageName)
	if err != nil {
		return apicontract.Failure[apicontract.BazaarPackagesData](-1, err.Error())
	}

	data := apicontract.BazaarPackagesData{Packages: bazaarPackages(model.GetBazaarPackages("templates", "", request.Keyword))}

	return apicontract.Success(data)
})

var getBazaarTheme = contractHandler(apicontract.GetBazaarTheme, func(c *gin.Context, request apicontract.GetBazaarThemeRequest) apicontract.Response[apicontract.BazaarPackagesData] {
	data := apicontract.BazaarPackagesData{Packages: bazaarPackages(model.GetBazaarPackages("themes", request.Frontend, request.Keyword))}

	return apicontract.Success(data)
})

var getInstalledTheme = contractHandler(apicontract.GetInstalledTheme, func(c *gin.Context, request apicontract.GetInstalledThemeRequest) apicontract.Response[apicontract.BazaarPackagesData] {
	data := apicontract.BazaarPackagesData{Packages: bazaarPackages(model.GetInstalledPackages("themes", request.Frontend, request.Keyword))}

	return apicontract.Success(data)
})

var installBazaarTheme = contractHandler(apicontract.InstallBazaarTheme, func(c *gin.Context, request apicontract.InstallBazaarThemeRequest) apicontract.Response[apicontract.BazaarAppearancePackagesData] {
	var themeOptions *model.ThemeInstallOptions
	if request.Mode != nil {
		themeOptions = &model.ThemeInstallOptions{Mode: int(*request.Mode), ModeOS: *request.ModeOS}
	}

	err := model.InstallBazaarPackage("themes", request.RepoURL, request.RepoHash, request.RepoRef, request.PackageName, themeOptions)
	if err != nil {
		return apicontract.Failure[apicontract.BazaarAppearancePackagesData](1, err.Error())
	}

	util.PushMsg(model.Conf.Language(69), 3000)
	data := apicontract.BazaarAppearancePackagesData{Packages: bazaarPackages(model.GetBazaarPackages("themes", request.Frontend, request.Keyword)), Appearance: bazaarAppearance(model.Conf.Appearance)}

	return apicontract.Success(data)
})

var uninstallBazaarTheme = contractHandler(apicontract.UninstallBazaarTheme, func(c *gin.Context, request apicontract.UninstallBazaarThemeRequest) apicontract.Response[apicontract.BazaarAppearancePackagesData] {
	err := model.UninstallPackage("themes", request.PackageName)
	if err != nil {
		return apicontract.Failure[apicontract.BazaarAppearancePackagesData](-1, err.Error())
	}

	data := apicontract.BazaarAppearancePackagesData{Packages: bazaarPackages(model.GetBazaarPackages("themes", request.Frontend, request.Keyword)), Appearance: bazaarAppearance(model.Conf.Appearance)}

	return apicontract.Success(data)
})

func prepareLocalBazaarUpload(c *gin.Context) *apicontract.Response[apicontract.BazaarLocalInstallResult] {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, bazaar.MaxLocalPackageArchiveSize+1024*1024)
	return nil
}
func bazaarRatingError(err error) *apicontract.BazaarRatingError {
	if errors.Is(err, model.ErrBazaarRatingRateLimited) {
		return &apicontract.BazaarRatingError{ErrorCode: "bazaarRatingRateLimited"}
	}
	if errors.Is(err, model.ErrBazaarPackagePending) {
		return &apicontract.BazaarRatingError{ErrorCode: "bazaarPackagePending"}
	}
	return nil
}
func bazaarRating(value *bazaar.PackageRating) *apicontract.BazaarPackageRating {
	if value == nil {
		return nil
	}
	return &apicontract.BazaarPackageRating{Average: value.Average, Count: value.Count, Distribution: value.Distribution}
}
func bazaarRatings(values map[string]*bazaar.PackageRating) map[string]*apicontract.BazaarPackageRating {
	if values == nil {
		return nil
	}
	ret := make(map[string]*apicontract.BazaarPackageRating, len(values))
	for key, value := range values {
		ret[key] = bazaarRating(value)
	}
	return ret
}
func bazaarPackages(values []*bazaar.Package) []*apicontract.BazaarPackage {
	if values == nil {
		return nil
	}
	ret := make([]*apicontract.BazaarPackage, len(values))
	for i, value := range values {
		ret[i] = bazaarPackage(value)
	}
	return ret
}
func bazaarUpdatedPackages(values []*model.UpdatedPackage) []*apicontract.BazaarPackageDetail {
	if values == nil {
		return nil
	}
	ret := make([]*apicontract.BazaarPackageDetail, len(values))
	for i, value := range values {
		if value != nil {
			ret[i] = &apicontract.BazaarPackageDetail{Installed: bazaarPackage(value.Installed), Available: bazaarPackage(value.Available)}
		}
	}
	return ret
}
func bazaarFunding(value *bazaar.Funding) *apicontract.BazaarFunding {
	if value == nil {
		return nil
	}
	ret := &apicontract.BazaarFunding{}
	ret.OpenCollective = value.OpenCollective
	ret.Patreon = value.Patreon
	ret.GitHub = value.GitHub
	ret.Custom = value.Custom
	if value.Links != nil {
		ret.Links = make([]apicontract.BazaarFundingLink, len(value.Links))
		for i, item := range value.Links {
			ret.Links[i] = *bazaarFundingLink(&item)
		}
	}
	return ret
}
func bazaarFundingLink(value *bazaar.FundingLink) *apicontract.BazaarFundingLink {
	if value == nil {
		return nil
	}
	ret := &apicontract.BazaarFundingLink{}
	ret.Label = value.Label
	ret.URL = value.URL
	return ret
}
func bazaarPackage(value *bazaar.Package) *apicontract.BazaarPackage {
	if value == nil {
		return nil
	}
	ret := &apicontract.BazaarPackage{}
	ret.Author = value.Author
	ret.URL = value.URL
	ret.Version = value.Version
	ret.MinAppVersion = value.MinAppVersion
	ret.DisabledInPublish = value.DisabledInPublish
	ret.Kernels = value.Kernels
	ret.Backends = value.Backends
	ret.Frontends = value.Frontends
	ret.BootAppearances = value.BootAppearances
	ret.DisplayName = apicontract.BazaarLocaleStrings(value.DisplayName)
	ret.Description = apicontract.BazaarLocaleStrings(value.Description)
	ret.Readme = apicontract.BazaarLocaleStrings(value.Readme)
	ret.Icon = value.Icon
	ret.Preview = value.Preview
	ret.Funding = bazaarFunding(value.Funding)
	ret.Keywords = value.Keywords
	ret.Deprecated = value.Deprecated
	ret.DeprecatedReason = apicontract.BazaarLocaleStrings(value.DeprecatedReason)
	ret.Alternatives = value.Alternatives
	ret.PreferredFunding = value.PreferredFunding
	ret.PreferredName = value.PreferredName
	ret.PreferredDesc = value.PreferredDesc
	ret.PreferredReadme = value.PreferredReadme
	ret.PreferredDeprecatedReason = value.PreferredDeprecatedReason
	ret.Name = value.Name
	ret.RepoURL = value.RepoURL
	ret.RepoHash = value.RepoHash
	ret.RepoRef = value.RepoRef
	ret.PreviewURL = value.PreviewURL
	ret.IconURL = value.IconURL
	ret.Installed = value.Installed
	ret.HasStorageData = value.HasStorageData
	ret.Outdated = value.Outdated
	ret.Current = value.Current
	ret.Updated = value.Updated
	ret.Stars = value.Stars
	ret.OpenIssues = value.OpenIssues
	ret.Size = value.Size
	ret.HSize = value.HSize
	ret.InstallSize = value.InstallSize
	ret.HInstallSize = value.HInstallSize
	ret.InstallTime = value.InstallTime
	ret.UpdateTime = value.UpdateTime
	ret.HInstallDate = value.HInstallDate
	ret.HUpdated = value.HUpdated
	ret.Downloads = value.Downloads
	ret.DisallowInstall = value.DisallowInstall
	ret.DisallowUpdate = value.DisallowUpdate
	ret.UpdateRequiredMinAppVer = value.UpdateRequiredMinAppVer
	ret.InvalidReason = value.InvalidReason
	ret.RatingAvailable = value.RatingAvailable
	ret.Rating = bazaarRating(value.Rating)
	ret.InstalledIncompatible = value.InstalledIncompatible
	ret.BazaarIncompatible = value.BazaarIncompatible
	ret.Enabled = value.Enabled
	ret.UserDisabledInPublish = value.UserDisabledInPublish
	ret.Modes = value.Modes
	return ret
}
func bazaarAppearance(value *conf.Appearance) *apicontract.BazaarAppearance {
	if value == nil {
		return nil
	}
	ret := &apicontract.BazaarAppearance{}
	ret.BodyGradient = bazaarBodyGradient(value.BodyGradient)
	if value.GlobalFontFamilies != nil {
		ret.GlobalFontFamilies = make([]*apicontract.BazaarEditorFont, len(value.GlobalFontFamilies))
		for i, item := range value.GlobalFontFamilies {
			ret.GlobalFontFamilies[i] = bazaarEditorFont(item)
		}
	}
	ret.Mode = value.Mode
	ret.ModeOS = value.ModeOS
	if value.DarkThemes != nil {
		ret.DarkThemes = make([]*apicontract.BazaarAppearanceTheme, len(value.DarkThemes))
		for i, item := range value.DarkThemes {
			ret.DarkThemes[i] = bazaarAppearanceTheme(item)
		}
	}
	if value.LightThemes != nil {
		ret.LightThemes = make([]*apicontract.BazaarAppearanceTheme, len(value.LightThemes))
		for i, item := range value.LightThemes {
			ret.LightThemes[i] = bazaarAppearanceTheme(item)
		}
	}
	ret.ThemeDark = value.ThemeDark
	ret.ThemeLight = value.ThemeLight
	ret.ThemeVer = value.ThemeVer
	if value.Icons != nil {
		ret.Icons = make([]*apicontract.BazaarAppearanceIcon, len(value.Icons))
		for i, item := range value.Icons {
			ret.Icons[i] = bazaarAppearanceIcon(item)
		}
	}
	ret.Icon = value.Icon
	ret.IconVer = value.IconVer
	ret.CodeBlockThemeLight = value.CodeBlockThemeLight
	ret.CodeBlockThemeDark = value.CodeBlockThemeDark
	ret.Lang = value.Lang
	ret.ThemeJS = value.ThemeJS
	ret.CloseButtonBehavior = value.CloseButtonBehavior
	ret.HideToolbar = value.HideToolbar
	ret.HideStatusBar = value.HideStatusBar
	ret.StatusBar = bazaarStatusBar(value.StatusBar)
	ret.Notifications = bazaarNotifications(value.Notifications)
	ret.EntryVisibility = bazaarEntryVisibility(value.EntryVisibility)
	return ret
}
func bazaarBodyGradient(value *conf.BodyGradient) *apicontract.BazaarBodyGradient {
	if value == nil {
		return nil
	}
	ret := &apicontract.BazaarBodyGradient{}
	ret.Mode = value.Mode
	ret.Light = *bazaarBodyGradientColor(&value.Light)
	ret.Dark = *bazaarBodyGradientColor(&value.Dark)
	return ret
}
func bazaarBodyGradientColor(value *conf.BodyGradientColor) *apicontract.BazaarBodyGradientColor {
	if value == nil {
		return nil
	}
	ret := &apicontract.BazaarBodyGradientColor{}
	ret.Color = value.Color
	ret.Opacity = value.Opacity
	return ret
}
func bazaarAppearanceTheme(value *conf.AppearanceTheme) *apicontract.BazaarAppearanceTheme {
	if value == nil {
		return nil
	}
	ret := &apicontract.BazaarAppearanceTheme{}
	ret.Name = value.Name
	ret.Label = value.Label
	ret.Frontends = value.Frontends
	return ret
}
func bazaarAppearanceIcon(value *conf.AppearanceIcon) *apicontract.BazaarAppearanceIcon {
	if value == nil {
		return nil
	}
	ret := &apicontract.BazaarAppearanceIcon{}
	ret.Name = value.Name
	ret.Label = value.Label
	return ret
}
func bazaarEntryVisibility(value *conf.EntryVisibility) *apicontract.BazaarEntryVisibility {
	if value == nil {
		return nil
	}
	ret := &apicontract.BazaarEntryVisibility{}
	ret.Version = value.Version
	ret.Active = value.Active
	if value.Profiles != nil {
		ret.Profiles = make([]*apicontract.BazaarEntryVisibilityProfile, len(value.Profiles))
		for i, item := range value.Profiles {
			ret.Profiles[i] = bazaarEntryVisibilityProfile(item)
		}
	}
	return ret
}
func bazaarEntryVisibilityProfile(value *conf.EntryVisibilityProfile) *apicontract.BazaarEntryVisibilityProfile {
	if value == nil {
		return nil
	}
	ret := &apicontract.BazaarEntryVisibilityProfile{}
	ret.ID = value.ID
	ret.Name = value.Name
	ret.Entries = value.Entries
	ret.Orders = value.Orders
	return ret
}
func bazaarEditorFont(value *conf.EditorFont) *apicontract.BazaarEditorFont {
	if value == nil {
		return nil
	}
	ret := &apicontract.BazaarEditorFont{}
	ret.Family = value.Family
	ret.Weight = value.Weight
	ret.DisplayName = value.DisplayName
	return ret
}
func bazaarStatusBar(value *util.StatusBar) *apicontract.BazaarStatusBar {
	if value == nil {
		return nil
	}
	ret := &apicontract.BazaarStatusBar{}
	ret.Version = value.Version
	ret.MsgTaskDatabaseIndexCommitDisabled = value.MsgTaskDatabaseIndexCommitDisabled
	ret.MsgTaskHistoryDatabaseIndexCommitDisabled = value.MsgTaskHistoryDatabaseIndexCommitDisabled
	ret.MsgTaskAssetDatabaseIndexCommitDisabled = value.MsgTaskAssetDatabaseIndexCommitDisabled
	ret.MsgTaskHistoryGenerateFileDisabled = value.MsgTaskHistoryGenerateFileDisabled
	ret.MsgDataSyncDisabled = value.MsgDataSyncDisabled
	return ret
}
func bazaarNotifications(value *util.Notifications) *apicontract.BazaarNotifications {
	if value == nil {
		return nil
	}
	ret := &apicontract.BazaarNotifications{}
	ret.DocTreeMaxList = value.DocTreeMaxList
	ret.TagMaxList = value.TagMaxList
	ret.WorkspaceNotSSD = value.WorkspaceNotSSD
	ret.BrowserCompatibility = value.BrowserCompatibility
	ret.SelectAllTip = value.SelectAllTip
	ret.SelectAllIncompleteTip = value.SelectAllIncompleteTip
	ret.FormatPainterTip = value.FormatPainterTip
	return ret
}
