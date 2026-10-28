// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
)

func TestAPIContractAccountLoginResponses(t *testing.T) {
	str := func(value string) *string { return &value }
	for _, test := range []struct {
		name string
		code int
		msg  string
		data *apicontract.AccountLoginData
		want string
	}{
		// 云端失败时由模型层给出本地提示，载荷为 null。
		{name: "offline", code: -1, msg: "offline", want: `{"code":-1,"msg":"offline","data":null}`},
		// 需要验证码时仍然返回 needCaptcha（值为 user id）。
		{name: "captcha", code: 1, msg: "captcha", data: &apicontract.AccountLoginData{NeedCaptcha: str("user-id")},
			want: `{"code":1,"msg":"captcha","data":{"userName":null,"token":null,"needCaptcha":"user-id"}}`},
		// 云端返回的其他码原样透传。
		{name: "second factor", code: 10, data: &apicontract.AccountLoginData{Token: str("second-factor")},
			want: `{"code":10,"msg":"","data":{"userName":null,"token":"second-factor","needCaptcha":null}}`},
		{name: "success", code: 0, data: &apicontract.AccountLoginData{UserName: str("user"), Token: str("token")},
			want: `{"code":0,"msg":"","data":{"userName":"user","token":"token","needCaptcha":null}}`},
	} {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			context, _ := gin.CreateTestContext(recorder)
			context.JSON(200, apicontract.AccountLogin.FailureWithData(test.code, test.msg, test.data))
			requireAPIContract(t, "POST", "/api/account/login", recorder)
			var got, want map[string]any
			if err := json.Unmarshal(recorder.Body.Bytes(), &got); err != nil {
				t.Fatalf("%s: %s", recorder.Body.String(), err)
			}
			if err := json.Unmarshal([]byte(test.want), &want); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(want, got) {
				t.Fatalf("login response changed: %s != %s", recorder.Body.String(), test.want)
			}
		})
	}
}

func TestAPIContractAccountArguments(t *testing.T) {
	request, err := apicontract.AccountLogin.Decode(strings.NewReader(`{"userName":" user ","userPassword":" password ","captcha":" code ","cloudRegion":1.9}`))
	if err != nil || request.UserName != " user " || request.UserPassword != " password " || request.Captcha != " code " || int(request.CloudRegion) != 1 {
		t.Fatalf("login arguments changed: %#v, %v", request, err)
	}
	if _, err := apicontract.UseActivationCode.Decode(strings.NewReader(`{"data":" "}`)); err == nil {
		t.Fatal("blank activation code accepted")
	}
	check, err := apicontract.CheckActivationCode.Decode(strings.NewReader(`{"data":" "}`))
	if err != nil || check.Data != " " {
		t.Fatalf("activation check must retain blank input: %#v, %v", check, err)
	}
}
