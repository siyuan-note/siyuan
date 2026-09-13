package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var findAssetReferences = contractHandler(apicontract.FindAssetReferences, func(c *gin.Context, request apicontract.FindAssetReferencesRequest) apicontract.Response[apicontract.AssetReferencesData] {
	if request.Paths != nil {
		if request.Path != nil {
			return apicontract.Failure[apicontract.AssetReferencesData](-1, "path and paths are mutually exclusive")
		}
		data, err := model.FindAssetReferencesBatch(c.Request.Context(), request.Paths)
		if err != nil {
			return apicontract.FindAssetReferences.FailureWithData(-1, err.Error(), data)
		}
		return apicontract.Success(data)
	}
	if request.Path == nil {
		return apicontract.Failure[apicontract.AssetReferencesData](-1, "[path] is required")
	}
	data, err := model.FindAssetReferencesWithContext(c.Request.Context(), *request.Path)
	if err != nil {
		return apicontract.Failure[apicontract.AssetReferencesData](-1, err.Error())
	}
	return apicontract.Success(data)
})

var relinkAsset = contractHandler(apicontract.RelinkAsset, func(c *gin.Context, request apicontract.RelinkAssetRequest) apicontract.Response[apicontract.AssetReferencesData] {
	if request.Mappings != nil {
		if request.OldPath != nil || request.NewPath != nil {
			return apicontract.Failure[apicontract.AssetReferencesData](-1, "oldPath/newPath and mappings are mutually exclusive")
		}
		data, err := model.RelinkAssets(c.Request.Context(), request.Mappings, request.DryRun)
		if err != nil {
			return apicontract.RelinkAsset.FailureWithData(-1, err.Error(), data)
		}
		return apicontract.Success(data)
	}
	if request.OldPath == nil {
		return apicontract.Failure[apicontract.AssetReferencesData](-1, "[oldPath] is required")
	}
	if request.NewPath == nil {
		return apicontract.Failure[apicontract.AssetReferencesData](-1, "[newPath] is required")
	}
	data, err := model.RelinkAssetWithContext(c.Request.Context(), *request.OldPath, *request.NewPath, request.DryRun)
	if err != nil {
		return apicontract.RelinkAsset.FailureWithData(-1, err.Error(), data)
	}
	return apicontract.Success(data)
})
