package api

import (
	"encoding/json"
	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestAPIContractAccountLoginResponses(t *testing.T) {
	for _, result := range []*gulu.Result{
		{Code: -1, Msg: "offline"},
		{Code: 1, Msg: "captcha", Data: map[string]any{"userName": nil, "token": nil, "needCaptcha": "user-id"}},
		{Code: 10, Data: map[string]any{"userName": nil, "token": "second-factor", "needCaptcha": nil}},
		{Code: 0, Data: map[string]any{"userName": "user", "token": "token", "needCaptcha": nil}},
	} {
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.JSON(200, accountLoginResponse(result))
		requireAPIContract(t, "POST", "/api/account/login", recorder)
		original, _ := json.Marshal(result)
		var before, after map[string]any
		if err := json.Unmarshal(original, &before); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &after); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(before, after) {
			t.Fatalf("login response changed: %s != %s", original, recorder.Body.String())
		}
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
