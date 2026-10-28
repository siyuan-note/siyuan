// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"fmt"
	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func validateBacklinkDatabaseRequest(c *gin.Context, filter *model.BacklinkSourceFilter, boxID string) error {
	if filter == nil || filter.Database == nil {
		return nil
	}
	if model.IsReadOnlyRoleContext(c) {
		return fmt.Errorf("database field filtering is unavailable to published readers")
	}
	return model.ValidateBacklinkDatabaseFilter(filter, boxID)
}

var getBacklinkDatabases = contractHandler(apicontract.GetBacklinkDatabases, func(c *gin.Context, request apicontract.BacklinkDatabasesRequest) apicontract.Response[[]*apicontract.BacklinkDatabase] {
	if !ast.IsNodeIDPattern(request.ID) {
		return apicontract.Failure[[]*apicontract.BacklinkDatabase](-1, "invalid block ID")
	}
	if model.IsReadOnlyRoleContext(c) || isEncryptedNotebookDeniedForPublish(c, request.Notebook) {
		return apicontract.Success([]*apicontract.BacklinkDatabase{})
	}
	boxID := request.Notebook
	if !model.IsEncryptedBox(boxID) {
		boxID = ""
	}
	if err := holdEncryptedBoxRequest(c, boxID); err != nil {
		return apicontract.Failure[[]*apicontract.BacklinkDatabase](1, err.Error())
	}
	containChildren := model.Conf.Editor.Load().BacklinkContainChildren
	if request.ContainChildren != nil {
		containChildren = *request.ContainChildren
	}
	items, err := model.GetBacklinkDatabases(request.ID, request.Keyword, boxID, containChildren, backlinkSourceFilterModel(request.SourceFilter))
	if err != nil {
		return apicontract.Failure[[]*apicontract.BacklinkDatabase](1, err.Error())
	}
	ret := []*apicontract.BacklinkDatabase{}
	for _, item := range items {
		ret = append(ret, &apicontract.BacklinkDatabase{ID: item.ID, Name: item.Name,
			Keys: avContractSlice(item.Keys, toContractAVKey)})
	}
	return apicontract.Success(ret)
})
