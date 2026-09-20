package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	ginSessions "github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func systemContractRequest(t *testing.T, method, route string, handler gin.HandlerFunc, body io.Reader) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(ginSessions.Sessions("system-contract", cookie.NewStore([]byte("system-contract-session-key"))))
	router.Handle(method, "/api/system/"+route, handler)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(method, "/api/system/"+route, body)
	request.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, request)
	requireAPIContract(t, method, "/api/system/"+route, recorder)
	return recorder
}

func TestAPIContractSystemCompleteConfiguration(t *testing.T) {
	for _, populated := range []bool{false, true} {
		source := new(model.AppConf)
		if populated {
			fillSettingPayload(reflect.ValueOf(source).Elem())
		}
		payload, err := systemConfPayload(source)
		if err != nil {
			t.Fatal(err)
		}
		before, _ := json.Marshal(source)
		after, _ := json.Marshal(payload)
		if !bytes.Equal(before, after) {
			t.Fatalf("complete configuration changed:\n%s\n%s", before, after)
		}
		body, err := json.Marshal(apicontract.Success(apicontract.SystemConfData{Conf: payload}))
		if err != nil {
			t.Fatal(err)
		}
		recorder := httptest.NewRecorder()
		recorder.Header().Set("Content-Type", "application/json")
		recorder.Write(body)
		requireAPIContract(t, "POST", "/api/system/getConf", recorder)
	}
	compareSettingPayload(t, "", systemOnboardingPayload)
	compareSettingPayload(t, "", systemFontPayload)
	compareSettingPayload(t, "", systemCustomFontPayload)
}

func TestAPIContractSystemRuntimeInfo(t *testing.T) {
	previousWorkspace, previousContainer := util.WorkspaceDir, util.Container
	util.WorkspaceDir = "/private/runtime-info-workspace"
	util.Container = "android"
	t.Cleanup(func() { util.WorkspaceDir, util.Container = previousWorkspace, previousContainer })
	for _, body := range []string{"", "{}"} {
		recorder := systemContractRequest(t, "POST", "getRuntimeInfo", getRuntimeInfo, strings.NewReader(body))
		var result struct {
			Code int                               `json:"code"`
			Data apicontract.SystemRuntimeInfoData `json:"data"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if result.Code != 0 {
			t.Fatalf("runtime info failed: %s", recorder.Body.String())
		}
		for _, field := range []string{"SiYuan " + util.Ver, "Kernel:", "Kernel OS:", "CPU logical cores:", "System memory:", "Kernel memory (RSS):", "Kernel Go heap:", "Workspace storage: unknown"} {
			if !strings.Contains(result.Data.Text, field) {
				t.Errorf("missing diagnostic field %q: %s", field, result.Data.Text)
			}
		}
		if strings.Contains(result.Data.Text, util.WorkspaceDir) {
			t.Fatal("runtime info exposes workspace path")
		}
	}
}

func TestAPIContractSystemOIDCStructCompatibility(t *testing.T) {
	for _, body := range []string{`null`, `{}`, `{"Scopes":null,"claimRules":[null,{"values":[null]}]}`, `{"provider":"google","unknown":1e1000}`, `{"clientID":17}`, `{"claimRules":{}}`, `{} {}`, ``} {
		before := conf.NewOIDC()
		beforeErr := json.NewDecoder(strings.NewReader(body)).Decode(before)
		request, err := apicontract.SystemSetOIDC.Decode(strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		if (beforeErr == nil) != (request.ParseError() == nil) {
			t.Fatalf("OIDC struct binding changed for %s: %v / %v", body, beforeErr, request.ParseError())
		}
		if beforeErr == nil && !reflect.DeepEqual(before, model.SystemOIDCConfig(request.SystemOIDC)) {
			t.Fatalf("OIDC default, null or field matching changed for %s", body)
		}
	}
}

func TestAPIContractSystemExitCompatibility(t *testing.T) {
	previousClose, previousConf := closeSystem, model.Conf
	model.Conf = model.NewAppConf()
	t.Cleanup(func() { closeSystem, model.Conf = previousClose, previousConf })
	for _, code := range []int{0, 1, 2} {
		for _, body := range []string{`{}`, `{"force":true,"execInstallPkg":2.9,"setCurrentWorkspace":false}`} {
			called := false
			closeSystem = func(force, current bool, install int) (int, string) {
				called = true
				if body == `{}` && (force || !current || install != 0) || body != `{}` && (!force || current || install != 2) {
					t.Fatalf("exit defaults or numeric truncation changed: %v %v %d", force, current, install)
				}
				return code, "installer"
			}
			recorder := systemContractRequest(t, "POST", "exit", exit, strings.NewReader(body))
			var result struct {
				Code int                        `json:"code"`
				Data apicontract.SystemExitData `json:"data"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil || !called || result.Code != code || result.Data.InstallPkgPath != "installer" || result.Data.CloseTimeout != 0 {
				t.Fatalf("exit response changed: %s (%v)", recorder.Body.String(), err)
			}
		}
	}
}

func TestAPIContractSystemAuthenticationAdmission(t *testing.T) {
	previousConf, previousWrong, previousContainer, previousReadonly := model.Conf, util.WrongAuthCount, util.Container, util.ReadOnly
	model.Conf = model.NewAppConf()
	model.Conf.AccessAuthCode = "correct-password"
	t.Cleanup(func() {
		model.Conf, util.WrongAuthCount, util.Container, util.ReadOnly = previousConf, previousWrong, previousContainer, previousReadonly
	})
	util.WrongAuthCount = 0
	recorder := systemContractRequest(t, "POST", "loginAuth", loginAuth, strings.NewReader(`{"authCode":"correct-password","captcha":{},"rememberMe":"ignored"}`))
	if !strings.Contains(recorder.Body.String(), `"code":0`) {
		t.Fatalf("unused captcha and ignored rememberMe rejected: %s", recorder.Body.String())
	}
	util.WrongAuthCount = 100
	recorder = systemContractRequest(t, "POST", "loginAuth", loginAuth, strings.NewReader(`{"authCode":{}}`))
	if !strings.Contains(recorder.Body.String(), `"code":1`) {
		t.Fatalf("captcha admission must precede authCode decoding: %s", recorder.Body.String())
	}
	util.Container = util.ContainerDocker
	systemContractRequest(t, "POST", "setAccessAuthCode", setAccessAuthCode, &systemUnreadBody{t: t})
	util.ReadOnly = true
	systemContractRequest(t, "POST", "setUILayout", setUILayout, &systemUnreadBody{t: t})
	model.Conf.OIDC.Enabled = false
	systemContractRequest(t, "POST", "oidc/start", oidcStart, &systemUnreadBody{t: t})
}

type systemUnreadBody struct{ t *testing.T }

func (b *systemUnreadBody) Read([]byte) (int, error) {
	b.t.Fatal("admission read the request body")
	return 0, io.EOF
}

func TestAPIContractSystemRawResponses(t *testing.T) {
	previousConf := model.Conf
	model.Conf = model.NewAppConf()
	t.Cleanup(func() { model.Conf = previousConf })
	recorder := systemContractRequest(t, "GET", "getCaptcha", getCaptcha, nil)
	if recorder.Code != 200 || !bytes.HasPrefix(recorder.Body.Bytes(), []byte("\x89PNG\r\n\x1a\n")) {
		t.Fatalf("captcha is not PNG: %d %q", recorder.Code, recorder.Body.Bytes())
	}
	recorder = systemContractRequest(t, "GET", "getBootAppearance", getBootAppearance, nil)
	if recorder.Code != 403 || recorder.Body.Len() != 0 {
		t.Fatalf("remote boot appearance must be empty 403: %d %s", recorder.Code, recorder.Body.String())
	}
	recorder = systemContractRequest(t, "POST", "uiproc", addUIProcess, nil)
	if recorder.Code != 200 || recorder.Body.Len() != 0 {
		t.Fatalf("UI registration must remain empty 200: %d %s", recorder.Code, recorder.Body.String())
	}
	recorder = systemContractRequest(t, "GET", "oidc/callback", oidcCallback, nil)
	if !strings.HasPrefix(recorder.Header().Get("Content-Type"), "text/html") || recorder.Header().Get("Cache-Control") != "no-store" || !strings.Contains(recorder.Header().Get("Content-Security-Policy"), "frame-ancestors 'none'") {
		t.Fatalf("OIDC failure page headers changed: %v", recorder.Header())
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	recorder = httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/api/system/bootProgressSSE", nil).WithContext(ctx)
	bootProgressSSE(c)
	if !strings.HasPrefix(recorder.Body.String(), "data: ") || !strings.HasSuffix(recorder.Body.String(), "\n\n") {
		t.Fatalf("initial unnamed SSE frame was lost: %q", recorder.Body.String())
	}
	requireAPIContract(t, "GET", "/api/system/bootProgressSSE", recorder)
}

func TestAPIContractSystemUploadErrors(t *testing.T) {
	for _, test := range []struct {
		route   string
		handler gin.HandlerFunc
		code    int
		message string
	}{
		{"importConf", importConf, -1, "invalid upload file"},
		{"importCustomFont", importCustomFont, 400, "Field [file] must not be empty"},
		{"importTLSCABundle", importTLSCABundle, -1, "[file] is required: " + http.ErrMissingFile.Error()},
		{"addCustomEmoji", addCustomEmoji, 400, "field [file] or [url] must not be empty"},
	} {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest("POST", "/api/system/"+test.route, &body)
		c.Request.Header.Set("Content-Type", writer.FormDataContentType())
		test.handler(c)
		var result struct {
			Code int    `json:"code"`
			Msg  string `json:"msg"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil || result.Code != test.code || result.Msg != test.message {
			t.Fatalf("%s missing upload changed: %s (%v)", test.route, recorder.Body.String(), err)
		}
		requireAPIContract(t, "POST", "/api/system/"+test.route, recorder)
	}
}
