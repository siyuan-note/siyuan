// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractLoginAuthBodyLimit(t *testing.T) {
	previousConf, previousWrong := model.Conf, util.WrongAuthCount
	model.Conf = model.NewAppConf()
	model.Conf.AccessAuthCode = "correct-password"
	util.WrongAuthCount = 0
	t.Cleanup(func() { model.Conf, util.WrongAuthCount = previousConf, previousWrong })

	oversized := `{"authCode":"` + strings.Repeat("x", maxLoginAuthBodyBytes) + `","rememberMe":false}`
	recorder := systemContractRequest(t, "POST", "loginAuth", loginAuth, strings.NewReader(oversized))
	var response struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatalf("oversized login response is not JSON: %s (%v)", recorder.Body.String(), err)
	}
	if response.Code != -1 || response.Msg != "request body is too large" {
		t.Fatalf("oversized login body was not rejected before decoding: %s", recorder.Body.String())
	}

	recorder = systemContractRequest(t, "POST", "loginAuth", loginAuth,
		strings.NewReader(`{"authCode":"correct-password","captcha":{},"rememberMe":false}`))
	if strings.Contains(recorder.Body.String(), "request body is too large") {
		t.Fatalf("valid login body was rejected by the size limit: %s", recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), `"code":0`) {
		t.Fatalf("valid login body did not reach the handler: %s", recorder.Body.String())
	}
}

func TestContractBodyLimitTracksOverflow(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/system/loginAuth", strings.NewReader(`{"authCode":"0123456789"}`))

	exceeded := limitContractBody(c, 8)
	if _, err := io.ReadAll(c.Request.Body); err == nil {
		t.Fatal("reading beyond the limit did not fail")
	}
	if !*exceeded {
		t.Fatal("reading beyond the limit was not recorded")
	}

	recorder = httptest.NewRecorder()
	c, _ = gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/system/loginAuth", strings.NewReader(`{"authCode":"0123456789"}`))
	exceeded = limitContractBody(c, maxContractJSONBodyBytes)
	if _, err := io.ReadAll(c.Request.Body); err != nil {
		t.Fatalf("body within the limit failed: %v", err)
	}
	if *exceeded {
		t.Fatal("body within the limit was recorded as overflow")
	}
}
