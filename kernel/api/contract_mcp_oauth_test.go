package api

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
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

func oauthTestRouter(t *testing.T) *gin.Engine {
	t.Helper()
	previousConf, previousDir, previousReadonly := model.Conf, util.ConfDir, util.ReadOnly
	gin.SetMode(gin.TestMode)
	model.Conf = model.NewAppConf()
	model.Conf.AccessAuthCode, model.Conf.CookieKey, model.Conf.Lang, model.Conf.Api = "password", "cookie-key", "en", &conf.API{Token: "api-token"}
	util.ConfDir, util.ReadOnly = t.TempDir(), false
	t.Cleanup(func() { model.Conf, util.ConfDir, util.ReadOnly = previousConf, previousDir, previousReadonly })
	r := gin.New()
	r.Use(ginSessions.Sessions("oauth-test-session", cookie.NewStore([]byte("oauth-test-session-key"))))
	r.GET("/test-login", func(c *gin.Context) {
		s := util.GetSession(c)
		util.GetWorkspaceSession(s).AccessAuthCode = model.Conf.AccessAuthCode
		if err := s.Save(c); err != nil {
			t.Error(err)
		}
		c.Status(200)
	})
	r.GET("/.well-known/oauth-protected-resource/mcp", mcpOAuthResource)
	r.GET("/.well-known/oauth-protected-resource", mcpOAuthResourceRoot)
	r.GET("/.well-known/oauth-authorization-server", mcpOAuthMetadata)
	r.GET("/oauth/mcp/authorize", mcpOAuthServerAuthorize)
	r.POST("/oauth/mcp/consent", mcpOAuthConsent)
	r.POST("/oauth/mcp/token", mcpOAuthToken)
	r.POST("/oauth/mcp/revoke", mcpOAuthRevoke)
	r.POST("/api/mcp/getOAuth", model.CheckAuth, model.CheckAdminRole, mcpOAuthGet)
	r.POST("/api/mcp/setOAuth", model.CheckAuth, model.CheckAdminRole, model.CheckReadonly, mcpOAuthSet)
	r.POST("/api/mcp/addOAuthClient", model.CheckAuth, model.CheckAdminRole, model.CheckReadonly, mcpOAuthAddClient)
	r.POST("/api/mcp/removeOAuthClient", model.CheckAuth, model.CheckAdminRole, model.CheckReadonly, mcpOAuthRemoveClient)
	r.POST("/mcp", model.CheckMCPAuth, model.CheckAdminRole, model.CheckReadonly, func(c *gin.Context) { c.Status(204) })
	r.POST("/reader-mcp", func(c *gin.Context) { c.Set(model.RoleContextKey, model.RoleReader) }, model.CheckMCPAuth, model.CheckAdminRole, func(c *gin.Context) { c.Status(204) })
	r.POST("/test-api", model.CheckAuth, model.CheckAdminRole, func(c *gin.Context) { c.Status(204) })
	return r
}

func oauthHTTPRequest(t *testing.T, r *gin.Engine, method, path, body, contentType, auth string, cookies []*http.Cookie, origin string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, "https://note.example.com"+path, strings.NewReader(body))
	request.RemoteAddr = "192.0.2.32:1234"
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}
	if auth != "" {
		request.Header.Set("Authorization", auth)
	}
	if origin != "" {
		request.Header.Set("Origin", origin)
	}
	for _, c := range cookies {
		request.AddCookie(c)
	}
	response := httptest.NewRecorder()
	r.ServeHTTP(response, request)
	for _, definition := range apicontract.Definitions() {
		if definition.Path == request.URL.Path && !(strings.HasPrefix(request.URL.Path, "/api/") && response.Code != 200) {
			requireAPIContract(t, method, request.URL.Path, response)
			break
		}
	}
	return response
}

func TestAPIContractMCPOAuthFlow(t *testing.T) {
	r := oauthTestRouter(t)
	call := func(method, path, body, contentType, auth string, cookies []*http.Cookie, origin string) *httptest.ResponseRecorder {
		return oauthHTTPRequest(t, r, method, path, body, contentType, auth, cookies, origin)
	}
	disabled := call("GET", "/.well-known/oauth-protected-resource/mcp", "", "", "", nil, "")
	if disabled.Code != 404 {
		t.Fatal(disabled.Code, disabled.Body.String())
	}
	configured := call("POST", "/api/mcp/setOAuth", `{"enabled":true,"publicURL":"https://note.example.com"}`, "application/json", "Token api-token", nil, "")
	if !strings.Contains(configured.Body.String(), `"code":0`) {
		t.Fatal(configured.Body.String())
	}
	registered := call("POST", "/api/mcp/addOAuthClient", `{"name":"ChatGPT <script>alert(1)</script>","redirectURI":"https://chatgpt.com/connector_platform_oauth_redirect"}`, "application/json", "Token api-token", nil, "")
	var created struct {
		Data apicontract.MCPOAuthClientSecret `json:"data"`
	}
	if err := json.Unmarshal(registered.Body.Bytes(), &created); err != nil || created.Data.Secret == "" {
		t.Fatal(registered.Body.String(), err)
	}
	c := created.Data
	for _, path := range []string{"/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server"} {
		res := call("GET", path, "", "", "", nil, "")
		if res.Code != 200 || strings.Contains(res.Body.String(), `"code":`) || !strings.Contains(res.Body.String(), "https://note.example.com") {
			t.Fatal(res.Body.String())
		}
	}
	challenge := call("POST", "/mcp", "{}", "application/json", "", nil, "")
	if challenge.Code != 401 || !strings.Contains(challenge.Header().Get("WWW-Authenticate"), "/.well-known/oauth-protected-resource/mcp") {
		t.Fatal(challenge.Code, challenge.Header())
	}
	verifier := strings.Repeat("v", 43)
	hash := sha256.Sum256([]byte(verifier))
	v := url.Values{"client_id": {c.ID}, "redirect_uri": {c.RedirectURI}, "response_type": {"code"}, "resource": {"https://note.example.com/mcp"}, "scope": {"mcp offline_access"}, "state": {"original"}, "code_challenge_method": {"S256"}, "code_challenge": {base64.RawURLEncoding.EncodeToString(hash[:])}}
	path := "/oauth/mcp/authorize?" + v.Encode()
	loginRedirect := call("GET", path, "", "", "", nil, "")
	if loginRedirect.Code != 302 || !strings.HasPrefix(loginRedirect.Header().Get("Location"), "/check-auth?to=") {
		t.Fatal(loginRedirect.Code, loginRedirect.Header())
	}
	login := call("GET", "/test-login", "", "", "", nil, "")
	cookies := login.Result().Cookies()
	page := call("GET", path, "", "", "", cookies, "")
	if page.Code != 200 || strings.Contains(page.Body.String(), "<script>") || page.Header().Get("X-Frame-Options") != "DENY" {
		t.Fatal(page.Code, page.Body.String())
	}
	if policy := page.Header().Get("Referrer-Policy"); policy != "same-origin" {
		t.Fatalf("consent form must retain its same-origin POST Origin, got policy %q", policy)
	}
	match := regexp.MustCompile(`name="ticket" value="([^"]+)"`).FindStringSubmatch(page.Body.String())
	if len(match) != 2 {
		t.Fatal(page.Body.String())
	}
	cookies = append(cookies, page.Result().Cookies()...)
	consent := url.Values{"ticket": {match[1]}, "decision": {"approve"}}
	for _, origin := range []string{"https://evil.example", "", "null"} {
		res := call("POST", "/oauth/mcp/consent", consent.Encode(), "application/x-www-form-urlencoded", "", cookies, origin)
		if res.Code != 400 {
			t.Fatal("cross-origin consent accepted", res.Code)
		}
	}
	approved := call("POST", "/oauth/mcp/consent", consent.Encode(), "application/x-www-form-urlencoded", "", cookies, "https://note.example.com")
	if approved.Code != 302 {
		t.Fatal(approved.Code, approved.Body.String())
	}
	if policy := approved.Header().Get("Referrer-Policy"); policy != "no-referrer" {
		t.Fatalf("callback redirect must not disclose the authorization page URL, got policy %q", policy)
	}
	callback, _ := url.Parse(approved.Header().Get("Location"))
	if callback.Query().Get("iss") != "https://note.example.com" || callback.Query().Get("state") != "original" {
		t.Fatal(callback)
	}
	tokenForm := url.Values{"grant_type": {"authorization_code"}, "code": {callback.Query().Get("code")}, "redirect_uri": {c.RedirectURI}, "code_verifier": {verifier}, "resource": {"https://note.example.com/mcp"}}
	basic := "Basic " + base64.StdEncoding.EncodeToString([]byte(c.ID+":"+c.Secret))
	res := call("POST", "/oauth/mcp/token", tokenForm.Encode(), "application/x-www-form-urlencoded", basic, nil, "")
	var token apicontract.MCPOAuthTokenResponse
	if err := json.Unmarshal(res.Body.Bytes(), &token); err != nil || token.AccessToken == "" || token.RefreshToken == "" || res.Code != 200 {
		t.Fatal(res.Code, res.Body.String(), err)
	}
	if res.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("token cached")
	}
	for _, auth := range []string{"Token api-token", "Bearer api-token", "Bearer " + token.AccessToken} {
		if result := call("POST", "/mcp", "{}", "application/json", auth, nil, ""); result.Code != 204 {
			t.Fatal("MCP rejected valid auth", result.Code, result.Body.String())
		}
	}
	if result := call("POST", "/test-api", "{}", "application/json", "Bearer "+token.AccessToken, nil, ""); result.Code != 401 {
		t.Fatal("OAuth token escaped MCP", result.Code)
	}
	if result := call("POST", "/reader-mcp", "{}", "application/json", "Bearer "+token.AccessToken, nil, ""); result.Code != 403 {
		t.Fatal("reader elevated", result.Code)
	}
	util.ReadOnly = true
	if result := call("POST", "/mcp", "{}", "application/json", "Bearer "+token.AccessToken, nil, ""); result.Code == 204 {
		t.Fatal("read-only bypassed")
	}
	util.ReadOnly = false
	refresh := url.Values{"grant_type": {"refresh_token"}, "client_id": {c.ID}, "client_secret": {c.Secret}, "refresh_token": {token.RefreshToken}, "resource": {"https://note.example.com/mcp"}}
	res = call("POST", "/oauth/mcp/token", refresh.Encode(), "application/x-www-form-urlencoded", "", nil, "")
	if err := json.Unmarshal(res.Body.Bytes(), &token); err != nil || res.Code != 200 {
		t.Fatal(res.Body.String(), err)
	}
	revoke := url.Values{"token": {token.RefreshToken}, "client_id": {c.ID}, "client_secret": {c.Secret}}
	if result := call("POST", "/oauth/mcp/revoke", revoke.Encode(), "application/x-www-form-urlencoded", "", nil, ""); result.Code != 200 {
		t.Fatal(result.Body.String())
	}
	if result := call("POST", "/mcp", "{}", "application/json", "Bearer "+token.AccessToken, nil, ""); result.Code != 401 {
		t.Fatal("revoked token accepted", result.Code)
	}
	status := call("POST", "/api/mcp/getOAuth", "", "", "Token api-token", nil, "")
	if strings.Contains(status.Body.String(), c.Secret) || strings.Contains(status.Body.String(), "secretHash") {
		t.Fatal("secret disclosed")
	}
}

func TestAPIContractMCPOAuthMalformedRequests(t *testing.T) {
	r := oauthTestRouter(t)
	for _, tc := range []struct{ body, contentType string }{
		{"client_id=a&client_id=b", "application/x-www-form-urlencoded"},
		{"x=%broken", "application/x-www-form-urlencoded"},
		{"x=" + strings.Repeat("a", 17000), "application/x-www-form-urlencoded"},
		{`{}`, "application/json"},
	} {
		res := oauthHTTPRequest(t, r, "POST", "/oauth/mcp/token", tc.body, tc.contentType, "", nil, "")
		if res.Code != 400 || res.Body.String() != `{"error":"invalid_request"}` {
			t.Fatal(res.Code, res.Body.String())
		}
	}
	for _, path := range []string{"/api/mcp/getOAuth", "/api/mcp/setOAuth", "/api/mcp/addOAuthClient", "/api/mcp/removeOAuthClient"} {
		res := oauthHTTPRequest(t, r, "POST", path, "{}", "application/json", "", nil, "")
		if res.Code != 401 {
			t.Fatal("unauthenticated management", path, res.Code)
		}
	}
}
