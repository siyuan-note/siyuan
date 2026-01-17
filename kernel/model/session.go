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

package model

import (
	"image/color"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	ginSessions "github.com/gin-contrib/sessions"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/steambap/captcha"
)

var (
	BasicAuthHeaderKey   = "WWW-Authenticate"
	BasicAuthHeaderValue = "Basic realm=\"SiYuan Authorization Require\", charset=\"UTF-8\""
)

func LogoutAuth(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	if "" == Conf.AccessAuthCode {
		ret.Code = -1
		ret.Msg = Conf.Language(86)
		ret.Data = map[string]interface{}{"closeTimeout": 5000}
		return
	}

	session := util.GetSession(c)
	util.RemoveWorkspaceSession(session)
	if err := session.Save(c); err != nil {
		logging.LogErrorf("saves session failed: " + err.Error())
		ret.Code = -1
		ret.Msg = "save session failed"
	}
}

func LoginAuth(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var inputCaptcha string
	session := util.GetSession(c)
	workspaceSession := util.GetWorkspaceSession(session)
	if util.NeedCaptcha() {
		captchaArg := arg["captcha"]
		if nil == captchaArg {
			ret.Code = 1
			ret.Msg = Conf.Language(21)
			logging.LogWarnf("invalid captcha")
			return
		}
		inputCaptcha = captchaArg.(string)
		if "" == inputCaptcha {
			ret.Code = 1
			ret.Msg = Conf.Language(21)
			logging.LogWarnf("invalid captcha")
			return
		}

		if strings.ToLower(workspaceSession.Captcha) != strings.ToLower(inputCaptcha) {
			ret.Code = 1
			ret.Msg = Conf.Language(22)
			logging.LogWarnf("invalid captcha")

			workspaceSession.Captcha = gulu.Rand.String(7) // https://github.com/siyuan-note/siyuan/issues/13147
			if err := session.Save(c); err != nil {
				logging.LogErrorf("save session failed: " + err.Error())
				c.Status(http.StatusInternalServerError)
				return
			}
			return
		}
	}

	authCode := arg["authCode"].(string)
	authCode = strings.TrimSpace(authCode)
	authCode = util.RemoveInvalid(authCode)

	if Conf.AccessAuthCode != authCode {
		ret.Code = -1
		ret.Msg = Conf.Language(83)
		logging.LogWarnf("invalid auth code [ip=%s]", util.GetRemoteAddr(c.Request))

		util.WrongAuthCount++
		workspaceSession.Captcha = gulu.Rand.String(7)
		if util.NeedCaptcha() {
			ret.Code = 1 // 需要渲染验证码
		}

		if err := session.Save(c); err != nil {
			logging.LogErrorf("save session failed: " + err.Error())
			session.Clear(c)
			ret.Code = 1
			ret.Msg = Conf.Language(258)
			return
		}
		return
	}

	workspaceSession.AccessAuthCode = authCode
	util.WrongAuthCount = 0
	workspaceSession.Captcha = gulu.Rand.String(7)

	maxAge := 0 // Default session expiration (browser session)
	if rememberMe, ok := arg["rememberMe"].(bool); ok && rememberMe {
		// Add a 'Remember me' checkbox when logging in to save a session https://github.com/siyuan-note/siyuan/pull/14964
		maxAge = 60 * 60 * 24 * 30 // 30 days
	}
	ginSessions.Default(c).Options(ginSessions.Options{
		Path:     "/",
		Secure:   util.SSL,
		MaxAge:   maxAge,
		HttpOnly: true,
	})

	logging.LogInfof("auth success [ip=%s, maxAge=%d]", util.GetRemoteAddr(c.Request), maxAge)
	if err := session.Save(c); err != nil {
		logging.LogErrorf("save session failed: " + err.Error())
		c.Status(http.StatusInternalServerError)
		return
	}
}

func GetCaptcha(c *gin.Context) {
	img, err := captcha.New(100, 26, func(options *captcha.Options) {
		options.CharPreset = "ABCDEFGHKLMNPQRSTUVWXYZ23456789"
		options.Noise = 0.5
		options.CurveNumber = 0
		options.BackgroundColor = color.White
	})
	if err != nil {
		logging.LogErrorf("generates captcha failed: " + err.Error())
		c.Status(http.StatusInternalServerError)
		return
	}

	session := util.GetSession(c)
	workspaceSession := util.GetWorkspaceSession(session)
	workspaceSession.Captcha = img.Text
	if err = session.Save(c); err != nil {
		logging.LogErrorf("save session failed: " + err.Error())
		c.Status(http.StatusInternalServerError)
		return
	}

	if err = img.WriteImage(c.Writer); err != nil {
		logging.LogErrorf("writes captcha image failed: " + err.Error())
		c.Status(http.StatusInternalServerError)
		return
	}
	c.Status(http.StatusOK)
}

func CheckReadonly(c *gin.Context) {
	if util.ReadOnly || IsReadOnlyRole(GetGinContextRole(c)) {
		result := util.NewResult()
		result.Code = -1
		result.Msg = Conf.Language(34)
		result.Data = map[string]interface{}{"closeTimeout": 5000}
		c.JSON(http.StatusOK, result)
		c.Abort()
		return
	}
}

type authAction int

const (
	authActionContinue authAction = iota
	authActionGrant
	authActionPass
	authActionDeny
	authActionRedirect
	authActionHeaderStatus
)

type authResult struct {
	action      authAction
	role        Role
	status      int
	payload     map[string]interface{}
	redirectTo  string
	headerKey   string
	headerValue string
}

type authStep struct {
	name    string
	handler func(*authContext) authResult
}

type authContext struct {
	ginCtx          *gin.Context
	session         *util.SessionData
	workspace       *util.WorkspaceSession
	isLocalhostConn bool
	hasAccessCode   bool
	oidcEnabled     bool
	hasAnyAuth      bool
}

func newAuthContext(c *gin.Context) *authContext {
	session := util.GetSession(c)
	oidcEnabled := OIDCIsEnabled(Conf.OIDC)
	hasAccessCode := "" != Conf.AccessAuthCode
	return &authContext{
		ginCtx:          c,
		session:         session,
		workspace:       util.GetWorkspaceSession(session),
		isLocalhostConn: util.IsLocalHost(c.Request.RemoteAddr),
		hasAccessCode:   hasAccessCode,
		oidcEnabled:     oidcEnabled,
		hasAnyAuth:      hasAccessCode || oidcEnabled,
	}
}

// authContinue 继续下一个鉴权步骤
func authContinue() authResult {
	return authResult{action: authActionContinue}
}

// authPass 放行请求，但不修改角色。
// 也就是说保留当前已有的角色：如果前面 JWT 中间件写了管理员/访客，就保持那个；
// 如果没人写过，则是默认 RoleVisitor
func authPass() authResult {
	return authResult{action: authActionPass}
}

// authGrant 放行请求，并赋予指定角色
func authGrant(role Role) authResult {
	return authResult{action: authActionGrant, role: role}
}

// authUnauthorized 拒绝请求，返回 401 状态码和指定消息
func authUnauthorized(msg string) authResult {
	return authResult{
		action:  authActionDeny,
		status:  http.StatusUnauthorized,
		payload: map[string]any{"code": -1, "msg": msg},
	}
}

// authRedirect 重定向到指定路径
func authRedirect(to string) authResult {
	return authResult{action: authActionRedirect, redirectTo: to}
}

// authRedirectToCheckAuth 重定向到 /check-auth 并携带当前请求路径作为参数
func (ctx *authContext) authRedirectToCheckAuth() authResult {
	location := url.URL{}
	queryParams := url.Values{}
	queryParams.Set("to", ctx.ginCtx.Request.URL.String())
	location.RawQuery = queryParams.Encode()
	location.Path = "/check-auth"
	return authRedirect(location.String())
}

// authHeaderStatus 返回指定 header 和状态码
func authHeaderStatus(key, val string, status int) authResult {
	return authResult{action: authActionHeaderStatus, headerKey: key, headerValue: val, status: status}
}

// stepExistingRole 放行前面中间件已放行的请求，如已通过 JWT 的请求
func (ctx *authContext) stepExistingRole() authResult {
	if IsValidRole(GetGinContextRole(ctx.ginCtx), []Role{
		RoleAdministrator,
		RoleEditor,
		RoleReader,
	}) {
		return authPass()
	}
	return authContinue()
}

// stepSkipAuth 绕过所有认证步骤
func (ctx *authContext) stepSkipAuth() authResult {
	if Conf.AccessAuthBypass {
		return authGrant(RoleAdministrator)
	}
	return authContinue()
}

// stepAuthorizationHeaderToken 通过 API Token (header: Authorization) 认证
func (ctx *authContext) stepAuthorizationHeaderToken() authResult {
	authHeader := ctx.ginCtx.GetHeader("Authorization")
	if "" == authHeader {
		return authContinue()
	}

	token := ""
	switch {
	case strings.HasPrefix(authHeader, "Token "):
		token = strings.TrimPrefix(authHeader, "Token ")
	case strings.HasPrefix(authHeader, "token "):
		token = strings.TrimPrefix(authHeader, "token ")
	case strings.HasPrefix(authHeader, "Bearer "):
		token = strings.TrimPrefix(authHeader, "Bearer ")
	case strings.HasPrefix(authHeader, "bearer "):
		token = strings.TrimPrefix(authHeader, "bearer ")
	}

	if "" == token {
		return authContinue()
	}
	if Conf.Api.Token == token {
		return authGrant(RoleAdministrator)
	}
	return authUnauthorized("Auth failed [header: Authorization]")
}

// stepQueryToken 通过 API Token (query: token) 认证
func (ctx *authContext) stepQueryToken() authResult {
	token := ctx.ginCtx.Query("token")
	if "" == token {
		return authContinue()
	}
	if Conf.Api.Token == token {
		return authGrant(RoleAdministrator)
	}
	return authUnauthorized("Auth failed [query: token]")
}

// stepAuthPageWhitelist 放行鉴权相关页面（登录页/ OIDC 回调 Websocket连接）
func (ctx *authContext) stepAuthPageWhitelist() authResult {
	reqURI := ctx.ginCtx.Request.RequestURI

	switch {
	case "/check-auth" == reqURI:
		return authPass()
	case strings.HasPrefix(reqURI, "/auth/oidc/"):
		return authPass()
	// 用于授权页保持连接，避免非常驻内存内核自动退出 https://github.com/siyuan-note/insider/issues/1099
	case strings.Contains(reqURI, "/ws?app=siyuan&id=auth"):
		return authPass()
	}

	return authContinue()
}

// stepAuthLocalGuard 远程访问需开启至少一种认证
func (ctx *authContext) stepAuthLocalGuard() authResult {
	// Authenticate requests with the Origin header other than 127.0.0.1 https://github.com/siyuan-note/siyuan/issues/9180
	clientIP := ctx.ginCtx.ClientIP()
	host := ctx.ginCtx.GetHeader("Host")
	origin := ctx.ginCtx.GetHeader("Origin")
	forwardedHost := ctx.ginCtx.GetHeader("X-Forwarded-Host")

	remote := !ctx.isLocalhostConn ||
		("" != clientIP && !util.IsLocalHostname(clientIP)) ||
		("" != host && !util.IsLocalHost(host)) ||
		("" != origin && !util.IsLocalOrigin(origin) && !strings.HasPrefix(origin, "chrome-extension://")) ||
		("" != forwardedHost && !util.IsLocalHost(forwardedHost))

	if remote && !ctx.hasAnyAuth {
		return authUnauthorized("Auth failed: for security reasons, please set at least one authentication method when using non-127.0.0.1 access\n\n为安全起见，使用非 127.0.0.1 访问时请至少设置一种认证方式")
	}

	return authContinue()
}

// stepLocalhostNoAuth 本地请求且无认证配置时直接放行
func (ctx *authContext) stepLocalhostNoAuth() authResult {
	if ctx.isLocalhostConn && !ctx.hasAnyAuth {
		return authGrant(RoleAdministrator)
	}
	return authContinue()
}

// stepSessionAccessCode 通过会话中的访问授权码
func (ctx *authContext) stepSessionAccessCode() authResult {
	if ctx.workspace.AccessAuthCode == Conf.AccessAuthCode && "" != Conf.AccessAuthCode {
		return authGrant(RoleAdministrator)
	}
	return authContinue()
}

// stepOIDCSession 通过 OIDC 会话
func (ctx *authContext) stepOIDCSession() authResult {
	if OIDCIsValid(Conf.OIDC, ctx.workspace) {
		return authGrant(RoleAdministrator)
	}
	return authContinue()
}

// stepBasicAuth 使用 BasicAuth 校验访问授权码
func (ctx *authContext) stepBasicAuth() authResult {
	if username, password, ok := ctx.ginCtx.Request.BasicAuth(); ok {
		if util.WorkspaceName == username && Conf.AccessAuthCode == password {
			return authGrant(RoleAdministrator)
		}
	}
	return authContinue()
}

// stepLocalhostWhitelist 本机特定路径直接赋予管理员（满足后续权限校验）
func (ctx *authContext) stepLocalhostWhitelist() authResult {
	if !ctx.isLocalhostConn {
		return authContinue()
	}

	reqURI := ctx.ginCtx.Request.RequestURI
	switch {
	case strings.HasPrefix(reqURI, "/assets/") || strings.HasPrefix(reqURI, "/export/"):
		return authGrant(RoleAdministrator)
	case strings.HasPrefix(reqURI, "/api/system/exit"):
		return authGrant(RoleAdministrator)
	case strings.HasPrefix(reqURI, "/api/system/getNetwork") || strings.HasPrefix(reqURI, "/api/system/getWorkspaceInfo"):
		return authGrant(RoleAdministrator)
	case strings.HasPrefix(reqURI, "/api/sync/performSync"):
		if util.ContainerIOS == util.Container || util.ContainerAndroid == util.Container || util.ContainerHarmony == util.Container {
			return authGrant(RoleAdministrator)
		}
	}
	return authContinue()
}

// stepStaticWhitelist 放行静态资源
func (ctx *authContext) stepStaticWhitelist() authResult {
	reqURI := ctx.ginCtx.Request.RequestURI
	// 放过 /appearance/ 等（不要扩大到 /stage/ 否则鉴权会有问题）
	if strings.HasPrefix(reqURI, "/appearance/") ||
		strings.HasPrefix(reqURI, "/stage/build/export/") ||
		strings.HasPrefix(reqURI, "/stage/protyle/") {
		return authPass()
	}
	return authContinue()
}

// stepFailWebDAV 确保 WebDAV 返回 Basic 401
func (ctx *authContext) stepFailWebDAV() authResult {
	reqURI := ctx.ginCtx.Request.RequestURI
	if strings.HasPrefix(reqURI, "/webdav") ||
		strings.HasPrefix(reqURI, "/caldav") ||
		strings.HasPrefix(reqURI, "/carddav") {
		return authHeaderStatus(BasicAuthHeaderKey, BasicAuthHeaderValue, http.StatusUnauthorized)
	}
	return authContinue()
}

// stepFail 兜底处理：浏览器/客户端重定向，其余 401
func (ctx *authContext) stepFail() authResult {
	logging.LogWarnf("auth failed [ip=%s, path=%s]", util.GetRemoteAddr(ctx.ginCtx.Request), ctx.ginCtx.Request.URL.Path)
	userAgentHeader := ctx.ginCtx.GetHeader("User-Agent")
	if strings.HasPrefix(userAgentHeader, "SiYuan/") || strings.HasPrefix(userAgentHeader, "Mozilla/") {
		if http.MethodGet != ctx.ginCtx.Request.Method || ctx.ginCtx.IsWebsocket() {
			return authUnauthorized(Conf.Language(156))
		}
		return ctx.authRedirectToCheckAuth()
	}

	return authUnauthorized("Auth failed [session]")
}

func handleAuthResult(c *gin.Context, res authResult) bool {
	switch res.action {
	case authActionGrant:
		c.Set(RoleContextKey, res.role)
		c.Next()
		return true
	case authActionPass:
		c.Next()
		return true
	case authActionRedirect:
		target := res.redirectTo
		if "" == target {
			target = "/"
		}
		c.Redirect(http.StatusFound, target)
		c.Abort()
		return true
	case authActionDeny:
		status := res.status
		if 0 == status {
			status = http.StatusUnauthorized
		}
		if nil != res.payload {
			c.JSON(status, res.payload)
			c.Abort()
			return true
		}
		c.AbortWithStatus(status)
		return true
	case authActionHeaderStatus:
		if "" != res.headerKey {
			c.Header(res.headerKey, res.headerValue)
		}
		status := res.status
		if 0 == status {
			status = http.StatusUnauthorized
		}
		c.AbortWithStatus(status)
		return true
	default:
		return false
	}
}

// CheckAuth 鉴权逻辑
func CheckAuth(c *gin.Context) {
	ctx := newAuthContext(c)
	steps := []authStep{
		{name: "existing-role", handler: (*authContext).stepExistingRole},

		{name: "skip-auth", handler: (*authContext).stepSkipAuth},

		// API Token 认证
		{name: "authorization-header-token", handler: (*authContext).stepAuthorizationHeaderToken},
		{name: "query-token", handler: (*authContext).stepQueryToken},

		// 提前放行鉴权相关页面，避免被 auth local guard阻断
		{name: "auth-page-whitelist", handler: (*authContext).stepAuthPageWhitelist},

		{name: "auth-local-guard", handler: (*authContext).stepAuthLocalGuard},

		// stepLocalhostNoAuth 务必放在 stepAuthLocalGuard 之后，以防 非Local的远程请求无认证配置时 放行
		// 并且 localGuard 检查是否是 本地请求 的逻辑更严格
		{name: "localhost-no-auth", handler: (*authContext).stepLocalhostNoAuth},
		{name: "session-access-code", handler: (*authContext).stepSessionAccessCode},
		{name: "session-oidc", handler: (*authContext).stepOIDCSession},
		{name: "basic-auth", handler: (*authContext).stepBasicAuth},

		// 放行特定路径
		{name: "localhost-whitelist", handler: (*authContext).stepLocalhostWhitelist},
		{name: "static-whitelist", handler: (*authContext).stepStaticWhitelist},

		// 错误处理
		{name: "webdav-auth-fail", handler: (*authContext).stepFailWebDAV},
		{name: "fail", handler: (*authContext).stepFail},
	}

	for _, step := range steps {
		if handled := handleAuthResult(c, step.handler(ctx)); handled {
			return
		}
	}

	// 不应该到达这里
	logging.LogErrorf("auth logic error")
	c.AbortWithStatus(http.StatusUnauthorized)
}

func handleAuthResultWebsocket(res authResult, pass *bool) bool {
	switch res.action {
	case authActionGrant:
		*pass = true
		return true
	case authActionPass:
		*pass = true
		return true
	case authActionRedirect:
		panic("websocket auth cannot redirect")
	case authActionDeny:
		*pass = false
		return true
	case authActionHeaderStatus:
		panic("websocket auth cannot return header status")
	default:
		return false
	}
}

// CheckWebsocketAuth WebSocket 鉴权逻辑
func CheckWebsocketAuth(c *gin.Context) (pass bool) {
	ctx := newAuthContext(c)
	steps := []authStep{
		{name: "existing-role", handler: (*authContext).stepExistingRole},

		//{name: "skip-auth", handler: (*authContext).stepSkipAuth},

		// 提前放行鉴权相关页面，避免被 auth local guard阻断
		{name: "auth-page-whitelist", handler: (*authContext).stepAuthPageWhitelist},

		{name: "auth-local-guard", handler: (*authContext).stepAuthLocalGuard},

		// stepLocalhostNoAuth 务必放在 stepAuthLocalGuard 之后，以防 非Local的远程请求无认证配置时 放行
		// 并且 localGuard 检查是否是 本地请求 的逻辑更严格
		{name: "localhost-no-auth", handler: (*authContext).stepLocalhostNoAuth},
		{name: "session-access-code", handler: (*authContext).stepSessionAccessCode},
		{name: "session-oidc", handler: (*authContext).stepOIDCSession},
	}

	for _, step := range steps {
		if handled := handleAuthResultWebsocket(step.handler(ctx), &pass); handled {
			return
		}
	}

	logging.LogWarnf("closed an unauthenticated session [%s]", util.GetRemoteAddr(c.Request))
	return false
}

func CheckAdminRole(c *gin.Context) {
	if IsAdminRoleContext(c) {
		c.Next()
	} else {
		c.AbortWithStatus(http.StatusForbidden)
	}
}

func CheckEditRole(c *gin.Context) {
	if IsValidRole(GetGinContextRole(c), []Role{
		RoleAdministrator,
		RoleEditor,
	}) {
		c.Next()
	} else {
		c.AbortWithStatus(http.StatusForbidden)
	}
}

func CheckReadRole(c *gin.Context) {
	if IsValidRole(GetGinContextRole(c), []Role{
		RoleAdministrator,
		RoleEditor,
		RoleReader,
	}) {
		c.Next()
	} else {
		c.AbortWithStatus(http.StatusForbidden)
	}
}

var timingAPIs = map[string]int{
	"/api/search/fullTextSearchBlock": 200, // Monitor the search performance and suggest solutions https://github.com/siyuan-note/siyuan/issues/7873
}

func Timing(c *gin.Context) {
	p := c.Request.URL.Path
	tip, ok := timingAPIs[p]
	if !ok {
		c.Next()
		return
	}

	timing := 15 * 1000
	if timingEnv := os.Getenv("SIYUAN_PERFORMANCE_TIMING"); "" != timingEnv {
		val, err := strconv.Atoi(timingEnv)
		if err == nil {
			timing = val
		}
	}

	now := time.Now().UnixMilli()
	c.Next()
	elapsed := int(time.Now().UnixMilli() - now)
	if timing < elapsed {
		logging.LogWarnf("[%s] elapsed [%dms]", c.Request.RequestURI, elapsed)
		util.PushMsg(Conf.Language(tip), 7000)
	}
}

func Recover(c *gin.Context) {
	defer logging.Recover()
	c.Next()
}

var (
	requestingLock = sync.Mutex{}
	requesting     = map[string]*sync.Mutex{}
)

func ControlConcurrency(c *gin.Context) {
	if websocket.IsWebSocketUpgrade(c.Request) {
		c.Next()
		return
	}

	reqPath := c.Request.URL.Path

	// Improve the concurrency of the kernel data reading interfaces https://github.com/siyuan-note/siyuan/issues/10149
	if strings.HasPrefix(reqPath, "/stage/") ||
		strings.HasPrefix(reqPath, "/assets/") ||
		strings.HasPrefix(reqPath, "/emojis/") ||
		strings.HasPrefix(reqPath, "/plugins/") ||
		strings.HasPrefix(reqPath, "/public/") ||
		strings.HasPrefix(reqPath, "/snippets/") ||
		strings.HasPrefix(reqPath, "/templates/") ||
		strings.HasPrefix(reqPath, "/widgets/") ||
		strings.HasPrefix(reqPath, "/appearance/") ||
		strings.HasPrefix(reqPath, "/export/") ||
		strings.HasPrefix(reqPath, "/history/") ||
		strings.HasPrefix(reqPath, "/api/query/") ||
		strings.HasPrefix(reqPath, "/api/search/") ||
		strings.HasPrefix(reqPath, "/api/network/") ||
		strings.HasPrefix(reqPath, "/api/broadcast/") ||
		strings.HasPrefix(reqPath, "/es/") {
		c.Next()
		return
	}

	parts := strings.Split(reqPath, "/")
	function := parts[len(parts)-1]
	if strings.HasPrefix(function, "get") ||
		strings.HasPrefix(function, "list") ||
		strings.HasPrefix(function, "search") ||
		strings.HasPrefix(function, "render") ||
		strings.HasPrefix(function, "ls") {
		c.Next()
		return
	}

	requestingLock.Lock()
	mutex := requesting[reqPath]
	if nil == mutex {
		mutex = &sync.Mutex{}
		requesting[reqPath] = mutex
	}
	requestingLock.Unlock()

	mutex.Lock()
	defer mutex.Unlock()
	c.Next()
}
