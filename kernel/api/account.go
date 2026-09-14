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
	"encoding/json"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
)

var startFreeTrial = contractHandler(apicontract.StartFreeTrial, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.Null] {
	if err := model.StartFreeTrial(); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})
var useActivationcode = contractHandler(apicontract.UseActivationCode, func(c *gin.Context, request apicontract.ActivationCodeRequest) apicontract.Response[apicontract.Null] {
	if err := model.UseActivationcode(request.Data); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})
var checkActivationcode = contractHandler(apicontract.CheckActivationCode, func(c *gin.Context, request apicontract.CheckActivationCodeRequest) apicontract.Response[apicontract.Null] {
	code, msg := model.CheckActivationcode(request.Data)
	return apicontract.CheckActivationCode.FailureWithData(code, msg, apicontract.Null{})
})
var deactivateUser = contractHandler(apicontract.DeactivateUser, func(c *gin.Context, request apicontract.EmptyRequest) apicontract.Response[apicontract.Null] {
	if err := model.DeactivateUser(); err != nil {
		return apicontract.Failure[apicontract.Null](-1, err.Error())
	}
	return apicontract.Success(apicontract.Null{})
})
var login = contractHandler(apicontract.AccountLogin, func(c *gin.Context, request apicontract.AccountLoginRequest) apicontract.Response[*apicontract.AccountLoginData] {
	result := model.Login(request.UserName, request.UserPassword, request.Captcha, int(request.CloudRegion))
	return accountLoginResponse(result)
})

func accountLoginResponse(result *gulu.Result) apicontract.Response[*apicontract.AccountLoginData] {
	raw, err := json.Marshal(result.Data)
	if err != nil {
		return apicontract.Failure[*apicontract.AccountLoginData](-1, err.Error())
	}
	var data *apicontract.AccountLoginData
	if err = json.Unmarshal(raw, &data); err != nil {
		return apicontract.Failure[*apicontract.AccountLoginData](-1, err.Error())
	}
	return apicontract.AccountLogin.FailureWithData(result.Code, result.Msg, data)
}
