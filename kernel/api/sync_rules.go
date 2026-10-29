// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var getSyncProviderConfigRules = contractHandler(apicontract.GetSyncProviderConfigRules, getSyncProviderConfigRulesContract)

func getSyncProviderConfigRulesContract(_ *gin.Context, request apicontract.SyncProviderConfigRulesRequest) apicontract.Response[apicontract.SyncProviderConfigRulesData] {
	fields := conf.SyncProviderRequiredFields(request.Provider)
	if len(fields) == 0 {
		return apicontract.Failure[apicontract.SyncProviderConfigRulesData](-1, "invalid sync provider")
	}
	return apicontract.Success(apicontract.SyncProviderConfigRulesData{
		RequiredFields:        fields,
		EndpointBucketWarning: request.Provider == conf.ProviderS3 && conf.S3EndpointIncludesBucketOrPath(request.Endpoint, request.Bucket),
	})
}

var testSyncProviderS3 = contractHandler(apicontract.TestSyncProviderS3, testSyncProviderS3Contract)

func testSyncProviderS3Contract(_ *gin.Context, request apicontract.TestSyncProviderS3Request) apicontract.Response[apicontract.TestSyncProviderS3Data] {
	kind, msg := model.TestSyncProviderS3((*conf.S3)(&request.S3))
	return apicontract.Success(apicontract.TestSyncProviderS3Data{Kind: kind, Msg: msg})
}

var testSyncProviderWebDAV = contractHandler(apicontract.TestSyncProviderWebDAV, testSyncProviderWebDAVContract)

func testSyncProviderWebDAVContract(_ *gin.Context, request apicontract.TestSyncProviderWebDAVRequest) apicontract.Response[apicontract.TestSyncProviderS3Data] {
	kind, msg := model.TestSyncProviderWebDAV((*conf.WebDAV)(&request.WebDAV), request.CloudName)
	return apicontract.Success(apicontract.TestSyncProviderS3Data{Kind: kind, Msg: msg})
}

var testSyncProviderLocal = contractHandler(apicontract.TestSyncProviderLocal, testSyncProviderLocalContract)

func testSyncProviderLocalContract(_ *gin.Context, request apicontract.TestSyncProviderLocalRequest) apicontract.Response[apicontract.TestSyncProviderS3Data] {
	kind, msg := model.TestSyncProviderLocal((*conf.Local)(&request.Local))
	return apicontract.Success(apicontract.TestSyncProviderS3Data{Kind: kind, Msg: msg})
}
