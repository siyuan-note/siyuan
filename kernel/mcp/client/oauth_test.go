// SiYuan - Refactor your thinking
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

package client

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestProtectedResourceURLs(t *testing.T) {
	candidates := protectedResourceURLs("https://example.com/custom-metadata", "https://example.com/mcp?tenant=one#fragment")
	if len(candidates) != 3 {
		t.Fatalf("unexpected candidate count: %d", len(candidates))
	}
	if candidates[0].URL != "https://example.com/custom-metadata" ||
		candidates[1].URL != "https://example.com/.well-known/oauth-protected-resource/mcp" ||
		candidates[2].URL != "https://example.com/.well-known/oauth-protected-resource" {
		t.Fatalf("unexpected metadata candidates: %#v", candidates)
	}
}

func TestCompleteMCPOAuth(t *testing.T) {
	flowID := "test-flow"
	flow := &oauthFlow{State: "test-state", Result: make(chan oauthCallbackResult, 1), Expires: time.Now().Add(time.Minute)}
	oauthFlows.Lock()
	oauthFlows.items[flowID] = flow
	oauthFlows.Unlock()
	t.Cleanup(func() { removeOAuthFlow(flowID, flow) })

	if err := CompleteMCPOAuth(flowID, "code", "wrong-state", ""); err == nil {
		t.Fatal("expected state mismatch")
	}
	if err := CompleteMCPOAuth(flowID, "code", "test-state", ""); err != nil {
		t.Fatal(err)
	}
	result := <-flow.Result
	if result.Code != "code" || result.State != "test-state" {
		t.Fatalf("unexpected callback result: %#v", result)
	}
}

func TestRefreshOAuthCredential(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Error(err)
		}
		if r.Form.Get("grant_type") != "refresh_token" || r.Form.Get("refresh_token") != "old-refresh" ||
			r.Form.Get("resource") != "https://example.com/mcp" || r.Form.Get("client_id") != "client-id" {
			t.Errorf("unexpected refresh request: %#v", r.Form)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"new-access","token_type":"Bearer","expires_in":3600,"scope":"todo.read offline_access"}`))
	}))
	defer server.Close()

	credential := oauthCredential{
		Resource:        "https://example.com/mcp",
		ClientID:        "client-id",
		TokenEndpoint:   server.URL,
		TokenAuthMethod: "none",
		RefreshToken:    "old-refresh",
	}
	refreshed, permanent, err := refreshOAuthCredential(context.Background(), server.Client(), credential)
	if err != nil || permanent {
		t.Fatalf("refresh failed: permanent=%v err=%v", permanent, err)
	}
	if refreshed.AccessToken != "new-access" || refreshed.RefreshToken != "old-refresh" ||
		!slices.Equal(refreshed.Scopes, []string{"todo.read", "offline_access"}) || refreshed.Expiry.Before(time.Now()) {
		t.Fatalf("unexpected refreshed credential: %#v", refreshed)
	}
}

func TestIsLoopbackCallback(t *testing.T) {
	if !IsLoopbackCallback("127.0.0.1:1234") || !IsLoopbackCallback("[::1]:1234") || IsLoopbackCallback("192.0.2.1:1234") {
		t.Fatal("unexpected loopback callback result")
	}
}

func TestReusableOAuthFlowIDFollowsKernelPort(t *testing.T) {
	oldServerPort := util.ServerPort
	t.Cleanup(func() { util.ServerPort = oldServerPort })
	credential := oauthCredential{RedirectURL: "http://127.0.0.1:6806/api/ai/mcp/oauth/callback/flow-id"}
	util.ServerPort = "6806"
	if flowID := reusableOAuthFlowID(credential); flowID != "flow-id" {
		t.Fatalf("unexpected reusable flow ID: %q", flowID)
	}
	util.ServerPort = "6807"
	if flowID := reusableOAuthFlowID(credential); flowID != "" {
		t.Fatalf("callback from an old kernel port was reused: %q", flowID)
	}
}

func TestOAuthClientRegistrationExpiry(t *testing.T) {
	if oauthClientRegistrationExpired(oauthCredential{}) {
		t.Fatal("registration without an expiry was treated as expired")
	}
	if !oauthClientRegistrationExpired(oauthCredential{ClientSecretExpiry: time.Now().Add(-time.Minute)}) {
		t.Fatal("expired client registration was reused")
	}
	if oauthClientRegistrationExpired(oauthCredential{ClientSecretExpiry: time.Now().Add(time.Minute)}) {
		t.Fatal("valid client registration was treated as expired")
	}
}

func TestMCPOAuthInteractiveModeIsDisabledAfterBootstrap(t *testing.T) {
	handler := newMCPOAuthHandler(conf.MCPServer{}, true)
	if !handler.interactive.Load() {
		t.Fatal("interactive OAuth was not enabled for bootstrap")
	}
	handler.disableInteractive()
	if handler.interactive.Load() {
		t.Fatal("interactive OAuth remained enabled after bootstrap")
	}
}

func TestOAuthCredentialEncryptedPersistence(t *testing.T) {
	useOAuthTestConf(t)

	credential := oauthCredential{
		ServerID:      "server-id",
		Endpoint:      "https://example.com/mcp",
		Resource:      "https://example.com/mcp",
		Issuer:        "https://example.com",
		ClientID:      "client-id",
		TokenEndpoint: "https://example.com/token",
		AccessToken:   "secret-access-token",
		RefreshToken:  "secret-refresh-token",
	}
	if err := putOAuthCredential(credential); err != nil {
		t.Fatal(err)
	}
	ciphertext := model.Conf.GetMCPOAuth()
	if ciphertext == "" || strings.Contains(ciphertext, credential.AccessToken) {
		t.Fatal("OAuth credentials were not encrypted")
	}
	decrypted := util.AESDecrypt(ciphertext)
	plain, err := hex.DecodeString(string(decrypted))
	if err != nil {
		t.Fatal(err)
	}
	data := &oauthCredentialData{}
	if err = json.Unmarshal(plain, data); err != nil || len(data.Credentials) != 1 || data.Credentials[0].RefreshToken != credential.RefreshToken {
		t.Fatalf("unexpected persisted credentials: %#v, %v", data, err)
	}

	resetOAuthCredentialStore()
	loaded, ok := getOAuthCredential(credential.ServerID, credential.Endpoint)
	if !ok || loaded.AccessToken != credential.AccessToken {
		t.Fatalf("unexpected loaded credential: %#v", loaded)
	}
}

func TestOAuthCredentialLookupUsesMCPEndpoint(t *testing.T) {
	useOAuthTestConf(t)
	credential := oauthCredential{
		ServerID:      "server-id",
		Endpoint:      "https://example.com/mcp",
		Resource:      "https://example.com",
		Issuer:        "https://auth.example.com",
		ClientID:      "client-id",
		TokenEndpoint: "https://auth.example.com/token",
		AccessToken:   "access-token",
	}
	if err := putOAuthCredential(credential); err != nil {
		t.Fatal(err)
	}
	loaded, ok := getOAuthCredential(credential.ServerID, credential.Endpoint)
	if !ok || loaded.Resource != credential.Resource {
		t.Fatalf("unexpected credential lookup result: %#v", loaded)
	}
}

func TestMarkOAuthCredentialRejectedKeepsTokensForRevocation(t *testing.T) {
	useOAuthTestConf(t)
	credential := oauthCredential{
		ServerID:      "server-id",
		Endpoint:      "https://example.com/mcp",
		Resource:      "https://example.com/mcp",
		Issuer:        "https://example.com",
		ClientID:      "client-id",
		TokenEndpoint: "https://example.com/token",
		AccessToken:   "access-token",
		RefreshToken:  "refresh-token",
	}
	if err := putOAuthCredential(credential); err != nil {
		t.Fatal(err)
	}
	if err := markOAuthCredentialRejected(credential.ServerID, credential.Endpoint); err != nil {
		t.Fatal(err)
	}
	cleared, ok := getOAuthCredential(credential.ServerID, credential.Endpoint)
	if !ok || cleared.ClientID != credential.ClientID || cleared.AccessToken != credential.AccessToken ||
		cleared.RefreshToken != credential.RefreshToken || !cleared.Rejected {
		t.Fatalf("unexpected rejected credential: %#v", cleared)
	}
}

func TestMalformedOAuthCredentialCiphertextIsIgnored(t *testing.T) {
	useOAuthTestConf(t)
	model.Conf.MCPOAuth = strings.Repeat("0", 32)
	resetOAuthCredentialStore()
	if credentials := listOAuthCredentials("server-id"); len(credentials) != 0 {
		t.Fatalf("unexpected credentials: %#v", credentials)
	}
}

func TestMCPOAuthAuthorizationCodeFlow(t *testing.T) {
	useOAuthTestConf(t)
	oldServerPort := util.ServerPort
	util.ServerPort = "6806"
	t.Cleanup(func() { util.ServerPort = oldServerPort })

	registrationRedirect := make(chan string, 1)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/resource-metadata":
			writeOAuthTestJSON(w, http.StatusOK, map[string]any{
				"resource":              server.URL + "/mcp",
				"authorization_servers": []string{server.URL},
				"scopes_supported":      []string{"todo.read", "offline_access"},
			})
		case "/.well-known/oauth-authorization-server":
			writeOAuthTestJSON(w, http.StatusOK, oauthTestAuthorizationServerMetadata(server.URL))
		case "/register":
			metadata := struct {
				RedirectURIs            []string `json:"redirect_uris"`
				TokenEndpointAuthMethod string   `json:"token_endpoint_auth_method"`
				Scope                   string   `json:"scope"`
			}{}
			if err := json.NewDecoder(r.Body).Decode(&metadata); err != nil {
				t.Errorf("decode registration: %v", err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			if len(metadata.RedirectURIs) != 1 || metadata.TokenEndpointAuthMethod != "none" ||
				metadata.Scope != "todo.read offline_access" {
				t.Errorf("unexpected registration metadata: %#v", metadata)
			}
			registrationRedirect <- metadata.RedirectURIs[0]
			writeOAuthTestJSON(w, http.StatusCreated, map[string]any{
				"client_id":                  "client-id",
				"token_endpoint_auth_method": "none",
			})
		case "/token":
			if err := r.ParseForm(); err != nil {
				t.Errorf("parse token request: %v", err)
			}
			if r.Form.Get("grant_type") != "authorization_code" || r.Form.Get("code") != "authorization-code" ||
				r.Form.Get("client_id") != "client-id" || r.Form.Get("code_verifier") == "" ||
				r.Form.Get("resource") != server.URL+"/mcp" {
				t.Errorf("unexpected token request: %#v", r.Form)
			}
			writeOAuthTestJSON(w, http.StatusOK, map[string]any{
				"access_token":  "access-token",
				"refresh_token": "refresh-token",
				"token_type":    "Bearer",
				"expires_in":    3600,
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	serverID := "authorization-code-server"
	handler := newMCPOAuthHandler(conf.MCPServer{ID: serverID, URL: server.URL + "/mcp"}, true)
	authorizeResult := make(chan error, 1)
	go func() {
		authorizeResult <- handler.Authorize(context.Background(), httptest.NewRequest(http.MethodPost, server.URL+"/mcp", nil),
			newOAuthChallengeResponse(server.URL+"/resource-metadata"))
	}()

	var redirectURL string
	select {
	case redirectURL = <-registrationRedirect:
	case <-time.After(5 * time.Second):
		t.Fatal("OAuth client registration did not complete")
	}
	callback, err := url.Parse(redirectURL)
	if err != nil {
		t.Fatal(err)
	}
	if callback.Host != "127.0.0.1:6806" {
		t.Fatalf("unexpected callback host: %s", callback.Host)
	}
	flowID := strings.TrimPrefix(callback.Path, "/api/ai/mcp/oauth/callback/")
	if flowID == "" || flowID == callback.Path {
		t.Fatalf("unexpected callback path: %s", callback.Path)
	}

	authorizationURL := waitForOAuthAuthorizationURL(t, serverID)
	authorizationRequest, err := url.Parse(authorizationURL)
	if err != nil {
		t.Fatal(err)
	}
	query := authorizationRequest.Query()
	if authorizationRequest.Path != "/authorize" || query.Get("client_id") != "client-id" ||
		query.Get("redirect_uri") != redirectURL || query.Get("code_challenge_method") != "S256" ||
		query.Get("resource") != server.URL+"/mcp" || query.Get("scope") != "todo.read offline_access" {
		t.Fatalf("unexpected authorization URL: %s", authorizationURL)
	}
	if err = CompleteMCPOAuth(flowID, "authorization-code", query.Get("state"), ""); err != nil {
		t.Fatal(err)
	}
	select {
	case err = <-authorizeResult:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("OAuth authorization did not complete")
	}

	credential, ok := getOAuthCredential(serverID, server.URL+"/mcp")
	if !ok || credential.AccessToken != "access-token" || credential.RefreshToken != "refresh-token" ||
		credential.Endpoint != server.URL+"/mcp" || credential.ResourceMetadataURL != server.URL+"/resource-metadata" {
		t.Fatalf("unexpected stored credential: %#v", credential)
	}
}

func TestAuthorizeRefreshesRejectedAccessToken(t *testing.T) {
	useOAuthTestConf(t)
	refreshRequests := make(chan url.Values, 1)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/resource-metadata":
			writeOAuthTestJSON(w, http.StatusOK, map[string]any{
				"resource":              server.URL + "/mcp",
				"authorization_servers": []string{server.URL},
			})
		case "/.well-known/oauth-authorization-server":
			writeOAuthTestJSON(w, http.StatusOK, oauthTestAuthorizationServerMetadata(server.URL))
		case "/token":
			if err := r.ParseForm(); err != nil {
				t.Errorf("parse refresh request: %v", err)
			}
			refreshRequests <- r.Form
			writeOAuthTestJSON(w, http.StatusOK, map[string]any{
				"access_token":  "new-access-token",
				"refresh_token": "new-refresh-token",
				"token_type":    "Bearer",
				"expires_in":    3600,
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	credential := oauthCredential{
		ServerID:            "refresh-server",
		Endpoint:            server.URL + "/mcp",
		Resource:            server.URL + "/mcp",
		Issuer:              server.URL,
		ResourceMetadataURL: server.URL + "/resource-metadata",
		ClientID:            "client-id",
		TokenEndpoint:       server.URL + "/old-token",
		TokenAuthMethod:     "none",
		AccessToken:         "rejected-access-token",
		RefreshToken:        "refresh-token",
		TokenType:           "Bearer",
		Expiry:              time.Now().Add(time.Hour),
	}
	if err := putOAuthCredential(credential); err != nil {
		t.Fatal(err)
	}
	handler := newMCPOAuthHandler(conf.MCPServer{ID: credential.ServerID, URL: credential.Endpoint}, false)
	if err := handler.Authorize(context.Background(), httptest.NewRequest(http.MethodPost, credential.Endpoint, nil),
		newOAuthChallengeResponse(credential.ResourceMetadataURL)); err != nil {
		t.Fatal(err)
	}
	select {
	case form := <-refreshRequests:
		if form.Get("grant_type") != "refresh_token" || form.Get("refresh_token") != credential.RefreshToken {
			t.Fatalf("unexpected refresh request: %#v", form)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("refresh request was not sent")
	}
	refreshed, ok := getOAuthCredential(credential.ServerID, credential.Endpoint)
	if !ok || refreshed.AccessToken != "new-access-token" || refreshed.RefreshToken != "new-refresh-token" {
		t.Fatalf("unexpected refreshed credential: %#v", refreshed)
	}
}

func TestInteractiveOAuthFailureCanBeRetried(t *testing.T) {
	server := httptest.NewServer(http.NotFoundHandler())
	defer server.Close()
	serverID := "retry-server"
	t.Cleanup(func() {
		mcpMu.Lock()
		delete(mcpRuntime, serverID)
		mcpMu.Unlock()
	})
	handler := newMCPOAuthHandler(conf.MCPServer{ID: serverID, URL: server.URL + "/mcp"}, true)
	err := handler.Authorize(context.Background(), httptest.NewRequest(http.MethodPost, server.URL+"/mcp", nil),
		newOAuthChallengeResponse(server.URL+"/missing-resource-metadata"))
	if err == nil {
		t.Fatal("expected OAuth discovery failure")
	}
	mcpMu.Lock()
	state := mcpRuntime[serverID]
	mcpMu.Unlock()
	if state.Status != "authorization_required" || state.Error == "" {
		t.Fatalf("unexpected retry state: %#v", state)
	}
}

func TestDisconnectMCPOAuthClearsBeforeRemoteRevocation(t *testing.T) {
	useOAuthTestConf(t)
	revoked := make(chan string, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Errorf("parse revocation request: %v", err)
		}
		revoked <- r.Form.Get("token")
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	credential := oauthCredential{
		ServerID:           "disconnect-server",
		Endpoint:           server.URL + "/mcp",
		Resource:           server.URL + "/mcp",
		Issuer:             server.URL,
		ClientID:           "client-id",
		TokenEndpoint:      server.URL + "/token",
		RevocationEndpoint: server.URL,
		TokenAuthMethod:    "none",
		AccessToken:        "access-token",
		RefreshToken:       "refresh-token",
	}
	if err := putOAuthCredential(credential); err != nil {
		t.Fatal(err)
	}
	started := time.Now()
	if err := DisconnectMCPOAuth(credential.ServerID); err != nil {
		t.Fatal(err)
	}
	if time.Since(started) > time.Second {
		t.Fatal("disconnect waited for remote revocation")
	}
	if _, ok := getOAuthCredential(credential.ServerID, credential.Endpoint); ok {
		t.Fatal("credential was not cleared locally")
	}
	var tokens []string
	for len(tokens) < 2 {
		select {
		case token := <-revoked:
			tokens = append(tokens, token)
		case <-time.After(5 * time.Second):
			t.Fatalf("remote revocation did not complete: %#v", tokens)
		}
	}
	if !slices.Contains(tokens, "access-token") || !slices.Contains(tokens, "refresh-token") {
		t.Fatalf("unexpected revoked tokens: %#v", tokens)
	}
}

func oauthTestAuthorizationServerMetadata(issuer string) map[string]any {
	return map[string]any{
		"issuer":                                issuer,
		"authorization_endpoint":                issuer + "/authorize",
		"token_endpoint":                        issuer + "/token",
		"registration_endpoint":                 issuer + "/register",
		"revocation_endpoint":                   issuer + "/revoke",
		"code_challenge_methods_supported":      []string{"S256"},
		"token_endpoint_auth_methods_supported": []string{"none"},
		"grant_types_supported":                 []string{"authorization_code", "refresh_token"},
		"response_types_supported":              []string{"code"},
		"scopes_supported":                      []string{"todo.read", "offline_access"},
	}
}

func newOAuthChallengeResponse(metadataURL string) *http.Response {
	response := &http.Response{
		StatusCode: http.StatusUnauthorized,
		Status:     "401 Unauthorized",
		Header:     http.Header{},
		Body:       io.NopCloser(strings.NewReader("")),
	}
	response.Header.Set("WWW-Authenticate", fmt.Sprintf(`Bearer resource_metadata="%s"`, metadataURL))
	return response
}

func waitForOAuthAuthorizationURL(t *testing.T, serverID string) string {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		mcpMu.Lock()
		state := mcpRuntime[serverID]
		mcpMu.Unlock()
		if state.AuthorizationURL != "" {
			return state.AuthorizationURL
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("authorization URL was not published")
	return ""
}

func writeOAuthTestJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func useOAuthTestConf(t *testing.T) {
	t.Helper()
	oldConf, oldConfDir, oldReadOnly := model.Conf, util.ConfDir, util.ReadOnly
	model.Conf = model.NewAppConf()
	model.Conf.System = &conf.System{}
	util.ConfDir = t.TempDir()
	util.ReadOnly = false
	resetOAuthCredentialStore()
	t.Cleanup(func() {
		model.Conf, util.ConfDir, util.ReadOnly = oldConf, oldConfDir, oldReadOnly
		resetOAuthCredentialStore()
	})
}

func resetOAuthCredentialStore() {
	oauthCredentialStore.Lock()
	oauthCredentialStore.loaded = false
	oauthCredentialStore.credentials = nil
	oauthCredentialStore.Unlock()
}
