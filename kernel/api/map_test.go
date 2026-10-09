package api

import (
	archivezip "archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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

func setupMapAPI(t *testing.T, role model.Role, guard bool) *gin.Engine {
	t.Helper()
	oldConf, oldConfDir, oldReadonly, oldTemp := model.Conf, util.ConfDir, util.ReadOnly, util.TempDir
	oldBypass := util.SiYuanAccessAuthCodeBypass
	util.SiYuanAccessAuthCodeBypass = false
	model.Conf = model.NewAppConf()
	model.Conf.AccessAuthCode = "test-password"
	model.Conf.Api = &conf.API{Token: "map-test-api-token"}
	model.Conf.Sync = &conf.Sync{Enabled: true, Provider: 1}
	model.Conf.System = &conf.System{}
	model.Conf.Map = &conf.Map{Services: []*conf.MapService{
		{ID: "amap", Name: "AMap", Provider: conf.MapProviderAMap, APIKey: "map-api-private-key", SecurityCode: "map-api-private-code"},
		{ID: "tencent", Name: "Tencent", Provider: conf.MapProviderTencent, APIKey: "map-api-other-key"},
		{ID: "free", Name: "Free", Provider: conf.MapProviderOpenFreeMap},
		{ID: "incomplete", Name: "Incomplete", Provider: conf.MapProviderAMap, APIKey: "map-api-incomplete-key"},
	}}
	util.ConfDir, util.ReadOnly, util.TempDir = t.TempDir(), false, t.TempDir()
	t.Cleanup(func() {
		model.Conf, util.ConfDir, util.ReadOnly, util.TempDir = oldConf, oldConfDir, oldReadonly, oldTemp
		util.SiYuanAccessAuthCodeBypass = oldBypass
	})
	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(ginSessions.Sessions("map-api-test", cookie.NewStore([]byte("map-api-test-session-key"))))
	engine.Use(func(c *gin.Context) { c.Set(model.RoleContextKey, role); c.Next() })
	if guard {
		engine.POST("/api/map/getConf", contractRouteHandlers(apicontract.MapGetConf, getMapConf)...)
		engine.POST("/api/map/setConf", contractRouteHandlers(apicontract.MapSetConf, setMapConf)...)
		engine.POST("/api/map/getRuntime", contractRouteHandlers(apicontract.MapGetRuntime, getMapRuntime)...)
	} else {
		engine.POST("/api/map/getConf", getMapConf)
		engine.POST("/api/map/setConf", setMapConf)
		engine.POST("/api/map/getRuntime", getMapRuntime)
	}
	engine.POST("/api/system/getConf", getConf)
	engine.POST("/api/system/exportConf", exportConf)
	return engine
}

func callMapAPI(t *testing.T, engine *gin.Engine, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	// 普通写入使用当前版本；并发测试显式提供旧版本，不被此辅助方法覆盖。
	if path == "/api/map/setConf" {
		var fields map[string]json.RawMessage
		if json.Unmarshal([]byte(body), &fields) == nil && fields != nil && fields["expectedRevision"] == nil {
			fields["expectedRevision"], _ = json.Marshal(model.Conf.Map.Revision)
			encoded, err := json.Marshal(fields)
			if err != nil {
				t.Fatal(err)
			}
			body = string(encoded)
		}
	}
	request := httptest.NewRequest(http.MethodPost, "https://notes.example.com"+path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.RemoteAddr = "192.0.2.30:12345"
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)
	if response.Code == http.StatusOK {
		requireAPIContract(t, http.MethodPost, path, response)
	}
	return response
}

func mapResponseCode(t *testing.T, response *httptest.ResponseRecorder) int {
	t.Helper()
	var result struct{ Code int }
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result.Code
}

func TestAPIContractMapConfigurationAndSelectedRuntime(t *testing.T) {
	engine := setupMapAPI(t, model.RoleAdministrator, true)
	model.Conf.Map.Services = append(model.Conf.Map.Services,
		&conf.MapService{ID: "unsupported", Name: "Unsupported", Provider: "custom", APIKey: "map-api-unsupported-key"})
	response := callMapAPI(t, engine, "/api/map/getConf", `{}`)
	if mapResponseCode(t, response) != 0 || strings.Contains(response.Body.String(), "map-api-") || strings.Contains(response.Body.String(), `"apiKey"`) || strings.Contains(response.Body.String(), `"securityCode"`) {
		t.Fatalf("getConf leaked credentials or failed: %s", response.Body.String())
	}
	var list struct{ Data apicontract.MapConfig }
	if err := json.Unmarshal(response.Body.Bytes(), &list); err != nil || len(list.Data.Services) != 4 || !list.Data.Services[0].Configured || !list.Data.Services[0].HasSecurityCode || list.Data.Services[3].Configured {
		t.Fatal("incorrect configured/presence metadata")
	}
	for _, test := range []struct{ id, key, code string }{
		{"amap", "map-api-private-key", "map-api-private-code"},
		{"tencent", "map-api-other-key", ""},
		{"free", "", ""},
	} {
		response = callMapAPI(t, engine, "/api/map/getRuntime", `{"serviceID":"`+test.id+`"}`)
		if mapResponseCode(t, response) != 0 || response.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("runtime failed or was cacheable")
		}
		var runtime struct{ Data map[string]string }
		if err := json.Unmarshal(response.Body.Bytes(), &runtime); err != nil || runtime.Data["provider"] == "" || runtime.Data["apiKey"] != test.key || runtime.Data["securityCode"] != test.code {
			t.Fatal("runtime returned the wrong provider credentials")
		}
		for key := range runtime.Data {
			if key != "provider" && key != "apiKey" && key != "securityCode" {
				t.Fatalf("runtime included unrelated field %q", key)
			}
		}
	}
	for _, body := range []string{`{}`, `{"serviceID":"missing"}`, `{"serviceID":"incomplete"}`, `{"serviceID":"unsupported"}`, `{"serviceID":""}`, `{"serviceID":null}`} {
		response = callMapAPI(t, engine, "/api/map/getRuntime", body)
		if mapResponseCode(t, response) == 0 || strings.Contains(response.Body.String(), "map-api-") || response.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("unavailable runtime fell back or leaked credentials")
		}
	}
	if len(model.Conf.Map.Services) != 5 || model.Conf.Map.Services[4].Provider != "custom" {
		t.Fatal("safe configuration reads rewrote unrecognized persisted data")
	}
}

func TestAPIContractMapWholeListSecretWrites(t *testing.T) {
	engine := setupMapAPI(t, model.RoleAdministrator, true)
	response := callMapAPI(t, engine, "/api/map/setConf", `{"services":[{"id":"amap","name":"Rename","provider":"amap"}]}`)
	if mapResponseCode(t, response) != 0 || model.Conf.Map.Services[0].APIKey != "map-api-private-key" || model.Conf.Map.Services[0].SecurityCode != "map-api-private-code" || len(model.Conf.Map.Services) != 1 || strings.Contains(response.Body.String(), "map-api-") {
		t.Fatal("full-list update leaked or replaced omitted credentials")
	}
	for _, body := range []string{
		`{}`, `{"services":null}`, `{"services":[null]}`,
		`{"services":[{"id":"amap","name":"Rename","provider":"amap","apiKey":null}]}`,
		`{"services":[{"id":"amap","name":"Rename","provider":"amap","hasAPIKey":true}]}`,
		`{"services":[{"name":"Remote","provider":"amap","remoteURL":"https://unknown.example"}]}`,
		`{"services":[],"unknown":true}`, `{"services":[]} {"services":[]}`,
		`{"services":[{"name":"Bad","provider":"custom"}]}`,
	} {
		response = callMapAPI(t, engine, "/api/map/setConf", body)
		if mapResponseCode(t, response) == 0 || len(model.Conf.Map.Services) != 1 || model.Conf.Map.Services[0].APIKey != "map-api-private-key" {
			t.Fatalf("invalid request altered map configuration: %s", body)
		}
	}
	response = callMapAPI(t, engine, "/api/map/setConf", `{"services":[{"id":"amap","name":"Cleared","provider":"amap","apiKey":""}]}`)
	if mapResponseCode(t, response) != 0 || model.Conf.Map.Services[0].APIKey != "" || model.Conf.Map.Services[0].SecurityCode != "map-api-private-code" {
		t.Fatal("explicit credential clear semantics changed")
	}
	response = callMapAPI(t, engine, "/api/map/setConf", `{"services":[{"id":"amap","name":"New provider","provider":"baidu","apiKey":"new-test-key"}]}`)
	if mapResponseCode(t, response) != 0 || model.Conf.Map.Services[0].SecurityCode != "" || model.Conf.Map.Services[0].APIKey != "new-test-key" {
		t.Fatal("provider change retained previous credentials")
	}
	stored, err := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
	if err != nil || bytes.Contains(stored, []byte("new-test-key")) {
		t.Fatal("API stored plaintext credentials")
	}
}

func TestAPIContractMapDeniesReadersAndPublish(t *testing.T) {
	for _, role := range []model.Role{model.RoleEditor, model.RoleReader, model.RoleVisitor} {
		for _, guard := range []bool{false, true} {
			t.Run(string(rune('0'+role))+"/"+map[bool]string{true: "route", false: "handler"}[guard], func(t *testing.T) {
				engine := setupMapAPI(t, role, guard)
				before, _ := json.Marshal(model.Conf.Map)
				for _, path := range []string{"/api/map/getConf", "/api/map/setConf", "/api/map/getRuntime"} {
					response := callMapAPI(t, engine, path, `{"serviceID":"amap","services":[]}`)
					if response.Code == http.StatusOK && mapResponseCode(t, response) == 0 || strings.Contains(response.Body.String(), "map-api-") {
						t.Fatalf("non-administrator accessed %s", path)
					}
					if guard && role != model.RoleVisitor && response.Code != http.StatusForbidden {
						t.Fatalf("route did not enforce administrator middleware: %d", response.Code)
					}
				}
				after, _ := json.Marshal(model.Conf.Map)
				if !bytes.Equal(before, after) {
					t.Fatal("denied caller changed services")
				}
			})
		}
	}
}

func TestAPIContractMapGetConfAndExportNeverExposeCredentials(t *testing.T) {
	for _, role := range []model.Role{model.RoleAdministrator, model.RoleReader} {
		engine := setupMapAPI(t, role, true)
		response := callMapAPI(t, engine, "/api/system/getConf", `{}`)
		if mapResponseCode(t, response) != 0 || strings.Contains(response.Body.String(), "map-api-") {
			t.Fatal("system getConf leaked map credentials")
		}
		var result struct {
			Data struct{ Conf apicontract.SystemAppConf }
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil || result.Data.Conf.Map == nil {
			t.Fatal("missing safe map configuration")
		}
		if role == model.RoleReader && len(result.Data.Conf.Map.Services) != 0 {
			t.Fatal("publish getConf exposed local service metadata")
		}
		if role == model.RoleAdministrator && (len(result.Data.Conf.Map.Services) != 4 || !result.Data.Conf.Map.Services[0].Configured) {
			t.Fatal("administrator lost redacted configuration metadata")
		}
	}
	engine := setupMapAPI(t, model.RoleAdministrator, true)
	model.Conf.UserData = "export-map-private-user"
	model.Conf.CookieKey = "export-map-private-cookie"
	model.Conf.MCPOAuth = "export-map-private-oauth"
	before, _ := json.Marshal(model.Conf)
	response := callMapAPI(t, engine, "/api/system/exportConf", `{}`)
	var result struct {
		Data apicontract.SystemExportConfData
	}
	if mapResponseCode(t, response) != 0 || json.Unmarshal(response.Body.Bytes(), &result) != nil {
		t.Fatal("configuration export failed")
	}
	archive, err := archivezip.OpenReader(filepath.Join(util.TempDir, "export", result.Data.Name+".zip"))
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	for _, entry := range archive.File {
		file, err := entry.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(file)
		file.Close()
		if err != nil || bytes.Contains(data, []byte("map-api-")) || bytes.Contains(data, []byte("export-map-private-")) {
			t.Fatal("exported configuration contains map credentials")
		}
		var exported model.AppConf
		if err = json.Unmarshal(data, &exported); err != nil || exported.Map != nil || exported.UserData != "" || exported.CookieKey != "" || exported.MCPOAuth != "" || exported.AccessAuthCode != "" {
			t.Fatal("device-local map services were included in portable configuration")
		}
	}
	after, _ := json.Marshal(model.Conf)
	if !bytes.Equal(before, after) {
		t.Fatal("export altered active map credentials")
	}
}

func TestAPIContractMapImportPreservesDeviceConfiguration(t *testing.T) {
	engine := setupMapAPI(t, model.RoleAdministrator, true)
	engine.POST("/api/system/importConf", importConf)
	before, _ := json.Marshal(model.Conf.Map)
	for _, payload := range []string{
		`{}`, `{"map":null}`, `{"map":{"services":[]}}`,
		`{"map":{"services":[{"id":"amap","name":"Other device","provider":"tencent","apiKey":"untrusted-import-key"}]}}`,
	} {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		part, err := writer.CreateFormFile("file", "settings.json")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = io.WriteString(part, payload); err != nil {
			t.Fatal(err)
		}
		if err = writer.Close(); err != nil {
			t.Fatal(err)
		}
		request := httptest.NewRequest(http.MethodPost, "/api/system/importConf", &body)
		request.Header.Set("Content-Type", writer.FormDataContentType())
		response := httptest.NewRecorder()
		engine.ServeHTTP(response, request)
		if mapResponseCode(t, response) != 0 {
			t.Fatal("configuration import failed")
		}
		after, _ := json.Marshal(model.Conf.Map)
		if !bytes.Equal(before, after) {
			t.Fatal("portable configuration replaced device-local services or credentials")
		}
	}
}

func TestAPIContractMapRuntimeDisabledWithAuthBypass(t *testing.T) {
	engine := setupMapAPI(t, model.RoleAdministrator, true)
	util.SiYuanAccessAuthCodeBypass = true
	for _, password := range []string{"", "test-password"} {
		model.Conf.AccessAuthCode = password
		for _, serviceID := range []string{"amap", "free"} {
			response := callMapAPI(t, engine, "/api/map/getRuntime", `{"serviceID":"`+serviceID+`"}`)
			if mapResponseCode(t, response) == 0 || !strings.Contains(response.Body.String(), "mapAuthenticationBypass") || strings.Contains(response.Body.String(), "map-api-") || response.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("auth bypass mode enabled a map SDK or exposed runtime credentials")
			}
		}
	}
	response := callMapAPI(t, engine, "/api/map/getConf", `{}`)
	if mapResponseCode(t, response) != 0 {
		t.Fatal("SDK safety gate unnecessarily disabled local configuration management")
	}
}

func TestAPIContractMapOpaqueOriginCannotReadKernelData(t *testing.T) {
	engine := setupMapAPI(t, model.RoleVisitor, true)
	engine.POST("/test-private-data", model.CheckAuth, func(c *gin.Context) { c.String(200, "private-note-fixture") })
	engine.GET("/test-login", func(c *gin.Context) {
		session := util.GetSession(c)
		util.GetWorkspaceSession(session).AccessAuthCode = "test-password"
		if err := session.Save(c); err != nil {
			t.Error(err)
		}
		c.Status(200)
	})
	login := httptest.NewRecorder()
	engine.ServeHTTP(login, httptest.NewRequest(http.MethodGet, "http://localhost:6806/test-login", nil))
	for _, password := range []string{"", "test-password"} {
		model.Conf.AccessAuthCode = password
		for _, site := range []string{"", "cross-site", "same-site"} {
			for _, path := range []string{"/test-private-data", "/api/map/getRuntime"} {
				request := httptest.NewRequest(http.MethodPost, "http://localhost:6806"+path, strings.NewReader(`{"serviceID":"amap"}`))
				request.RemoteAddr = "127.0.0.1:12345"
				request.Header.Set("Content-Type", "application/json")
				request.Header.Set("Origin", "null")
				request.Header.Set("Sec-Fetch-Site", site)
				if util.IsSessionOriginAllowedRequest(request) {
					t.Fatal("WebSocket/session origin validator admitted an opaque origin")
				}
				// 即使浏览器附带已有登录 Cookie，也不能越过 Origin 校验。
				for _, cookie := range login.Result().Cookies() {
					request.AddCookie(cookie)
				}
				response := httptest.NewRecorder()
				engine.ServeHTTP(response, request)
				if response.Code != http.StatusUnauthorized || strings.Contains(response.Body.String(), "private-note-fixture") || strings.Contains(response.Body.String(), "map-api-") {
					t.Fatalf("opaque-origin request read kernel data: passworded=%t, fetch-site=%q, path=%s", password != "", site, path)
				}
			}
		}
	}
}

func TestAPIContractMapRejectsStaleOrMissingRevision(t *testing.T) {
	engine := setupMapAPI(t, model.RoleAdministrator, true)
	initialRevision := model.Conf.Map.Revision
	body, _ := json.Marshal(map[string]any{"expectedRevision": initialRevision, "services": []map[string]string{
		{"id": "created-in-first-window", "name": "First", "provider": "tencent", "apiKey": "concurrent-private-key"},
	}})
	response := callMapAPI(t, engine, "/api/map/setConf", string(body))
	var first struct{ Data apicontract.MapConfig }
	if mapResponseCode(t, response) != 0 || json.Unmarshal(response.Body.Bytes(), &first) != nil || first.Data.Revision == initialRevision || first.Data.Revision == "" {
		t.Fatal("map API did not return the saved revision")
	}
	before, err := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
	if err != nil {
		t.Fatal(err)
	}
	body, _ = json.Marshal(map[string]any{"expectedRevision": initialRevision, "services": []any{}})
	response = callMapAPI(t, engine, "/api/map/setConf", string(body))
	if mapResponseCode(t, response) == 0 || !strings.Contains(response.Body.String(), "mapSettingsConflict") {
		t.Fatal("stale map list did not return the stable conflict message")
	}
	for _, invalid := range []string{`{"services":[]}`, `{"services":[],"expectedRevision":null}`, `{"services":[],"expectedRevision":false}`} {
		// 直接构造请求，验证未携带版本号时不会被测试辅助方法补齐。
		request := httptest.NewRequest(http.MethodPost, "/api/map/setConf", strings.NewReader(invalid))
		response = httptest.NewRecorder()
		engine.ServeHTTP(response, request)
		requireAPIContract(t, http.MethodPost, "/api/map/setConf", response)
		if mapResponseCode(t, response) == 0 {
			t.Fatal("missing or invalid revision was accepted")
		}
	}
	after, err := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
	if err != nil || !bytes.Equal(before, after) || len(model.Conf.Map.Services) != 1 || model.Conf.Map.Services[0].APIKey != "concurrent-private-key" || model.Conf.Map.Revision != first.Data.Revision {
		t.Fatal("conflicting window overwrote a new service or credential")
	}
}

func TestAPIContractMapRemoteBasicOriginBoundary(t *testing.T) {
	engine := setupMapAPI(t, model.RoleVisitor, true)
	previousName := util.WorkspaceName
	util.WorkspaceName = "map-origin-test"
	t.Cleanup(func() { util.WorkspaceName = previousName })
	mutations := 0
	engine.POST("/test-private-basic", model.CheckAuth, func(c *gin.Context) {
		mutations++
		c.String(http.StatusOK, "private-data-fixture")
	})
	engine.GET("/stage/build/desktop/", model.CheckAuth, func(c *gin.Context) { c.Status(http.StatusOK) })
	for _, test := range []struct {
		name   string
		origin string
		site   string
		token  bool
		status int
	}{
		{name: "opaque remote browser with Basic credentials", origin: "null", site: "cross-site", status: http.StatusUnauthorized},
		{name: "opaque origin without fetch metadata", origin: "null", status: http.StatusUnauthorized},
		{name: "opaque origin with same-origin metadata", origin: "null", site: "same-origin", status: http.StatusUnauthorized},
		{name: "opaque origin with direct-navigation metadata", origin: "null", site: "none", status: http.StatusUnauthorized},
		{name: "ordinary non-browser Basic client", status: http.StatusOK},
		{name: "missing origin same-origin fetch", site: "same-origin", status: http.StatusOK},
		{name: "missing origin cross-site fetch", site: "cross-site", status: http.StatusUnauthorized},
		{name: "missing origin same-site fetch", site: "same-site", status: http.StatusUnauthorized},
		{name: "same-origin browser", origin: "https://notes.example.com", site: "same-origin", status: http.StatusOK},
		{name: "same-origin without fetch metadata", origin: "https://notes.example.com", status: http.StatusOK},
		{name: "same-origin header with cross-site fetch", origin: "https://notes.example.com", site: "cross-site", status: http.StatusUnauthorized},
		{name: "foreign origin without fetch metadata", origin: "https://foreign.example.com", status: http.StatusUnauthorized},
		{name: "foreign origin with same-origin metadata", origin: "https://foreign.example.com", site: "same-origin", status: http.StatusUnauthorized},
		{name: "foreign origin with cross-site metadata", origin: "https://foreign.example.com", site: "cross-site", status: http.StatusUnauthorized},
		{name: "explicit API token stays authorized", origin: "null", site: "cross-site", token: true, status: http.StatusOK},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "https://notes.example.com/test-private-basic", strings.NewReader(`{}`))
			request.RemoteAddr = "198.51.100.7:23456"
			request.Header.Set("Origin", test.origin)
			request.Header.Set("Sec-Fetch-Site", test.site)
			if test.token {
				request.Header.Set("Authorization", "Token "+model.Conf.Api.Token)
			} else {
				request.SetBasicAuth(util.WorkspaceName, model.Conf.AccessAuthCode)
			}
			before := mutations
			response := httptest.NewRecorder()
			engine.ServeHTTP(response, request)
			if response.Code != test.status || test.status == http.StatusUnauthorized && mutations != before {
				t.Fatalf("remote Basic origin boundary: status=%d, want=%d, protected-handler-ran=%t", response.Code, test.status, mutations != before)
			}
		})
	}
	// 已登录用户从外部链接进入应用主页面，仍沿用会话来源策略中的顶层导航例外。
	request := httptest.NewRequest(http.MethodGet, "https://notes.example.com/stage/build/desktop/", nil)
	request.RemoteAddr = "198.51.100.7:23456"
	request.Header.Set("Sec-Fetch-Site", "cross-site")
	request.Header.Set("Sec-Fetch-Mode", "navigate")
	request.Header.Set("Sec-Fetch-Dest", "document")
	request.SetBasicAuth(util.WorkspaceName, model.Conf.AccessAuthCode)
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatal("legitimate top-level application navigation lost Basic authentication")
	}
}
