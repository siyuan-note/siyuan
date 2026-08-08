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
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	ginSessions "github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

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
	model.Conf.Sync = conf.NewSync()
	model.Conf.Sync.Enabled = true
	model.Conf.Sync.Provider = 1
	model.Conf.System = &conf.System{}
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
	model.Conf.UILayout = &uiLayout
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

func TestPreserveImportedMCPConfiguration(t *testing.T) {
	currentMCP := &conf.MCP{Servers: []conf.MCPServer{{ID: "current"}}}
	importedMCP := &conf.MCP{Servers: []conf.MCPServer{{ID: "imported"}}}
	imported := &conf.AI{MCP: importedMCP}

	preserveImportedAISecrets(imported, &conf.AI{MCP: currentMCP})

	if imported.MCP != importedMCP {
		t.Fatal("imported MCP configuration should take precedence")
	}
}
