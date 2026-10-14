package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
)

var getSyncProviderConfigRules = contractHandler(apicontract.GetSyncProviderConfigRules, getSyncProviderConfigRulesContract)

func getSyncProviderConfigRulesContract(_ *gin.Context, request apicontract.SyncProviderConfigRulesRequest) apicontract.Response[apicontract.SyncProviderConfigRulesData] {
	fields := conf.SyncProviderRequiredFields(request.Provider)
	if len(fields) == 0 {
		return apicontract.Failure[apicontract.SyncProviderConfigRulesData](-1, "invalid sync provider")
	}
	return apicontract.Success(apicontract.SyncProviderConfigRulesData{
		RequiredFields:        fields,
		EndpointBucketWarning: request.Provider == conf.ProviderS3 && conf.S3EndpointIncludesBucket(request.Endpoint, request.Bucket),
	})
}
