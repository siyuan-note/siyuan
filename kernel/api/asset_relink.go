package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var findAssetReferences = contractHandler(apicontract.FindAssetReferences, func(c *gin.Context, request apicontract.FindAssetReferencesRequest) apicontract.Response[apicontract.AssetReferencesData] {
	data, err := model.FindAssetReferences(request.Path)
	if err != nil {
		return apicontract.Failure[apicontract.AssetReferencesData](-1, err.Error())
	}
	return apicontract.Success(data)
})

var relinkAsset = contractHandler(apicontract.RelinkAsset, func(c *gin.Context, request apicontract.RelinkAssetRequest) apicontract.Response[apicontract.AssetReferencesData] {
	data, err := model.RelinkAsset(request.OldPath, request.NewPath, request.DryRun)
	if err != nil {
		return apicontract.RelinkAsset.FailureWithData(-1, err.Error(), data)
	}
	return apicontract.Success(data)
})
