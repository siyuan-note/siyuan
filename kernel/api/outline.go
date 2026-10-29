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
	if notebook != "" && model.IsEncryptedBox(notebook) {
		headings, err = model.OutlineInBox(rootID, preview, notebook)
	} else {
		headings, err = model.Outline(rootID, preview)
	}
	if err != nil {
		return apicontract.Failure[[]*apicontract.SearchPath](1, err.Error())
	}
	if model.IsReadOnlyRoleContext(c) {
		publishAccess := model.GetPublishAccess()
		bt := treenode.GetBlockTree(rootID)
		if bt != nil {
			passwordID, password := model.GetPathPasswordByPublishAccess(bt.BoxID, bt.Path, publishAccess)
			if password != "" && !model.CheckPublishAuthCookie(c, passwordID, password) {
				headings = nil
			}
			publishIgnore := model.GetDisablePublishAccess(publishAccess)
			if !model.CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishIgnore) {
				headings = nil
			}
		}
	}
	return apicontract.Success(searchPathContracts(headings))
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
		if nil == bt {
			numbers = map[string]string{}
		} else {
			passwordID, password := model.GetPathPasswordByPublishAccess(bt.BoxID, bt.Path, publishAccess)
			if "" != password && !model.CheckPublishAuthCookie(c, passwordID, password) {
				numbers = map[string]string{}
			}
			publishIgnore := model.GetDisablePublishAccess(publishAccess)
			if !model.CheckPathAccessableByPublishIgnore(bt.BoxID, bt.Path, publishIgnore) {
				numbers = map[string]string{}
			}
		}
	}

	return apicontract.Success(numbers)
})
