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

package model

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sync"

	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/sync/errgroup"
)

var (
	bazaarRatingCloudServer           = util.GetCloudServer
	bazaarRatingValidatePackage       = validateBazaarPackageRatingRequest0
	bazaarRatingUserToken             = getBazaarRatingUserToken
	bazaarRatingInstalledPackageInfos = GetInstalledPackageInfos
	bazaarRatingExistingPackageNames  = bazaar.GetExistingBazaarPackageNames
	bazaarRatingPublicPackageRatings  = bazaar.GetBazaarPackageRatings
	bazaarRatingAfterUpdate           = bazaar.GetBazaarPackageRatingAfterUpdate
	bazaarRatingSetMu                 sync.Mutex
)

const (
	bazaarPackageRatingBatchSize       = 1024
	bazaarPackageUserRatingConcurrency = 8
)

type bazaarRatingCloudResult[T any] struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
	Data T      `json:"data"`
}

type bazaarPackageUserRatingData struct {
	Rating int `json:"rating"`
}

type bazaarPackageSetRatingData struct {
	Rating          int                   `json:"rating"`
	RatingAvailable *bool                 `json:"ratingAvailable"`
	PublicRating    *bazaar.PackageRating `json:"publicRating"`
	Distribution    []int64               `json:"distribution"`
}

// ErrBazaarRatingRateLimited 表示评分请求受到云端频率限制。
var ErrBazaarRatingRateLimited = errors.New("bazaar rating rate limited")

// GetInstalledBazaarPackageRatings 获取指定已安装包的公开评分。
func GetInstalledBazaarPackageRatings(ctx context.Context, pkgType string,
	packageNames []string) (ratings map[string]*bazaar.PackageRating, eligiblePackageNames []string, err error) {
	eligiblePackageNames, err = getInstalledOfficialBazaarPackageNames(ctx, pkgType, packageNames)
	if nil != err {
		return nil, nil, err
	}
	if 0 == len(eligiblePackageNames) {
		return map[string]*bazaar.PackageRating{}, []string{}, nil
	}
	ratings, available := bazaarRatingPublicPackageRatings(ctx, eligiblePackageNames)
	if !available {
		return nil, nil, errors.New("marketplace package ratings are unavailable")
	}
	return ratings, eligiblePackageNames, nil
}

// GetInstalledBazaarPackageUserRatings 获取指定已安装官方包的当前用户评分。
func GetInstalledBazaarPackageUserRatings(ctx context.Context, pkgType string,
	packageNames []string) (userRatings map[string]int, eligiblePackageNames []string, err error) {
	if !isValidBazaarPackageType(pkgType) {
		return nil, nil, errors.New("invalid package type")
	}
	if bazaarPackageRatingBatchSize < len(packageNames) {
		return nil, nil, errors.New("too many package names")
	}
	token, err := bazaarRatingUserToken()
	if nil != err {
		return nil, nil, err
	}
	eligiblePackageNames, err = getInstalledOfficialBazaarPackageNames(ctx, pkgType, packageNames)
	if nil != err {
		return nil, nil, err
	}
	if 0 == len(eligiblePackageNames) {
		return map[string]int{}, []string{}, nil
	}

	userRatings, err = requestBazaarPackageUserRatings(ctx, token, eligiblePackageNames)
	if nil != err {
		return nil, nil, err
	}
	return userRatings, eligiblePackageNames, nil
}

// GetBazaarPackageRating 获取已安装官方包的公开评分和当前用户评分。
func GetBazaarPackageRating(ctx context.Context, pkgType, packageName string) (rating *bazaar.PackageRating,
	ratingAvailable bool, userRating int, err error) {
	token, err := bazaarRatingValidatePackage(ctx, pkgType, packageName)
	if nil != err {
		return nil, false, 0, err
	}

	data := bazaarPackageUserRatingData{}
	err = requestBazaarPackageRating(ctx, "/apis/siyuan/bazaar/getBazaarPackageRating", map[string]any{
		"token":       token,
		"packageName": packageName,
	}, &data)
	if nil != err {
		return nil, false, 0, err
	}
	if 0 > data.Rating || 5 < data.Rating {
		return nil, false, 0, errors.New("invalid user rating returned by cloud server")
	}

	rating, ratingAvailable = bazaar.GetBazaarPackageRating(ctx, packageName)
	return rating, ratingAvailable, data.Rating, nil
}

// SetBazaarPackageRating 设置或取消已安装官方包的当前用户评分。
func SetBazaarPackageRating(ctx context.Context, pkgType, packageName string, userRating int) (rating *bazaar.PackageRating,
	ratingAvailable bool, retUserRating int, err error) {
	if 0 > userRating || 5 < userRating {
		return nil, false, 0, errors.New("rating must be an integer from 0 to 5")
	}
	bazaarRatingSetMu.Lock()
	defer bazaarRatingSetMu.Unlock()

	token, err := bazaarRatingValidatePackage(ctx, pkgType, packageName)
	if nil != err {
		return nil, false, 0, err
	}

	region := util.CurrentCloudRegion
	data := bazaarPackageSetRatingData{}
	err = requestBazaarPackageRating(ctx, "/apis/siyuan/bazaar/setBazaarPackageRating", map[string]any{
		"token":       token,
		"packageName": packageName,
		"rating":      userRating,
	}, &data)
	if nil != err {
		return nil, false, 0, err
	}
	if data.Rating != userRating {
		return nil, false, 0, errors.New("invalid user rating returned by cloud server")
	}
	if nil != data.RatingAvailable {
		if !*data.RatingAvailable {
			if nil != data.PublicRating {
				return nil, false, 0, errors.New("invalid public rating returned by cloud server")
			}
			if 0 == len(data.Distribution) {
				return nil, false, data.Rating, nil
			}
		} else {
			if nil == data.PublicRating {
				if 0 != data.Rating || !bazaar.ClearBazaarPackageRating(packageName) {
					return nil, false, 0, errors.New("invalid public rating returned by cloud server")
				}
				rating, ratingAvailable = bazaar.GetCachedBazaarPackageRating(packageName)
				if !ratingAvailable || nil != rating {
					return nil, false, 0, errors.New("invalid public rating returned by cloud server")
				}
				return nil, true, data.Rating, nil
			}
			if 0 < data.Rating && 1 > data.PublicRating.Distribution[data.Rating-1] {
				return nil, false, 0, errors.New("invalid public rating returned by cloud server")
			}
			if !bazaar.ApplyBazaarPackageRating(packageName, data.PublicRating) {
				return nil, false, 0, errors.New("invalid public rating returned by cloud server")
			}
			rating, ratingAvailable = bazaar.GetCachedBazaarPackageRating(packageName)
			if !ratingAvailable || nil == rating {
				return nil, false, 0, errors.New("invalid public rating returned by cloud server")
			}
			return rating, true, data.Rating, nil
		}
	} else if nil != data.PublicRating {
		return nil, false, 0, errors.New("invalid public rating returned by cloud server")
	}
	if 5 != len(data.Distribution) {
		return nil, false, 0, errors.New("invalid rating distribution returned by cloud server")
	}
	distribution := [5]int64(data.Distribution)
	if 0 < data.Rating && 1 > distribution[data.Rating-1] {
		return nil, false, 0, errors.New("invalid rating distribution returned by cloud server")
	}
	if !bazaar.ApplyBazaarPackageRatingDistribution(region, packageName, distribution) {
		return nil, false, 0, errors.New("invalid rating distribution returned by cloud server")
	}

	rating, ratingAvailable = bazaarRatingAfterUpdate(ctx, region, packageName, distribution)
	return rating, ratingAvailable, data.Rating, nil
}

func validateBazaarPackageRatingRequest0(ctx context.Context, pkgType, packageName string) (token string, err error) {
	if !isValidBazaarPackageType(pkgType) {
		return "", errors.New("invalid package type")
	}
	if !bazaar.IsValidPackageName(packageName) {
		return "", errors.New("invalid package name")
	}
	token, err = bazaarRatingUserToken()
	if nil != err {
		return "", err
	}

	installedInfos, _, _, err := GetInstalledPackageInfos(pkgType)
	if nil != err {
		return "", err
	}
	installed := false
	for _, info := range installedInfos {
		if "" == info.Pkg.InvalidReason && packageName == info.Pkg.Name {
			installed = true
			break
		}
	}
	if !installed {
		return "", errors.New("marketplace package is not installed")
	}

	exists, err := bazaar.HasBazaarPackage(ctx, pkgType, packageName)
	if nil != err {
		return "", err
	}
	if !exists {
		return "", errors.New("official marketplace package not found")
	}
	return token, nil
}

func getBazaarRatingUserToken() (string, error) {
	user := Conf.GetUser()
	if nil == user || "" == user.UserToken {
		return "", errors.New(Conf.Language(31))
	}
	return user.UserToken, nil
}

func getInstalledOfficialBazaarPackageNames(ctx context.Context, pkgType string,
	packageNames []string) ([]string, error) {
	if !isValidBazaarPackageType(pkgType) {
		return nil, errors.New("invalid package type")
	}
	installedInfos, _, _, err := bazaarRatingInstalledPackageInfos(pkgType)
	if nil != err {
		return nil, err
	}
	installed := make(map[string]bool, len(installedInfos))
	for _, info := range installedInfos {
		if "" == info.Pkg.InvalidReason {
			installed[info.Pkg.Name] = true
		}
	}

	names := make([]string, 0, len(packageNames))
	seen := make(map[string]bool, len(packageNames))
	for _, packageName := range packageNames {
		if !bazaar.IsValidPackageName(packageName) {
			return nil, fmt.Errorf("invalid package name: %s", packageName)
		}
		if !installed[packageName] || seen[packageName] {
			continue
		}
		seen[packageName] = true
		names = append(names, packageName)
	}
	if 0 == len(names) {
		return []string{}, nil
	}
	return bazaarRatingExistingPackageNames(ctx, pkgType, names)
}

// requestBazaarPackageUserRatings 使用有限并发聚合单包查询，避免大量已安装包同时占用云端连接。
func requestBazaarPackageUserRatings(ctx context.Context, token string, packageNames []string) (map[string]int, error) {
	userRatings := make(map[string]int, len(packageNames))
	jobs := make(chan string, len(packageNames))
	for _, packageName := range packageNames {
		jobs <- packageName
	}
	close(jobs)

	group, groupCtx := errgroup.WithContext(ctx)
	workerCount := min(bazaarPackageUserRatingConcurrency, len(packageNames))
	var resultMu sync.Mutex
	for range workerCount {
		group.Go(func() error {
			for {
				select {
				case <-groupCtx.Done():
					return groupCtx.Err()
				case packageName, ok := <-jobs:
					if !ok {
						return nil
					}
					data := bazaarPackageUserRatingData{}
					err := requestBazaarPackageRating(groupCtx, "/apis/siyuan/bazaar/getBazaarPackageRating", map[string]any{
						"token":       token,
						"packageName": packageName,
					}, &data)
					if nil != err {
						return err
					}
					if 0 > data.Rating || 5 < data.Rating {
						return errors.New("invalid user rating returned by cloud server")
					}
					resultMu.Lock()
					userRatings[packageName] = data.Rating
					resultMu.Unlock()
				}
			}
		})
	}
	if err := group.Wait(); nil != err {
		return nil, err
	}
	return userRatings, nil
}

func requestBazaarPackageRating[T any](ctx context.Context, endpoint string, body map[string]any, data *T) error {
	result := bazaarRatingCloudResult[T]{}
	resp, err := httpclient.NewCloudRequest30s().SetContext(ctx).SetSuccessResult(&result).SetBody(body).
		Post(bazaarRatingCloudServer() + endpoint)
	if nil != err {
		logging.LogWarnf("request bazaar package rating failed: %s", err)
		return ErrFailedToConnectCloudServer
	}
	if http.StatusUnauthorized == resp.StatusCode {
		return errors.New(Conf.Language(31))
	}
	if http.StatusTooManyRequests == resp.StatusCode {
		return ErrBazaarRatingRateLimited
	}
	if http.StatusOK != resp.StatusCode {
		logging.LogWarnf("request bazaar package rating failed: %d", resp.StatusCode)
		return ErrFailedToConnectCloudServer
	}
	if 0 != result.Code {
		if "" != result.Msg {
			return errors.New(result.Msg)
		}
		return errors.New("request bazaar package rating failed")
	}
	*data = result.Data
	return nil
}

func isValidBazaarPackageType(pkgType string) bool {
	switch pkgType {
	case "plugins", "widgets", "icons", "templates", "themes":
		return true
	default:
		return false
	}
}
