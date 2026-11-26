// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"github.com/siyuan-note/siyuan/kernel/apicontract"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var getDocOutline = contractHandler(apicontract.GetDocOutline, func(c *gin.Context, request apicontract.OutlineRequest) apicontract.Response[[]*apicontract.SearchPath] {

	if request.ID == nil {
		return apicontract.Success[[]*apicontract.SearchPath](nil)
	}
	rootID, preview := *request.ID, request.Preview
	if err := util.ValidateID(rootID); err != nil {
		return apicontract.FailureFrom[[]*apicontract.SearchPath](err)
	}

	notebook := request.Notebook
	if isEncryptedNotebookDeniedForPublish(c, notebook) {
		return apicontract.Success([]*apicontract.SearchPath{})
	}
	if err := holdEncryptedBoxRequest(c, notebook); err != nil {
		return apicontract.Failure[[]*apicontract.SearchPath](1, err.Error())
	}
	var headings []*model.Path
	var err error
	isReadOnlyRole := model.IsReadOnlyRoleContext(c)
	if isReadOnlyRole {
		publishAccess := model.GetPublishAccess()
		allowed := func(bt *treenode.BlockTree) bool {
			return model.GetBlockTreePublishAccessStatus(c, publishAccess, bt) == model.PublishAccessAllowed
		}
		headings, err = model.OutlineForReader(rootID, preview, allowed, publishHeadingFilter(c, publishAccess))
	} else if notebook != "" && model.IsEncryptedBox(notebook) {
		headings, err = model.OutlineInBox(rootID, preview, notebook)
	} else {
		headings, err = model.Outline(rootID, preview)
	}
	if err != nil {
		return apicontract.Failure[[]*apicontract.SearchPath](1, err.Error())
	}
	var paths []*apicontract.SearchPath
	if isReadOnlyRole {
		paths = searchReaderPathContracts(headings)
	} else {
		paths = searchPathContracts(headings)
	}
	return apicontract.Success(paths)
})

var getDocHeadingNumbers = contractHandler(apicontract.GetDocHeadingNumbers, func(c *gin.Context, request apicontract.HeadingNumbersRequest) apicontract.Response[map[string]string] {

	if request.ID == nil {
		return apicontract.Success[map[string]string](nil)
	}
	rootID := *request.ID
	if err := util.ValidateID(rootID); err != nil {
		return apicontract.FailureFrom[map[string]string](err)
	}
	notebook := request.Notebook
	if isEncryptedNotebookDeniedForPublish(c, notebook) {
		return apicontract.Success(map[string]string{})
	}
	if err := holdEncryptedBoxRequest(c, notebook); err != nil {
		return apicontract.Failure[map[string]string](1, err.Error())
	}
	numbers := map[string]string{}
	var err error
	if notebook != "" && model.IsEncryptedBox(notebook) {
		numbers, err = model.GetHeadingNumbers(rootID, notebook)
	} else {
		numbers, err = model.GetHeadingNumbers(rootID, "")
	}
	if nil != err {
		return apicontract.Failure[map[string]string](1, err.Error())
	}
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		bt := treenode.GetBlockTree(rootID)
		if model.GetBlockTreePublishAccessStatus(c, publishAccess, bt) != model.PublishAccessAllowed {
			numbers = map[string]string{}
		} else {
			allowed := publishHeadingFilter(c, publishAccess)
			for id := range numbers {
				if !allowed(id) {
					delete(numbers, id)
				}
			}
		}
	}

	return apicontract.Success(numbers)
})

func publishHeadingFilter(c *gin.Context, access model.PublishAccess) func(string) bool {
	blocked := make(map[string]bool)
	for _, item := range access {
		allowed := item.Visible
		if item.Password != "" {
			allowed = model.CheckPublishAuthCookie(c, item.ID, item.Password)
		}
		if item.Disable || !allowed {
			blocked[item.ID] = true
		}
	}
	return func(id string) bool { return !blocked[id] }
}
