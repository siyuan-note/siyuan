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
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var prepareDataImport = contractHandler(apicontract.PrepareDataImport, func(c *gin.Context, request apicontract.ImportDataRequest) apicontract.Response[apicontract.DataImportPlan] {
	defer util.ClearPushProgress(100)
	p, cleanup, err := saveImportUploadFile(c, request.File)
	if err != nil {
		return apicontract.Failure[apicontract.DataImportPlan](-1, err.Error())
	}
	defer cleanup()
	plan, err := model.PrepareDataImport(p)
	if err != nil {
		return apicontract.Failure[apicontract.DataImportPlan](-1, err.Error())
	}
	return apicontract.Success(apicontract.DataImportPlan{ID: plan.ID, Conflicts: plan.Conflicts, Encrypted: plan.Encrypted})
}, beginImportUpload[apicontract.DataImportPlan])

var commitDataImport = contractHandler(apicontract.CommitDataImport, func(c *gin.Context, request apicontract.CommitDataImportRequest) apicontract.Response[apicontract.DataImportResult] {
	util.PushEndlessProgress(model.Conf.Language(73))
	defer util.ClearPushProgress(100)
	skipped, err := model.CommitDataImport(request.ID, string(request.Mode), request.Password)
	if err != nil {
		return apicontract.Failure[apicontract.DataImportResult](-1, err.Error())
	}
	model.FullReindexDirect()
	return apicontract.Success(apicontract.DataImportResult{Skipped: skipped})
})

var cancelDataImport = contractHandler(apicontract.CancelDataImport, func(c *gin.Context, request apicontract.DataImportRequest) apicontract.Response[apicontract.Null] {
	if err := model.CancelDataImport(request.ID); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})
