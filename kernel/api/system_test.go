// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	ginSessions "github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestContractSetAccessAuthCodeDesktopSession(t *testing.T) {
	oldConf, oldReadonly, oldContainer, oldDir := model.Conf, util.ReadOnly, util.Container, util.WorkspaceDir
	t.Cleanup(func() {
		// 等待设置接口发出的延迟界面刷新，避免其读取后续测试的全局配置。
		time.Sleep(250 * time.Millisecond)
		model.Conf, util.ReadOnly, util.Container, util.WorkspaceDir = oldConf, oldReadonly, oldContainer, oldDir
	})
	util.ReadOnly, util.Container, util.WorkspaceDir = true, util.ContainerStd, "desktop-session-setting"
	for _, mode := range []string{"new", "bound", "remembered", "expired"} {
		t.Run(mode, func(t *testing.T) {
			model.Conf = model.NewAppConf()
			model.Conf.CookieKey = "desktop-setting-test-cookie-key"
			model.Conf.AccessAuthCode = "old-password"
			engine := gin.New()
			engine.Use(ginSessions.Sessions("siyuan", cookie.NewStore([]byte("desktop-setting-test-key"))))
			engine.GET("/seed", func(c *gin.Context) {
				session := util.GetSession(c)
				ws := util.GetWorkspaceSession(session)
				if mode != "new" {
					model.SetAccessCodeSession(ws, model.Conf.AccessAuthCode)
					model.BindDesktopSession(c, ws, mode == "remembered")
					if mode == "expired" {
						ws.DesktopSessionID = "previous-boot"
					}
				}
				if err := session.Save(c); err != nil {
					t.Fatal(err)
				}
			})
			engine.POST("/api/system/setAccessAuthCode", setAccessAuthCode)
			engine.GET("/session", func(c *gin.Context) { c.JSON(200, util.GetWorkspaceSession(util.GetSession(c))) })
			call := func(method, path, body string, cookies []*http.Cookie) *httptest.ResponseRecorder {
				r := httptest.NewRequest(method, "http://127.0.0.1:6806"+path, strings.NewReader(body))
				r.RemoteAddr = "127.0.0.1:1234"
				r.Header.Set("User-Agent", "SiYuan/3.8.9 https://b3log.org/siyuan Electron Chrome/140")
				r.Header.Set("Content-Type", "application/json")
				for _, value := range cookies {
					r.AddCookie(value)
				}
				w := httptest.NewRecorder()
				engine.ServeHTTP(w, r)
				return w
			}
			seed := call("GET", "/seed", "", nil).Result().Cookies()
			if mode == "new" {
				model.Conf.AccessAuthCode = ""
			}
			result := call("POST", "/api/system/setAccessAuthCode", `{"accessAuthCode":"new-password"}`, seed)
			var response struct{ Code int }
			if err := json.Unmarshal(result.Body.Bytes(), &response); err != nil || response.Code != 0 {
				t.Fatalf("setting password failed: %s, %v", result.Body.String(), err)
			}
			var ws util.WorkspaceSession
			sessionBody := call("GET", "/session", "", result.Result().Cookies()).Body.Bytes()
			if err := json.Unmarshal(sessionBody, &ws); err != nil {
				t.Fatal(err)
			}
			if (ws.DesktopSessionID != "") != (mode != "remembered") || !model.IsAccessCodeSessionAuthenticated(&ws) {
				t.Fatalf("password setting lost session policy: %+v", ws)
			}
			if strings.Contains(string(sessionBody), "new-password") {
				t.Fatalf("session stores the access authorization code: %s", sessionBody)
			}
		})
	}
}

func TestSetOIDCRejectsUnverifiedEnabledConfiguration(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousConf := model.Conf
	previousReadOnly := util.ReadOnly
	model.Conf = model.NewAppConf()
	model.Conf.CookieKey = "oidc-api-test-cookie-key"
	util.ReadOnly = true
	t.Cleanup(func() {
		model.Conf = previousConf
		util.ReadOnly = previousReadOnly
	})

	candidate := conf.NewOIDC()
	candidate.Enabled = true
	candidate.Provider = conf.OIDCProviderGitHub
	candidate.ClientID = "client-id"
	candidate.ClientSecret = "client-secret"
	candidate.AllowAll = true
	body, err := json.Marshal(candidate)
	if err != nil {
		t.Fatal(err)
	}
	engine := gin.New()
	engine.POST("/api/system/setOIDC", setOIDC)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/system/setOIDC", strings.NewReader(string(body)))
	request.RemoteAddr = "127.0.0.1:1234"
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)

	response := &struct {
		Code int `json:"code"`
	}{}
	if err = json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
		t.Fatalf("unmarshal setOIDC response failed: %v", err)
	}
	if response.Code != -1 {
		t.Fatalf("unverified OIDC configuration was accepted: %s", recorder.Body.String())
	}
	if model.Conf.GetOIDC().Enabled {
		t.Fatal("unverified OIDC configuration changed the active configuration")
	}
}

func TestSetAccessAuthCodeRejectsRemoteAuthenticationLockout(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousConf := model.Conf
	previousReadOnly := util.ReadOnly
	previousBypass := util.SiYuanAccessAuthCodeBypass
	model.Conf = model.NewAppConf()
	model.Conf.CookieKey = "access-auth-api-test-cookie-key"
	model.Conf.AccessAuthCode = "existing-code"
	util.ReadOnly = true
	util.SiYuanAccessAuthCodeBypass = false
	t.Cleanup(func() {
		model.Conf = previousConf
		util.ReadOnly = previousReadOnly
		util.SiYuanAccessAuthCodeBypass = previousBypass
	})

	engine := gin.New()
	engine.POST("/api/system/setAccessAuthCode", setAccessAuthCode)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "https://notes.example.com/api/system/setAccessAuthCode",
		strings.NewReader(`{"accessAuthCode":""}`))
	request.RemoteAddr = "203.0.113.2:1234"
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)

	response := &struct {
		Code int `json:"code"`
	}{}
	if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
		t.Fatalf("unmarshal setAccessAuthCode response failed: %v", err)
	}
	if response.Code != -1 || model.Conf.AccessAuthCode != "existing-code" {
		t.Fatalf("remote access authentication lockout was accepted: %s", recorder.Body.String())
	}
}

func TestSetAccessAuthCodeRejectsUnsupportedMobileOIDC(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousConf := model.Conf
	previousReadOnly := util.ReadOnly
	previousContainer := util.Container
	model.Conf = model.NewAppConf()
	model.Conf.CookieKey = "mobile-access-auth-api-test-cookie-key"
	model.Conf.AccessAuthCode = "existing-code"
	model.Conf.OIDC = &conf.OIDC{
		Enabled: true, Provider: conf.OIDCProviderGoogle, ClientID: "client-id", AllowAll: true,
	}
	util.ReadOnly = true
	util.Container = util.ContainerAndroid
	t.Cleanup(func() {
		model.Conf = previousConf
		util.ReadOnly = previousReadOnly
		util.Container = previousContainer
	})

	engine := gin.New()
	engine.POST("/api/system/setAccessAuthCode", setAccessAuthCode)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/system/setAccessAuthCode",
		strings.NewReader(`{"accessAuthCode":""}`))
	request.RemoteAddr = "127.0.0.1:1234"
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)

	response := &struct {
		Code int `json:"code"`
	}{}
	if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
		t.Fatalf("unmarshal mobile setAccessAuthCode response failed: %v", err)
	}
	if response.Code != -1 || model.Conf.AccessAuthCode != "existing-code" {
		t.Fatalf("unsupported mobile OIDC lockout was accepted: %s", recorder.Body.String())
	}
}

func TestSetAccessAuthCodeAllowsClearingOnMobileWithoutOIDC(t *testing.T) {
	gin.SetMode(gin.TestMode)
	previousConf := model.Conf
	previousReadOnly := util.ReadOnly
	previousContainer := util.Container
	model.Conf = model.NewAppConf()
	model.Conf.CookieKey = "mobile-clear-access-auth-api-test-cookie-key"
	model.Conf.AccessAuthCode = "existing-code"
	util.ReadOnly = true
	util.Container = util.ContainerAndroid
	t.Cleanup(func() {
		model.Conf = previousConf
		util.ReadOnly = previousReadOnly
		util.Container = previousContainer
	})

	engine := gin.New()
	store := cookie.NewStore([]byte("mobile-clear-access-auth-api-test-session-key"))
	engine.Use(ginSessions.Sessions("siyuan", store))
	engine.POST("/api/system/setAccessAuthCode", setAccessAuthCode)
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/system/setAccessAuthCode",
		strings.NewReader(`{"accessAuthCode":""}`))
	request.RemoteAddr = "127.0.0.1:1234"
	request.Header.Set("Content-Type", "application/json")
	engine.ServeHTTP(recorder, request)

	response := &struct {
		Code int `json:"code"`
	}{}
	if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
		t.Fatalf("unmarshal mobile setAccessAuthCode response failed: %v", err)
	}
	if response.Code != 0 || model.Conf.AccessAuthCode != "" {
		t.Fatalf("clearing mobile access authentication without OIDC failed: %s", recorder.Body.String())
	}
}

func TestGetConfUILayoutByRole(t *testing.T) {
	gin.SetMode(gin.TestMode)

	oldConf := model.Conf
	model.Conf = model.NewAppConf()
	model.Conf.Sync.Store(conf.NewSync())
	model.Conf.Sync.Load().Enabled = true
	model.Conf.Sync.Load().Provider = 1
	model.Conf.System.Store(&conf.System{})
	uiLayout := conf.UILayout{
		"layout": map[string]any{
			"instance": "Layout",
			"children": []any{
				map[string]any{
					"instance": "Tab",
					"title":    "private-document-title",
					"children": map[string]any{
						"instance":   "Search",
						"config":     map[string]any{"k": "private-search-term"},
						"assetPath":  "assets/private-file.pdf",
						"pluginData": "private-plugin-state",
					},
				},
			},
		},
		"left": map[string]any{
			"data": []any{map[string]any{"title": "private-dock-title"}},
		},
	}
	model.Conf.UILayout.Store(&uiLayout)
	t.Cleanup(func() {
		model.Conf = oldConf
	})

	sentinels := []string{
		"private-document-title",
		"private-search-term",
		"assets/private-file.pdf",
		"private-plugin-state",
		"private-dock-title",
	}
	tests := []struct {
		name        string
		role        model.Role
		expectEmpty bool
	}{
		{name: "administrator", role: model.RoleAdministrator},
		{name: "reader", role: model.RoleReader, expectEmpty: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			engine := gin.New()
			engine.Use(func(c *gin.Context) {
				c.Set(model.RoleContextKey, test.role)
				c.Next()
			})
			engine.POST("/api/system/getConf", getConf)

			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/api/system/getConf", nil)
			engine.ServeHTTP(recorder, request)

			response := &struct {
				Code int `json:"code"`
				Data struct {
					Conf struct {
						UILayout map[string]any `json:"uiLayout"`
					} `json:"conf"`
				} `json:"data"`
			}{}
			if err := json.Unmarshal(recorder.Body.Bytes(), response); err != nil {
				t.Fatalf("unmarshal getConf response failed: %v", err)
			}
			if response.Code != 0 {
				t.Fatalf("getConf failed: %s", recorder.Body.String())
			}
			if strings.Contains(recorder.Body.String(), `"documentAddressingVersion"`) {
				t.Fatal("getConf retained the retired addressing switch")
			}

			for _, sentinel := range sentinels {
				contains := strings.Contains(recorder.Body.String(), sentinel)
				if test.expectEmpty && contains {
					t.Fatalf("reader received administrator layout data %q: %s", sentinel, recorder.Body.String())
				}
				if !test.expectEmpty && !contains {
					t.Fatalf("administrator layout data %q was removed: %s", sentinel, recorder.Body.String())
				}
			}
			if test.expectEmpty && len(response.Data.Conf.UILayout) != 0 {
				t.Fatalf("reader received a non-empty UI layout: %#v", response.Data.Conf.UILayout)
			}
			if !test.expectEmpty && len(response.Data.Conf.UILayout) == 0 {
				t.Fatal("administrator received an empty UI layout")
			}
		})
	}
}

func TestPreserveImportedAISecrets(t *testing.T) {
	currentMCP := &conf.MCP{Servers: []conf.MCPServer{{ID: "server", Headers: map[string]string{"Authorization": "secret"}}}}
	current := &conf.AI{
		Web: &conf.AIWeb{APIKey: "web-key", ExaAPIKey: "exa-key"},
		Providers: []*conf.Provider{
			{ID: "matching", APIKey: "local-key", BaseURL: "https://example.com", Protocol: "openai"},
			{ID: "changed-endpoint", APIKey: "endpoint-key", BaseURL: "https://local.example.com"},
			{ID: "removed", APIKey: "removed-key"},
		},
		Embedding: &conf.Embedding{ID: "embedding", APIKey: "embedding-key", BaseURL: "https://embedding.example.com"},
		Rerank:    &conf.Rerank{ID: "rerank", APIKey: "rerank-key", Endpoint: "https://local.example.com/rerank"},
		MCP:       currentMCP,
	}
	imported := &conf.AI{
		Web: &conf.AIWeb{SearchProvider: "exa", FetchProvider: "deepseek"},
		Providers: []*conf.Provider{
			{ID: "matching", BaseURL: "https://example.com", Protocol: "openai"},
			{ID: "changed-endpoint", BaseURL: "https://imported.example.com"},
			{ID: "different"},
			{ID: "provided", APIKey: "imported-key"},
		},
		Embedding: &conf.Embedding{ID: "embedding", BaseURL: "https://embedding.example.com"},
		Rerank:    &conf.Rerank{ID: "rerank", Endpoint: "https://imported.example.com/rerank"},
	}

	preserveImportedAISecrets(imported, current)
	if imported.Web.ExaAPIKey != "exa-key" || imported.Web.APIKey != "web-key" || imported.Web.FetchProvider != "deepseek" || imported.Web.SearchProvider != "exa" {
		t.Fatal("web credential or independent provider selection lost on import")
	}
	providedWeb := &conf.AI{Web: &conf.AIWeb{APIKey: "provided-web-key", ExaAPIKey: "provided-exa-key"}}
	preserveImportedAISecrets(providedWeb, current)
	if providedWeb.Web.ExaAPIKey != "provided-exa-key" || providedWeb.Web.APIKey != "provided-web-key" {
		t.Fatal("provided web credential was overwritten")
	}

	if imported.Providers[0].APIKey != "local-key" {
		t.Fatalf("matching provider key = %q, want local key", imported.Providers[0].APIKey)
	}
	if imported.Providers[1].APIKey != "" {
		t.Fatalf("changed endpoint provider key = %q, want empty", imported.Providers[1].APIKey)
	}
	if imported.Providers[2].APIKey != "" {
		t.Fatalf("different provider key = %q, want empty", imported.Providers[2].APIKey)
	}
	if imported.Providers[3].APIKey != "imported-key" {
		t.Fatalf("provided provider key = %q, want imported key", imported.Providers[3].APIKey)
	}
	if imported.Embedding.APIKey != "embedding-key" {
		t.Fatalf("embedding key = %q, want local key", imported.Embedding.APIKey)
	}
	if imported.Rerank.APIKey != "" {
		t.Fatalf("different rerank key = %q, want empty", imported.Rerank.APIKey)
	}
	if imported.MCP != currentMCP {
		t.Fatal("local MCP configuration was not preserved")
	}

	matchingRerank := &conf.AI{Rerank: &conf.Rerank{ID: "rerank", Endpoint: "https://local.example.com/rerank"}}
	preserveImportedAISecrets(matchingRerank, current)
	if matchingRerank.Rerank.APIKey != "rerank-key" {
		t.Fatalf("matching rerank key = %q, want local key", matchingRerank.Rerank.APIKey)
	}
}

func TestPreserveImportedAIProviderHeaders(t *testing.T) {
	current := &conf.AI{Providers: []*conf.Provider{{
		ID: "provider", BaseURL: "https://example.com", Headers: map[string]string{"X-Key": "local"},
	}}}
	for _, test := range []struct {
		name    string
		url     string
		headers map[string]string
		want    string
	}{
		{"matching", "https://example.com", nil, "local"},
		{"changed endpoint", "https://other.example.com", nil, ""},
		{"explicit headers", "https://example.com", map[string]string{"X-Key": "imported"}, "imported"},
		{"explicit empty", "https://example.com", map[string]string{}, ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			imported := &conf.AI{Providers: []*conf.Provider{{ID: "provider", BaseURL: test.url, Headers: test.headers}}}
			preserveImportedAISecrets(imported, current)
			if imported.Providers[0].Headers["X-Key"] != test.want {
				t.Fatal("unexpected imported provider headers")
			}
		})
	}
}

func TestPreserveImportedMCPConfiguration(t *testing.T) {
	currentMCP := &conf.MCP{Servers: []conf.MCPServer{{ID: "current"}}}
	importedMCP := &conf.MCP{Servers: []conf.MCPServer{{ID: "imported"}}}
	imported := &conf.AI{MCP: importedMCP}

	preserveImportedAISecrets(imported, &conf.AI{MCP: currentMCP})

	if imported.MCP != importedMCP {
		t.Fatal("imported MCP configuration should take precedence")
	}
}
