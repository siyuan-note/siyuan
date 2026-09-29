package api

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"html/template"
	"mime"
	"net/http"
	"net/url"
	"path/filepath"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/model/mcpoauth"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func mcpOAuthJSON[T any](status int, value T) apicontract.Response[apicontract.BinaryContent] {
	data, err := json.Marshal(value)
	if err != nil {
		return apicontract.SuccessHTTPContent(500, "application/json", []byte(`{"error":"server_error"}`))
	}
	return apicontract.SuccessHTTPContent(status, "application/json", data)
}

func mcpOAuthError(err error) apicontract.Response[apicontract.BinaryContent] {
	status, code := 500, "server_error"
	switch {
	case errors.Is(err, mcpoauth.ErrClient):
		status, code = 401, "invalid_client"
	case errors.Is(err, mcpoauth.ErrGrant):
		status, code = 400, "invalid_grant"
	case errors.Is(err, mcpoauth.ErrInvalid):
		status, code = 400, "invalid_request"
	case errors.Is(err, mcpoauth.ErrDisabled):
		status, code = 404, "temporarily_unavailable"
	case err != nil && err.Error() == "unsupported_grant_type":
		status, code = 400, "unsupported_grant_type"
	}
	return mcpOAuthJSON(status, apicontract.MCPOAuthError{Error: code})
}

func mcpOAuthHeaders(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Content-Type-Options", "nosniff")
}

func activeMCPOAuth(c *gin.Context) (*mcpoauth.Service, error) {
	mcpOAuthHeaders(c)
	s, err := model.MCPOAuthService()
	if err != nil {
		return nil, err
	}
	if !s.Status().Enabled || !model.MCPOAuthAvailable() {
		return nil, mcpoauth.ErrDisabled
	}
	return s, nil
}

var mcpOAuthResource = contractHandler(apicontract.MCPOAuthResource, mcpOAuthResourceContract)
var mcpOAuthResourceRoot = contractHandler(apicontract.MCPOAuthResourceRoot, mcpOAuthResourceContract)

func mcpOAuthResourceContract(c *gin.Context, _ apicontract.EmptyRequest) apicontract.Response[apicontract.BinaryContent] {
	s, err := activeMCPOAuth(c)
	if err != nil {
		return mcpOAuthError(err)
	}
	origin := s.Status().PublicURL
	return mcpOAuthJSON(200, apicontract.MCPOAuthResourceMetadata{Resource: origin + "/mcp", AuthorizationServers: []string{origin}, ScopesSupported: []string{"mcp", "offline_access"}, BearerMethodsSupported: []string{"header"}})
}

var mcpOAuthMetadata = contractHandler(apicontract.MCPOAuthMetadata, mcpOAuthMetadataContract)

func mcpOAuthMetadataContract(c *gin.Context, _ apicontract.EmptyRequest) apicontract.Response[apicontract.BinaryContent] {
	s, err := activeMCPOAuth(c)
	if err != nil {
		return mcpOAuthError(err)
	}
	origin := s.Status().PublicURL
	return mcpOAuthJSON(200, apicontract.MCPOAuthServerMetadata{Issuer: origin,
		AuthorizationEndpoint: origin + "/oauth/mcp/authorize", TokenEndpoint: origin + "/oauth/mcp/token", RevocationEndpoint: origin + "/oauth/mcp/revoke",
		ResponseTypesSupported: []string{"code"}, GrantTypesSupported: []string{"authorization_code", "refresh_token"},
		CodeChallengeMethodsSupported: []string{"S256"}, TokenEndpointAuthMethodsSupported: []string{"client_secret_basic", "client_secret_post"},
		ScopesSupported: []string{"mcp", "offline_access"}, AuthorizationResponseISSParameterSupported: true})
}

// checkMCPOAuthForm 限制表单大小并拒绝重复参数，防止认证参数被不同解析器赋予不同含义。
func checkMCPOAuthForm(c *gin.Context) error {
	mcpOAuthHeaders(c)
	media, _, err := mime.ParseMediaType(c.GetHeader("Content-Type"))
	if err != nil || media != "application/x-www-form-urlencoded" {
		return mcpoauth.ErrInvalid
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16384)
	if err = c.Request.ParseForm(); err != nil {
		return mcpoauth.ErrInvalid
	}
	if c.Request.URL.RawQuery != "" {
		return mcpoauth.ErrInvalid
	}
	for _, values := range c.Request.PostForm {
		if len(values) != 1 || len(values[0]) > 4096 {
			return mcpoauth.ErrInvalid
		}
	}
	return nil
}

func mcpOAuthFormGuard(c *gin.Context) *apicontract.Response[apicontract.BinaryContent] {
	if err := checkMCPOAuthForm(c); err != nil {
		ret := mcpOAuthError(err)
		return &ret
	}
	return nil
}

func mcpOAuthClientAuthentication(c *gin.Context, req *apicontract.MCPOAuthTokenRequest) (err error) {
	defer func() {
		if err != nil {
			c.Header("WWW-Authenticate", `Basic realm="MCP OAuth"`)
		}
	}()
	if c.GetHeader("Authorization") == "" {
		return nil
	}
	id, secret, ok := c.Request.BasicAuth()
	if !ok || req.ClientSecret != "" {
		return mcpoauth.ErrClient
	}
	if id, err = url.QueryUnescape(id); err != nil {
		return mcpoauth.ErrClient
	}
	if req.ClientID != "" && req.ClientID != id {
		return mcpoauth.ErrClient
	}
	req.ClientID = id
	if req.ClientSecret, err = url.QueryUnescape(secret); err != nil {
		return mcpoauth.ErrClient
	}
	return nil
}

var mcpOAuthToken = contractHandler(apicontract.MCPOAuthToken, mcpOAuthTokenContract, mcpOAuthFormGuard)

func mcpOAuthTokenContract(c *gin.Context, req apicontract.MCPOAuthTokenRequest) apicontract.Response[apicontract.BinaryContent] {
	s, err := activeMCPOAuth(c)
	if err != nil {
		return mcpOAuthError(err)
	}
	if err = mcpOAuthClientAuthentication(c, &req); err != nil {
		return mcpOAuthError(err)
	}
	if retry := util.AuthThrottleCheck("mcp-oauth:" + c.ClientIP()); retry > 0 {
		return mcpOAuthJSON(429, apicontract.MCPOAuthError{Error: "temporarily_unavailable"})
	}
	token, err := s.Token(req)
	if err != nil {
		if errors.Is(err, mcpoauth.ErrClient) {
			util.AuthThrottleFail("mcp-oauth:" + c.ClientIP())
			c.Header("WWW-Authenticate", `Basic realm="MCP OAuth"`)
		}
		return mcpOAuthError(err)
	}
	util.AuthThrottleReset("mcp-oauth:" + c.ClientIP())
	return mcpOAuthJSON(200, token)
}

var mcpOAuthRevoke = contractHandler(apicontract.MCPOAuthRevoke, mcpOAuthRevokeContract, mcpOAuthFormGuard)

func mcpOAuthRevokeContract(c *gin.Context, req apicontract.MCPOAuthTokenRequest) apicontract.Response[apicontract.BinaryContent] {
	s, err := activeMCPOAuth(c)
	if err != nil {
		return mcpOAuthError(err)
	}
	if err = mcpOAuthClientAuthentication(c, &req); err != nil {
		return mcpOAuthError(err)
	}
	if retry := util.AuthThrottleCheck("mcp-oauth:" + c.ClientIP()); retry > 0 {
		return mcpOAuthJSON(429, apicontract.MCPOAuthError{Error: "temporarily_unavailable"})
	}
	if err = s.Revoke(req); err != nil {
		if errors.Is(err, mcpoauth.ErrClient) {
			util.AuthThrottleFail("mcp-oauth:" + c.ClientIP())
			c.Header("WWW-Authenticate", `Basic realm="MCP OAuth"`)
		}
		return mcpOAuthError(err)
	}
	util.AuthThrottleReset("mcp-oauth:" + c.ClientIP())
	return mcpOAuthJSON(200, struct{}{})
}

var mcpOAuthGet = contractHandler(apicontract.MCPOAuthGet, mcpOAuthGetContract)

func mcpOAuthGetContract(c *gin.Context, _ apicontract.EmptyRequest) apicontract.Response[apicontract.MCPOAuthStatus] {
	mcpOAuthHeaders(c)
	s, err := model.MCPOAuthService()
	if err != nil {
		return apicontract.Failure[apicontract.MCPOAuthStatus](-1, mcpOAuthLanguage("mcpOAuthError"))
	}
	return apicontract.Success(s.Status())
}

var mcpOAuthSet = contractHandler(apicontract.MCPOAuthSet, mcpOAuthSetContract)

func mcpOAuthSetContract(c *gin.Context, req apicontract.MCPOAuthConfig) apicontract.Response[apicontract.Null] {
	s, err := model.MCPOAuthService()
	if err == nil && req.Enabled && !model.MCPOAuthAvailable() {
		err = mcpoauth.ErrDisabled
	}
	if err == nil {
		err = s.Configure(req)
	}
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, mcpOAuthLanguage("mcpOAuthError"))
	}
	return apicontract.Success(apicontract.Null{})
}

var mcpOAuthAddClient = contractHandler(apicontract.MCPOAuthAddClient, mcpOAuthAddClientContract)

func mcpOAuthAddClientContract(c *gin.Context, req apicontract.MCPOAuthClientRequest) apicontract.Response[apicontract.MCPOAuthClientSecret] {
	mcpOAuthHeaders(c)
	s, err := model.MCPOAuthService()
	if err != nil {
		return apicontract.Failure[apicontract.MCPOAuthClientSecret](-1, mcpOAuthLanguage("mcpOAuthError"))
	}
	client, err := s.AddClient(req)
	if err != nil {
		return apicontract.Failure[apicontract.MCPOAuthClientSecret](-1, mcpOAuthLanguage("mcpOAuthError"))
	}
	return apicontract.Success(client)
}

var mcpOAuthRemoveClient = contractHandler(apicontract.MCPOAuthRemoveClient, mcpOAuthRemoveClientContract)

func mcpOAuthRemoveClientContract(c *gin.Context, req apicontract.MCPOAuthRemoveRequest) apicontract.Response[apicontract.Null] {
	s, err := model.MCPOAuthService()
	if err == nil {
		err = s.Remove(req.ID, req.All)
	}
	if err != nil {
		return apicontract.Failure[apicontract.Null](-1, mcpOAuthLanguage("mcpOAuthError"))
	}
	return apicontract.Success(apicontract.Null{})
}

func mcpOAuthLanguage(key string) string { return util.I18nTerm(model.Conf.Lang, key) }

var mcpOAuthPage = template.Must(template.New("mcp-oauth").Parse(`<!doctype html>
<html lang="{{.Lang}}" dir="auto" data-theme-mode="{{.Mode}}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{.Title}}</title>{{if .CSS}}<link rel="stylesheet" href="{{.CSS}}">{{end}}
<link rel="stylesheet" href="{{.Theme}}"></head>
<body style="overflow:auto"><main class="b3-label" style="max-width:640px;margin:8vh auto;overflow-wrap:anywhere">
<h1>{{.Title}}</h1>{{if .Error}}<p>{{.Error}}</p>{{else}}
<p>{{.Workspace}}</p><h2>{{.Name}}</h2><p>{{.Redirect}}</p><p>{{.Tip}}</p>
<form method="post" action="/oauth/mcp/consent"><input type="hidden" name="ticket" value="{{.Ticket}}">
<button class="b3-button" name="decision" value="approve">{{.Approve}}</button>
<button class="b3-button b3-button--outline" name="decision" value="deny">{{.Cancel}}</button>
</form>{{end}}</main></body></html>`))

func mcpOAuthHTML(c *gin.Context, status int, ticket string, client apicontract.MCPOAuthClient) apicontract.Response[apicontract.BinaryContent] {
	mcpOAuthHeaders(c)
	if ticket != "" {
		// 同源表单提交需要保留 Origin；跨站导航不发送 Referer。
		c.Header("Referrer-Policy", "same-origin")
	}
	c.Header("Content-Security-Policy", "default-src 'none'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'")
	c.Header("X-Frame-Options", "DENY")
	data := map[string]string{"Title": mcpOAuthLanguage("mcpOAuthServer"), "Workspace": util.WorkspaceName, "Name": client.Name, "Redirect": client.RedirectURI,
		"Ticket": ticket, "Tip": mcpOAuthLanguage("mcpOAuthConsentTip"), "Approve": mcpOAuthLanguage("confirm"), "Cancel": mcpOAuthLanguage("cancel"), "Theme": "/appearance/themes/daylight/theme.css", "Lang": model.Conf.Lang, "Mode": "light"}
	if model.Conf.Appearance != nil && model.Conf.Appearance.Mode == 1 {
		data["Theme"] = "/appearance/themes/midnight/theme.css"
		data["Mode"] = "dark"
	}
	if paths, _ := filepath.Glob(filepath.Join(util.WorkingDir, "stage", "build", "desktop", "base*.css")); len(paths) > 0 {
		data["CSS"] = "/stage/build/desktop/" + filepath.Base(paths[0])
	}
	if status != 200 {
		data["Error"] = mcpOAuthLanguage("mcpOAuthError")
	}
	var b bytes.Buffer
	if err := mcpOAuthPage.Execute(&b, data); err != nil {
		return apicontract.SuccessHTTPContent(400, "text/html", []byte(""))
	}
	return apicontract.SuccessHTTPContent(status, "text/html; charset=utf-8", b.Bytes())
}

var mcpOAuthServerAuthorize = contractHandler(apicontract.MCPOAuthAuthorize, mcpOAuthServerAuthorizeContract)

func mcpOAuthServerAuthorizeContract(c *gin.Context, _ apicontract.EmptyRequest) apicontract.Response[apicontract.BinaryContent] {
	s, err := activeMCPOAuth(c)
	query, parseErr := url.ParseQuery(c.Request.URL.RawQuery)
	if err != nil || parseErr != nil || len(c.Request.URL.RawQuery) > 8192 || s.ValidateAuthorization(query) != nil {
		return mcpOAuthHTML(c, 400, "", apicontract.MCPOAuthClient{})
	}
	// 授权页允许跨站顶层导航；确认提交仍要求登录会话、同源表单及浏览器绑定。
	if !model.IsWorkspaceSessionAuthenticated(util.GetWorkspaceSession(util.GetSession(c))) {
		return apicontract.RedirectHTTPContent(302, "/check-auth?to="+url.QueryEscape(c.Request.URL.RequestURI()))
	}
	var b [32]byte
	_, _ = rand.Read(b[:])
	binding := base64.RawURLEncoding.EncodeToString(b[:])
	ticket, client, err := s.Begin(query, binding)
	if err != nil {
		return mcpOAuthHTML(c, 400, "", client)
	}
	http.SetCookie(c.Writer, &http.Cookie{Name: "__Host-siyuan-mcp", Value: binding, Path: "/", Secure: true, HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: 600})
	return mcpOAuthHTML(c, 200, ticket, client)
}

func mcpOAuthConsentGuard(c *gin.Context) *apicontract.Response[apicontract.BinaryContent] {
	if err := checkMCPOAuthForm(c); err != nil {
		ret := mcpOAuthHTML(c, 400, "", apicontract.MCPOAuthClient{})
		return &ret
	}
	return nil
}

var mcpOAuthConsent = contractHandler(apicontract.MCPOAuthConsent, mcpOAuthConsentContract, mcpOAuthConsentGuard)

func mcpOAuthConsentContract(c *gin.Context, req apicontract.MCPOAuthConsentRequest) apicontract.Response[apicontract.BinaryContent] {
	s, err := activeMCPOAuth(c)
	if err != nil || !model.IsWorkspaceSessionAuthenticated(util.GetWorkspaceSession(util.GetSession(c))) ||
		!util.IsSessionOriginAllowedRequest(c.Request) || c.GetHeader("Origin") != s.Status().PublicURL ||
		(req.Decision != "approve" && req.Decision != "deny") || util.ReadOnly {
		return mcpOAuthHTML(c, 400, "", apicontract.MCPOAuthClient{})
	}
	binding, _ := c.Cookie("__Host-siyuan-mcp")
	location, err := s.Consent(req.Ticket, binding, req.Decision == "approve")
	if err != nil {
		return mcpOAuthHTML(c, 400, "", apicontract.MCPOAuthClient{})
	}
	c.Header("Content-Type", "text/html; charset=utf-8")
	return apicontract.RedirectHTTPContent(302, location)
}
