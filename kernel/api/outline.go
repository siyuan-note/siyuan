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
	"github.com/siyuan-note/siyuan/kernel/apicontract"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var getDocOutline = contractHandler(apicontract.GetDocOutline, func(c *gin.Context, request apicontract.OutlineRequest) apicontract.Response[[]*apicontract.SearchPath] {
	ret := gulu.Ret.NewResult()

	if request.ID == nil {
		return apicontract.Success[[]*apicontract.SearchPath](nil)
	}
	rootID, preview := *request.ID, request.Preview
	if util.InvalidIDPattern(rootID, ret) {
		return contractFailure[[]*apicontract.SearchPath](ret)
	}

	notebook := request.Notebook
	if isEncryptedNotebookDeniedForPublish(c, notebook) {
		return apicontract.Success([]*apicontract.SearchPath{})
	}
	if err := holdEncryptedBoxRequest(c, notebook); err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		return contractFailure[[]*apicontract.SearchPath](ret)
	}
	var headings []*model.Path
	var err error
	if notebook != "" && model.IsEncryptedBox(notebook) {
		headings, err = model.OutlineInBox(rootID, preview, notebook)
	} else {
		headings, err = model.Outline(rootID, preview)
	}
	if err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		return contractFailure[[]*apicontract.SearchPath](ret)
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
	ret := gulu.Ret.NewResult()

	if request.ID == nil {
		return apicontract.Success[map[string]string](nil)
	}
	rootID := *request.ID
	if util.InvalidIDPattern(rootID, ret) {
		return contractFailure[map[string]string](ret)
	}
	notebook := request.Notebook
	if isEncryptedNotebookDeniedForPublish(c, notebook) {
		return apicontract.Success(map[string]string{})
	}
	if err := holdEncryptedBoxRequest(c, notebook); err != nil {
		ret.Code = 1
		ret.Msg = err.Error()
		return contractFailure[map[string]string](ret)
	}
	numbers := map[string]string{}
	var err error
	if notebook != "" && model.IsEncryptedBox(notebook) {
		numbers, err = model.GetHeadingNumbers(rootID, notebook)
	} else {
		numbers, err = model.GetHeadingNumbers(rootID, "")
	}
	if nil != err {
		ret.Code = 1
		ret.Msg = err.Error()
		return contractFailure[map[string]string](ret)
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
