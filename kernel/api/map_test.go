package api

import (
	archivezip "archive/zip"
	"bytes"
	"encoding/json"
	"io"
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
		engine.POST("/api/map/getRuntime", contractRouteHandlers(apicontract.MapGetRuntime, getMapRuntime)...)
	} else {
		engine.POST("/api/map/getRuntime", getMapRuntime)
	}
	engine.POST("/api/system/getConf", getConf)
	engine.POST("/api/system/exportConf", exportConf)
	return engine
}

func callMapAPI(t *testing.T, engine *gin.Engine, path, body string) *httptest.ResponseRecorder {
	t.Helper()
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

func TestAPIContractMapBuiltinRuntimeDoesNotReadOrWriteSettings(t *testing.T) {
	engine := setupMapAPI(t, model.RoleAdministrator, true)
	source := []byte(`{"map":{"services":[{"provider":"amap","apiKey":"obsolete-map-private-key","securityCode":"obsolete-map-private-code"}]}}`)
	path := filepath.Join(util.ConfDir, "conf.json")
	if err := os.WriteFile(path, source, 0600); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(source, model.Conf); err != nil {
		t.Fatal(err)
	}
	for _, readonly := range []bool{false, true} {
		util.ReadOnly = readonly
		for _, body := range []string{"", `{}`} {
			response := callMapAPI(t, engine, "/api/map/getRuntime", body)
			var result struct{ Data map[string]any }
			if mapResponseCode(t, response) != 0 || json.Unmarshal(response.Body.Bytes(), &result) != nil ||
				len(result.Data) != 1 || result.Data["provider"] != "openfreemap" ||
				response.Header().Get("Cache-Control") != "no-store" || response.Header().Get("Pragma") != "no-cache" {
				t.Fatalf("unexpected built-in runtime: %s", response.Body.String())
			}
		}
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(source, after) {
		t.Fatal("runtime modified the settings file")
	}
	for _, path := range []string{"/api/map/getConf", "/api/map/setConf"} {
		response := callMapAPI(t, engine, path, `{}`)
		if response.Code != http.StatusNotFound {
			t.Fatalf("removed configuration route remained active: %s", path)
		}
	}
	definitions := apicontract.Definitions()
	for _, definition := range definitions {
		if definition.Path == "/api/map/getConf" || definition.Path == "/api/map/setConf" {
			t.Fatal("removed configuration route remained in API declarations")
		}
	}
}

func TestAPIContractMapDeniesReadersAndPublish(t *testing.T) {
	for _, role := range []model.Role{model.RoleEditor, model.RoleReader, model.RoleVisitor} {
		for _, guard := range []bool{false, true} {
			engine := setupMapAPI(t, role, guard)
			response := callMapAPI(t, engine, "/api/map/getRuntime", `{}`)
			if response.Code == http.StatusOK && mapResponseCode(t, response) == 0 {
				t.Fatal("non-administrator accessed the map runtime")
			}
			if guard && role != model.RoleVisitor && response.Code != http.StatusForbidden {
				t.Fatalf("route did not enforce administrator middleware: %d", response.Code)
			}
			if !guard && response.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("admission response allowed caching")
			}
		}
	}
}

func TestAPIContractMapGetConfAndExportHaveNoSettings(t *testing.T) {
	for _, role := range []model.Role{model.RoleAdministrator, model.RoleReader} {
		engine := setupMapAPI(t, role, true)
		if err := json.Unmarshal([]byte(`{"map":{"services":[{"apiKey":"obsolete-map-private-key"}]}}`), model.Conf); err != nil {
			t.Fatal(err)
		}
		response := callMapAPI(t, engine, "/api/system/getConf", `{}`)
		var result struct {
			Data struct{ Conf map[string]json.RawMessage }
		}
		if mapResponseCode(t, response) != 0 || json.Unmarshal(response.Body.Bytes(), &result) != nil || result.Data.Conf["map"] != nil ||
			strings.Contains(response.Body.String(), "obsolete-map-private-key") {
			t.Fatal("system configuration exposed removed map settings")
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
		if err != nil || bytes.Contains(data, []byte("export-map-private-")) {
			t.Fatal("exported private configuration")
		}
		var exported map[string]json.RawMessage
		if err = json.Unmarshal(data, &exported); err != nil || exported["map"] != nil {
			t.Fatal("exported map settings")
		}
	}
	after, _ := json.Marshal(model.Conf)
	if !bytes.Equal(before, after) {
		t.Fatal("export altered active configuration")
	}
}

func TestAPIContractMapRuntimeDisabledWithAuthBypass(t *testing.T) {
	for _, guard := range []bool{false, true} {
		engine := setupMapAPI(t, model.RoleAdministrator, guard)
		util.SiYuanAccessAuthCodeBypass = true
		for _, password := range []string{"", "test-password"} {
			model.Conf.AccessAuthCode = password
			response := callMapAPI(t, engine, "/api/map/getRuntime", `{}`)
			if mapResponseCode(t, response) == 0 || !strings.Contains(response.Body.String(), "mapAuthenticationBypass") ||
				response.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("auth bypass mode enabled the map runtime")
			}
		}
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
				request := httptest.NewRequest(http.MethodPost, "http://localhost:6806"+path, strings.NewReader(`{}`))
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
