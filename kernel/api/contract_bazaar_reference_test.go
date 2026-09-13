package api

import (
	"errors"
	"github.com/88250/gulu"
	"github.com/siyuan-note/siyuan/kernel/bazaar"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func bazaarPackageRatingsResponseData(ratings map[string]*bazaar.PackageRating,
	eligiblePackageNames []string) map[string]any {
	return map[string]any{
		"ratings":              ratings,
		"eligiblePackageNames": eligiblePackageNames,
	}
}
func bazaarPackageUserRatingsResponseData(userRatings map[string]int, eligiblePackageNames []string) map[string]any {
	return map[string]any{
		"userRatings":          userRatings,
		"eligiblePackageNames": eligiblePackageNames,
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
func setBazaarPackageRatingError(ret *gulu.Result, err error) {
	ret.Code = 1
	ret.Msg = err.Error()
	if errors.Is(err, model.ErrBazaarRatingRateLimited) {
		ret.Data = map[string]any{"errorCode": "bazaarRatingRateLimited"}
	}
	if errors.Is(err, model.ErrBazaarPackagePending) {
		ret.Data = map[string]any{"errorCode": "bazaarPackagePending"}
	}
}
