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

package server

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"html/template"
	"mime"
	"net"
	"net/http"
	"net/http/pprof"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/emersion/go-webdav/caldav"
	"github.com/emersion/go-webdav/carddav"
	"github.com/gin-contrib/gzip"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/mssola/useragent"
	"github.com/olahol/melody"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/api"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cmd"
	"github.com/siyuan-note/siyuan/kernel/mcp"
	mcpclient "github.com/siyuan-note/siyuan/kernel/mcp/client"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/server/proxy"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/soheilhy/cmux"

	"golang.org/x/net/webdav"
)

const (
	MethodMkCol     = "MKCOL"
	MethodCopy      = "COPY"
	MethodMove      = "MOVE"
	MethodLock      = "LOCK"
	MethodUnlock    = "UNLOCK"
	MethodPropFind  = "PROPFIND"
	MethodPropPatch = "PROPPATCH"
	MethodReport    = "REPORT"
)

var (
	sessionStore cookie.Store

	HttpMethods = []string{
		http.MethodGet,
		http.MethodHead,
		http.MethodPost,
		http.MethodPut,
		http.MethodPatch,
		http.MethodDelete,
		http.MethodConnect,
		http.MethodOptions,
		http.MethodTrace,
	}
	WebDavMethods = []string{
		http.MethodOptions,
		http.MethodHead,
		http.MethodGet,
		http.MethodPost,
		http.MethodPut,
		http.MethodDelete,

		MethodMkCol,
		MethodCopy,
		MethodMove,
		MethodLock,
		MethodUnlock,
		MethodPropFind,
		MethodPropPatch,
	}
	CalDavMethods = []string{
		http.MethodOptions,
		http.MethodHead,
		http.MethodGet,
		http.MethodPost,
		http.MethodPut,
		http.MethodDelete,

		MethodMkCol,
		MethodCopy,
		MethodMove,
		// MethodLock,
		// MethodUnlock,
		MethodPropFind,
		MethodPropPatch,

		MethodReport,
	}
	CardDavMethods = []string{
		http.MethodOptions,
		http.MethodHead,
		http.MethodGet,
		http.MethodPost,
		http.MethodPut,
		http.MethodDelete,

		MethodMkCol,
		MethodCopy,
		MethodMove,
		// MethodLock,
		// MethodUnlock,
		MethodPropFind,
		MethodPropPatch,

		MethodReport,
	}
)

func Serve(fastMode bool, cookieKey string) {
	gin.SetMode(gin.ReleaseMode)
	ginServer := gin.New()
	ginServer.MaxMultipartMemory = 1024 * 1024 * 32 // 插入较大的资源文件时内存占用较大 https://github.com/siyuan-note/siyuan/issues/5023
	ginServer.Use(
		model.ControlConcurrency, // 请求串行化 Concurrency control when requesting the kernel API https://github.com/siyuan-note/siyuan/issues/9939
		model.Timing,
		model.Recover,
		model.Activity,   // 记录用户活动时间，用于 AutoFixIndex 的空闲判断
		corsMiddleware(), // 后端服务支持 CORS 预检请求验证 https://github.com/siyuan-note/siyuan/pull/5593
		jwtMiddleware,    // 解析 JWT https://github.com/siyuan-note/siyuan/issues/11364
		gzip.Gzip(gzip.DefaultCompression, gzip.WithExcludedExtensions([]string{".pdf", ".mp3", ".wav", ".ogg", ".mov", ".weba", ".mkv", ".mp4", ".webm", ".flac"})),
	)

	sessionStore = cookie.NewStore([]byte(cookieKey))
	sessionStore.Options(sessions.Options{
		Path:   "/",
		Secure: util.SSL,
		//MaxAge:   60 * 60 * 24 * 7, // 默认是 Session
		HttpOnly: true,
	})
	ginServer.Use(sessions.Sessions("siyuan", sessionStore))

	serveDebug(ginServer)
	serveAssets(ginServer)
	serveAppearance(ginServer)
	serveWebSocket(ginServer)
	serveMCP(ginServer)
	serveWebDAV(ginServer)
	serveCalDAV(ginServer)
	serveCardDAV(ginServer)
	serveExport(ginServer)
	serveWidgets(ginServer)
	servePlugins(ginServer)
	serveEmojis(ginServer)
	serveTemplates(ginServer)
	servePublic(ginServer)
	serveSnippets(ginServer)
	serveRepoDiff(ginServer)
	serveCheckAuth(ginServer)
	serveFixedStaticFiles(ginServer)
	api.ServeAPI(ginServer)

	var host string
	if model.Conf.System.NetworkServe || util.ContainerDocker == util.Container {
		host = "0.0.0.0"
	} else {
		host = "127.0.0.1"
	}

	ln, err := net.Listen("tcp", host+":"+util.ServerPort)
	if err != nil {
		if !fastMode {
			logging.LogErrorf("boot kernel failed: %s", err)
			os.Exit(logging.ExitCodeUnavailablePort)
		}

		// fast 模式下启动失败则直接返回
		return
	}

	_, port, err := net.SplitHostPort(ln.Addr().String())
	if err != nil {
		if !fastMode {
			logging.LogErrorf("boot kernel failed: %s", err)
			os.Exit(logging.ExitCodeUnavailablePort)
		}
	}
	util.ServerPort = port

	model.Conf.ServerAddrs = util.GetServerAddrs()
	model.Conf.Save()

	// Generate TLS certificates for local HTTPS + HTTP/2 support
	certPath, keyPath, certErr := util.GetOrCreateTLSCert()
	if certErr != nil {
		logging.LogWarnf("failed to get TLS certificates, local HTTPS/HTTP2 unavailable: %s", certErr)
		certPath = ""
	}

	if "" != certPath {
		util.ServerURL, err = url.Parse("https://127.0.0.1:" + port)
	} else {
		util.ServerURL, err = url.Parse("http://127.0.0.1:" + port)
	}
	if err != nil {
		logging.LogErrorf("parse server url failed: %s", err)
	}

	pid := fmt.Sprintf("%d", os.Getpid())
	if !fastMode {
		rewritePortJSON(pid, port)
	}

	useTLS := model.Conf.System.NetworkServeTLS && model.Conf.System.NetworkServe
	if useTLS {
		logging.LogInfof("kernel [pid=%s] http server [%s] is booting (TLS will be enabled on fixed port proxy)", pid, host+":"+port)
	} else if "" != certPath {
		logging.LogInfof("kernel [pid=%s] http server [%s] is booting (local HTTPS + HTTP/2 enabled)", pid, host+":"+port)
	} else {
		logging.LogInfof("kernel [pid=%s] http server [%s] is booting", pid, host+":"+port)
	}
	util.HttpServing = true

	go util.HookUILoaded()

	// 启动后自动连接已配置的 MCP server，让用户首次使用 AI Agent 时工具已就绪。
	// EnsureMCPConnected 是异步的，不阻塞 HTTP 监听；内置 mcpConnecting 标志防止重复连接。
	if model.Conf.AI != nil && model.Conf.AI.MCP != nil {
		go mcpclient.EnsureMCPConnected(model.Conf.AI.MCP.Servers)
	}

	go func() {
		time.Sleep(1 * time.Second)
		go proxy.InitFixedPortService(host, certPath, keyPath)
		go proxy.InitPublishService()
		// 反代服务器启动失败不影响核心服务器启动
	}()

	httpHandler := ginServer.Handler()
	util.HttpServer = &http.Server{
		Handler: httpHandler,
	}

	if "" != certPath {
		if _, _, err = util.ServeMultiplexed(ln, httpHandler, certPath, keyPath, util.HttpServer, nil); err != nil {
			// 退出时 model.Close() 调 util.HttpServer.Close() 会通过 cmux 派生 listener 关掉 root，
			// m.Serve() 随后返回 *net.OpError("use of closed network connection")；
			// net.ErrClosed 即该错误的哨兵，须一并视为正常退出，否则会被误判为致命错误并 os.Exit(21)
			if errors.Is(err, http.ErrServerClosed) || errors.Is(err, cmux.ErrListenerClosed) || errors.Is(err, net.ErrClosed) {
				return
			}

			if !fastMode {
				logging.LogErrorf("boot kernel failed: %s", err)
				os.Exit(logging.ExitCodeUnavailablePort)
			}
		}
		return
	}

	if err = util.HttpServer.Serve(ln); err != nil {
		if errors.Is(err, http.ErrServerClosed) || errors.Is(err, net.ErrClosed) {
			return
		}

		if !fastMode {
			logging.LogErrorf("boot kernel failed: %s", err)
			os.Exit(logging.ExitCodeUnavailablePort)
		}
	}
}

func rewritePortJSON(pid, port string) {
	portJSON := filepath.Join(util.HomeDir, ".config", "siyuan", "port.json")
	pidPorts := map[string]string{}
	var data []byte
	var err error

	if gulu.File.IsExist(portJSON) {
		data, err = os.ReadFile(portJSON)
		if err != nil {
			logging.LogWarnf("read port.json failed: %s", err)
		} else {
			if err = gulu.JSON.UnmarshalJSON(data, &pidPorts); err != nil {
				logging.LogWarnf("unmarshal port.json failed: %s", err)
			}
		}
	}

	pidPorts[pid] = port
	if data, err = gulu.JSON.MarshalIndentJSON(pidPorts, "", "  "); err != nil {
		logging.LogWarnf("marshal port.json failed: %s", err)
	} else {
		if err = os.WriteFile(portJSON, data, 0644); err != nil {
			logging.LogWarnf("write port.json failed: %s", err)
		}
	}
}

func serveExport(ginServer *gin.Engine) {
	// Potential data export disclosure security vulnerability https://github.com/siyuan-note/siyuan/issues/12213
	exportGroup := ginServer.Group("/export/", model.CheckAuth)
	exportBaseDir := filepath.Join(util.TempDir, "export")

	exportGroup.GET("/*filepath", func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/export/temp/") {
			tempBaseDir := filepath.Join(util.TempDir, "export", "temp")
			relativePath := strings.TrimPrefix(c.Request.URL.Path, "/export/temp/")
			relativePath = filepath.Clean(relativePath)
			if strings.Contains(relativePath, "..") {
				c.Status(http.StatusUnauthorized)
				return
			}
			fullPath := filepath.Join(tempBaseDir, relativePath)
			if !gulu.File.IsSubPath(tempBaseDir, fullPath) {
				c.Status(http.StatusUnauthorized)
				return
			}

			if util.IsSensitivePath(fullPath) {
				logging.LogErrorf("refuse to export sensitive file [%s]", c.Request.URL.Path)
				c.Status(http.StatusForbidden)
				return
			}

			c.File(fullPath)
			return
		}

		filePath := strings.TrimPrefix(c.Request.URL.Path, "/export/")

		decodedPath, err := url.PathUnescape(filePath)
		if err != nil {
			decodedPath = filePath
		}

		fullPath := filepath.Join(exportBaseDir, decodedPath)
		if !gulu.File.IsSubPath(exportBaseDir, fullPath) {
			c.Status(http.StatusUnauthorized)
			return
		}

		// 加密导出受控路径（<boxID>/<kind>/<file>）：按注册表无条件校验，不依赖 IsEncryptedBox。
		// 笔记本删除后 IsEncryptedBox 返回 false，若以它为门控会 fail-open 暴露明文产物。
		if model.IsManagedEncryptedExportPath(decodedPath) {
			boxID, artifact, ok := model.ResolveManagedEncryptedExport(decodedPath)
			if !ok {
				c.Status(http.StatusNotFound)
				return
			}
			fullPath = artifact
			if !gulu.File.IsSubPath(exportBaseDir, fullPath) {
				c.Status(http.StatusForbidden)
				return
			}
			model.HoldBoxReadLock(boxID)
			defer model.ReleaseBoxReadLock(boxID)
			if _, dekErr := model.GetDEKIfUnlocked(boxID); dekErr != nil {
				c.Status(http.StatusForbidden)
				return
			}
		}

		if util.IsSensitivePath(fullPath) {
			logging.LogErrorf("refuse to export sensitive file [%s]", c.Request.URL.Path)
			c.Status(http.StatusForbidden)
			return
		}

		fileInfo, err := os.Stat(fullPath)
		if os.IsNotExist(err) {
			c.Status(http.StatusNotFound)
			return
		}
		if err != nil {
			c.Status(http.StatusInternalServerError)
			return
		}

		if fileInfo.IsDir() {
			c.Status(http.StatusNotFound)
			return
		}

		c.Header("Content-Disposition", formatContentDispositionAttachment(filepath.Base(decodedPath)))
		c.File(fullPath)
	})
}

func serveWidgets(ginServer *gin.Engine) {
	widgets := ginServer.Group("/widgets/", model.CheckAuth)
	widgets.Static("", filepath.Join(util.DataDir, "widgets"))
}

func servePlugins(ginServer *gin.Engine) {
	plugins := ginServer.Group("/plugins/", model.CheckAuth)
	plugins.Static("", filepath.Join(util.DataDir, "plugins"))
}

func serveEmojis(ginServer *gin.Engine) {
	emojis := ginServer.Group("/emojis/", model.CheckAuth)
	emojis.Static("", filepath.Join(util.DataDir, "emojis"))
}

func serveTemplates(ginServer *gin.Engine) {
	templates := ginServer.Group("/templates/", model.CheckAuth)
	templates.Static("", filepath.Join(util.DataDir, "templates"))
}

func servePublic(ginServer *gin.Engine) {
	// Support directly access `data/public/*` contents via URL link https://github.com/siyuan-note/siyuan/issues/8593
	ginServer.Static("/public/", filepath.Join(util.DataDir, "public"))
}

func serveSnippets(ginServer *gin.Engine) {
	ginServer.Handle("GET", "/snippets/*filepath", model.CheckAuth, func(c *gin.Context) {
		filePath := strings.TrimPrefix(c.Request.URL.Path, "/snippets/")
		if !model.IsAdminRoleContext(c) {
			if "conf.json" == filePath {
				c.Status(http.StatusUnauthorized)
				return
			}
		}

		ext := filepath.Ext(filePath)
		name := strings.TrimSuffix(filePath, ext)
		confSnippets, err := model.LoadSnippets()
		if err != nil {
			logging.LogErrorf("load snippets failed: %s", err)
			c.Status(http.StatusNotFound)
			return
		}

		for _, s := range confSnippets {
			if s.Name == name && ("" != ext && s.Type == ext[1:]) {
				c.Header("Content-Type", mime.TypeByExtension(ext))
				c.String(http.StatusOK, s.Content)
				return
			}
		}

		// 没有在配置文件中命中时在文件系统上查找
		filePath = filepath.Join(util.SnippetsPath, filePath)

		// 限制只能访问 snippets 目录内的文件，并拦截敏感路径，避免通过路径穿越读取工作空间内的敏感文件
		if !gulu.File.IsSubPath(util.SnippetsPath, filePath) {
			c.Status(http.StatusUnauthorized)
			return
		}
		if util.IsSensitivePath(filePath) {
			logging.LogErrorf("refuse to serve sensitive snippet file [%s]", c.Request.URL.Path)
			c.Status(http.StatusForbidden)
			return
		}

		c.File(filePath)
	})
}

func serveAppearance(ginServer *gin.Engine) {
	siyuan := ginServer.Group("", model.CheckAuth)

	siyuan.Handle("GET", "/", func(c *gin.Context) {
		userAgentHeader := c.GetHeader("User-Agent")
		logging.LogInfof("serving [/] for user-agent [%s]", userAgentHeader)

		// Carry query parameters when redirecting
		location := url.URL{}
		queryParams := c.Request.URL.Query()
		queryParams.Set("r", gulu.Rand.String(7))
		location.RawQuery = queryParams.Encode()

		siyuanDesktopMode, desktopCookieErr := c.Request.Cookie("siyuan-desktop-mode")
		if nil == desktopCookieErr {
			if "true" == siyuanDesktopMode.Value {
				if strings.Contains(userAgentHeader, "Electron") {
					location.Path = "/stage/build/app/"
				} else {
					location.Path = "/stage/build/desktop/"
				}
				c.Redirect(302, location.String())
				return
			} else if "false" == siyuanDesktopMode.Value {
				location.Path = "/stage/build/mobile/"
				c.Redirect(302, location.String())
				return
			}
		}

		if strings.Contains(userAgentHeader, "Electron") {
			location.Path = "/stage/build/app/"
		} else if strings.Contains(userAgentHeader, "Pad") ||
			(strings.ContainsAny(userAgentHeader, "Android") && !strings.Contains(userAgentHeader, "Mobile")) {
			// Improve detecting Pad device, treat it as desktop device https://github.com/siyuan-note/siyuan/issues/8435 https://github.com/siyuan-note/siyuan/issues/8497
			location.Path = "/stage/build/desktop/"
		} else {
			if idx := strings.Index(userAgentHeader, "Mozilla/"); 0 < idx {
				userAgentHeader = userAgentHeader[idx:]
			}
			ua := useragent.New(userAgentHeader)
			if ua.Mobile() {
				location.Path = "/stage/build/mobile/"
			} else {
				location.Path = "/stage/build/desktop/"
			}
		}

		c.Redirect(302, location.String())
	})

	appearancePath := util.AppearancePath
	if "dev" == util.Mode {
		appearancePath = filepath.Join(util.WorkingDir, "appearance")
	}
	siyuan.GET("/appearance/*filepath", func(c *gin.Context) {
		filePath := filepath.Join(appearancePath, strings.TrimPrefix(c.Request.URL.Path, "/appearance/"))
		if !gulu.File.IsSubPath(appearancePath, filePath) {
			c.Status(http.StatusUnauthorized)
			return
		}

		if strings.HasSuffix(c.Request.URL.Path, "/theme.js") {
			if !gulu.File.IsExist(filePath) {
				// 主题 js 不存在时生成空内容返回
				c.Data(200, "application/x-javascript", nil)
				return
			}
		} else if strings.Contains(c.Request.URL.Path, "/langs/") && strings.HasSuffix(c.Request.URL.Path, ".json") {
			lang := path.Base(c.Request.URL.Path)
			lang = strings.TrimSuffix(lang, ".json")
			if "zh-CN" != lang && "en" != lang {
				// 多语言配置缺失项使用对应英文配置项补齐 https://github.com/siyuan-note/siyuan/issues/5322

				enUSFilePath := filepath.Join(appearancePath, "langs", "en.json")
				enUSData, err := os.ReadFile(enUSFilePath)
				if err != nil {
					logging.LogErrorf("read en_US.json [%s] failed: %s", enUSFilePath, err)
					util.ReportFileSysFatalError(err)
					return
				}
				enUSData = bytes.TrimPrefix(enUSData, []byte("\xef\xbb\xbf"))
				enUSMap := map[string]any{}
				if err = gulu.JSON.UnmarshalJSON(enUSData, &enUSMap); err != nil {
					logging.LogErrorf("unmarshal en_US.json [%s] failed: %s", enUSFilePath, err)
					util.ReportFileSysFatalError(err)
					return
				}

				for {
					data, err := os.ReadFile(filePath)
					if err != nil {
						c.JSON(200, enUSMap)
						return
					}
					data = bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))

					langMap := map[string]any{}
					if err = gulu.JSON.UnmarshalJSON(data, &langMap); err != nil {
						logging.LogErrorf("unmarshal json [%s] failed: %s", filePath, err)
						c.JSON(200, enUSMap)
						return
					}

					for enUSDataKey, enUSDataValue := range enUSMap {
						if _, ok := langMap[enUSDataKey]; !ok {
							langMap[enUSDataKey] = enUSDataValue
						}
					}
					c.JSON(200, langMap)
					return
				}
			}
		}

		c.File(filePath)
	})

	siyuan.Static("/stage", filepath.Join(util.WorkingDir, "stage"))
}

func serveCheckAuth(ginServer *gin.Engine) {
	ginServer.GET("/check-auth", serveAuthPage)
}

func serveAuthPage(c *gin.Context) {
	data, err := os.ReadFile(filepath.Join(util.WorkingDir, "stage/auth.html"))
	if err != nil {
		logging.LogErrorf("load auth page failed: %s", err)
		c.Status(500)
		return
	}

	tpl, err := template.New("auth").Parse(string(data))
	if err != nil {
		logging.LogErrorf("parse auth page failed: %s", err)
		c.Status(500)
		return
	}

	keymapHideWindow := "⌥M"
	if nil != (*model.Conf.Keymap)["general"] {
		switch (*model.Conf.Keymap)["general"].(type) {
		case map[string]any:
			keymapGeneral := (*model.Conf.Keymap)["general"].(map[string]any)
			if nil != keymapGeneral["toggleWin"] {
				switch keymapGeneral["toggleWin"].(type) {
				case map[string]any:
					toggleWin := keymapGeneral["toggleWin"].(map[string]any)
					if nil != toggleWin["custom"] {
						keymapHideWindow = toggleWin["custom"].(string)
					}
				}
			}
		}
		if "" == keymapHideWindow {
			keymapHideWindow = "⌥M"
		}
	}
	model := map[string]any{
		"l0":                     model.Conf.Language(173),
		"l1":                     model.Conf.Language(174),
		"l2":                     template.HTML(model.Conf.Language(172)),
		"l3":                     model.Conf.Language(175),
		"l4":                     model.Conf.Language(176),
		"l5":                     model.Conf.Language(177),
		"l6":                     model.Conf.Language(178),
		"l7":                     template.HTML(model.Conf.Language(184)),
		"l8":                     model.Conf.Language(95),
		"l9":                     model.Conf.Language(83),
		"l10":                    model.Conf.Language(257),
		"l11":                    model.Conf.Language(282),
		"appearanceMode":         model.Conf.Appearance.Mode,
		"appearanceModeOS":       model.Conf.Appearance.ModeOS,
		"workspace":              util.WorkspaceName,
		"keymapGeneralToggleWin": keymapHideWindow,
		"trayMenuLangs":          util.TrayMenuLangs[util.Lang],
		// 浏览器环境下不返回工作空间绝对路径，避免泄露用户名等敏感信息
		// 原生客户端（桌面 Electron，授权页 siyuan-init IPC 仅在 Electron 内执行）照常返回真实路径
		// REF: https://github.com/siyuan-note/siyuan/issues/17410
		"workspaceDir": util.WorkspaceDir,
	}
	if util.IsBrowserRequest(c) {
		model["workspaceDir"] = ""
	}
	buf := &bytes.Buffer{}
	if err = tpl.Execute(buf, model); err != nil {
		logging.LogErrorf("execute auth page failed: %s", err)
		c.Status(500)
		return
	}
	data = buf.Bytes()
	c.Data(http.StatusOK, "text/html; charset=utf-8", data)
}

// formatContentDispositionAttachment 使用 mime.FormatMediaType 编码文件名，避免异常字符破坏响应头
func formatContentDispositionAttachment(filename string) string {
	if cd := mime.FormatMediaType("attachment", map[string]string{"filename": filename}); cd != "" {
		return cd
	}
	return "attachment"
}

// 资源 GET 带 download=true 时以附件返回，便于浏览器 window.open 触发下载而非内联预览
func setAssetsAttachmentDisposition(c *gin.Context, pathForBaseName string) {
	if !strings.EqualFold(c.Query("download"), "true") {
		return
	}
	c.Header("Content-Disposition", formatContentDispositionAttachment(filepath.Base(pathForBaseName)))
}

func serveAssets(ginServer *gin.Engine) {
	ginServer.POST("/upload", model.CheckAuth, model.CheckAdminRole, model.CheckReadonly, model.Upload)

	ginServer.GET("/assets/*path", model.CheckAuth, func(context *gin.Context) {
		requestPath := context.Param("path")
		if "/" == requestPath || "" == requestPath {
			// 禁止访问根目录 Disable HTTP access to the /assets/ path https://github.com/siyuan-note/siyuan/issues/15257
			context.Status(http.StatusForbidden)
			return
		}

		// 硬边界：拒绝路径遍历
		if strings.Contains(requestPath, "..") {
			context.Status(http.StatusForbidden)
			return
		}

		relativePath := path.Join("assets", requestPath)
		cleanPath := path.Clean(relativePath)
		if !strings.HasPrefix(cleanPath, "assets/") {
			context.Status(http.StatusForbidden)
			return
		}

		// 解析 box 查询参数，加密 box 资源按 box 内精确查找（不全局搜索）
		boxID := context.Query("box")
		var p string
		var err error
		if boxID != "" {
			p, err = model.GetAssetAbsPathInBox(cleanPath, boxID)
		} else {
			p, err = model.GetAssetAbsPath(cleanPath)
		}
		if err != nil || p == "" {
			context.Status(http.StatusNotFound)
			return
		}

		// 验证最终绝对路径必须在 data/assets 或 <boxID>/assets 下
		boxIDFromPath := model.ExtractBoxIDFromAssetsPath(p)
		assetsRoot := filepath.Join(util.DataDir, "assets")
		if boxIDFromPath != "" {
			assetsRoot = filepath.Join(util.DataDir, boxIDFromPath, "assets")
		}
		if boxID != "" && boxID != boxIDFromPath {
			context.Status(http.StatusForbidden)
			return
		}
		if boxID == "" && model.IsEncryptedAssetPath(p) {
			context.Status(http.StatusForbidden)
			return
		}
		if !gulu.File.IsSubPath(assetsRoot, p) {
			context.Status(http.StatusForbidden)
			return
		}

		if !model.IsAdminRoleContext(context) {
			publishAccess := model.GetPublishAccess()
			if !model.CheckAbsPathAccessableByPublishAccess(context, p, publishAccess) {
				context.Status(http.StatusForbidden)
				return
			}
		}

		if util.IsSensitivePath(p) {
			logging.LogErrorf("refuse to serve sensitive file [%s]", context.Request.URL.Path)
			context.Status(http.StatusForbidden)
			return
		}

		if serveThumbnail(context, p, requestPath) || serveSVG(context, p) {
			return
		}

		// 加密笔记本的 assets 是密文，需先解密再输出
		if serveEncryptedAsset(context, p) {
			return
		}

		// 返回原始文件
		setAssetsAttachmentDisposition(context, p)
		http.ServeFile(context.Writer, context.Request, p)
	})

	ginServer.GET("/history/*path", model.CheckAuth, model.CheckAdminRole, func(context *gin.Context) {
		p := filepath.Join(util.HistoryDir, context.Param("path"))
		// 加密笔记本的历史是密文（.sy/assets/AV），需先解密再输出
		if serveEncryptedHistory(context, p) {
			return
		}
		http.ServeFile(context.Writer, context.Request, p)
	})
}

func serveSVG(context *gin.Context, assetAbsPath string) bool {
	if strings.HasSuffix(assetAbsPath, ".svg") {
		data, err := readAssetBytes(assetAbsPath)
		if err != nil {
			logging.LogErrorf("read svg file failed: %s", err)
			return false
		}

		if !model.Conf.Editor.AllowSVGScript {
			sanitized, sanitizeErr := util.SanitizeSVG(string(data))
			if sanitizeErr != nil {
				logging.LogWarnf("sanitize svg file failed [%s]: %s", assetAbsPath, sanitizeErr)
				context.Status(http.StatusUnprocessableEntity)
				return true
			}
			data = []byte(sanitized)
			context.Header("Content-Security-Policy", "script-src 'none'; object-src 'none'; base-uri 'none'")
		}

		context.Header("X-Content-Type-Options", "nosniff")
		setAssetsAttachmentDisposition(context, assetAbsPath)
		context.Data(200, "image/svg+xml", data)
		return true
	}
	return false
}

// readAssetBytes 读取 asset 文件字节。加密笔记本的 asset 是密文，自动解密后返回明文。
func readAssetBytes(absPath string) ([]byte, error) {
	data, err := os.ReadFile(absPath)
	if err != nil {
		return nil, err
	}
	if boxID := model.ExtractBoxIDFromAssetsPath(absPath); boxID != "" && model.IsEncryptedBox(boxID) {
		model.HoldBoxReadLock(boxID)
		dek, dekErr := model.GetDEKIfUnlocked(boxID)
		if dekErr != nil {
			model.ReleaseBoxReadLock(boxID)
			return nil, dekErr
		}
		defer model.ReleaseBoxReadLock(boxID)
		diskName := filepath.Base(absPath)
		plain, decErr := model.DecryptAsset(boxID, diskName, dek, data)
		if decErr != nil {
			return nil, decErr
		}
		return plain, nil
	}
	return data, nil
}

// serveEncryptedAsset 处理加密笔记本 asset 的 HTTP 输出。
// 若 absPath 在已解锁的加密笔记本下，读密文→解密→按扩展名设置 Content-Type→输出，返回 true；
// 否则返回 false，由调用方走原 http.ServeFile 路径。
func serveEncryptedAsset(context *gin.Context, absPath string) bool {
	boxID := model.ExtractBoxIDFromAssetsPath(absPath)
	if boxID == "" || !model.IsEncryptedBox(boxID) {
		return false // 非加密 box，走原路径
	}
	model.HoldBoxReadLock(boxID)
	dek, err := model.GetDEKIfUnlocked(boxID)
	if err != nil {
		model.ReleaseBoxReadLock(boxID)
		// 加密笔记本未解锁：fail-closed，返回 403，不走 ServeFile（避免返回密文）
		context.Status(http.StatusForbidden)
		return true
	}
	defer model.ReleaseBoxReadLock(boxID)
	ciphertext, readErr := os.ReadFile(absPath)
	if readErr != nil {
		context.Status(http.StatusNotFound)
		return true
	}
	diskName := filepath.Base(absPath)
	plain, decErr := model.DecryptAsset(boxID, diskName, dek, ciphertext)
	if decErr != nil {
		logging.LogErrorf("decrypt asset [%s] failed: %s", absPath, decErr)
		context.Status(http.StatusInternalServerError)
		return true
	}
	// 下载时用原始文件名（查加密映射），查不到则退回磁盘名
	if originalName := model.LookupAssetOriginalNameLocked(boxID, diskName); originalName != "" {
		setAssetsAttachmentDisposition(context, originalName)
	} else {
		setAssetsAttachmentDisposition(context, absPath)
	}
	contentType := mime.TypeByExtension(filepath.Ext(absPath))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	context.Data(200, contentType, plain)
	return true
}

// serveEncryptedHistory 处理加密笔记本历史文件的 HTTP 输出。
// 若 absPath 在已解锁的加密笔记本下，读密文→解密→按扩展名设置 Content-Type→输出，返回 true；
// 若加密但未解锁，返回 403，返回 true，不走 ServeFile（避免返回密文）；
// 否则返回 false，由调用方走原 http.ServeFile 路径。
func serveEncryptedHistory(context *gin.Context, absPath string) bool {
	boxID := model.ExtractBoxIDFromHistoryPath(absPath)
	if boxID == "" || !model.IsEncryptedBox(boxID) {
		return false // 非加密 box，走原路径
	}
	model.HoldBoxReadLock(boxID)
	dek, err := model.GetDEKIfUnlocked(boxID)
	if err != nil {
		model.ReleaseBoxReadLock(boxID)
		// 加密笔记本未解锁：fail-closed，返回 403，不走 ServeFile（避免返回密文）
		context.Status(http.StatusForbidden)
		return true
	}
	defer model.ReleaseBoxReadLock(boxID)
	ciphertext, readErr := os.ReadFile(absPath)
	if readErr != nil {
		context.Status(http.StatusNotFound)
		return true
	}
	var plain []byte
	var decErr error
	if strings.HasSuffix(absPath, ".sy") {
		// history 路径格式：<historyDir>/<datePrefix>/<boxID>/<relativePath>
		// 需提取 box 内相对路径作为 AAD，不能用 DataDir 前缀 trim
		relPath := extractHistoryRelPath(absPath, boxID)
		plain, decErr = model.DecryptFile(boxID, relPath, dek, ciphertext)
	} else if strings.Contains(absPath, "assets"+string(os.PathSeparator)) {
		diskName := filepath.Base(absPath)
		plain, decErr = model.DecryptAsset(boxID, diskName, dek, ciphertext)
	} else if strings.Contains(absPath, "storage"+string(os.PathSeparator)+"av"+string(os.PathSeparator)) {
		// AV 定义用 siyuan/av 子密钥加密，与 assets 的 siyuan/asset 子密钥不同
		avID := strings.TrimSuffix(filepath.Base(absPath), filepath.Ext(absPath))
		plain, decErr = av.DecryptAVDataLocked(boxID, avID, ciphertext)
	} else {
		// 其他历史文件（如 JSON 元数据等）尝试用 asset 解密方式
		diskName := filepath.Base(absPath)
		plain, decErr = model.DecryptAsset(boxID, diskName, dek, ciphertext)
	}
	if decErr != nil {
		logging.LogErrorf("decrypt history [%s] failed: %s", absPath, decErr)
		context.Status(http.StatusInternalServerError)
		return true
	}
	contentType := mime.TypeByExtension(filepath.Ext(absPath))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	context.Data(200, contentType, plain)
	return true
}

// extractHistoryRelPath 从 history 绝对路径中提取 box 内相对路径作为 AAD。
// history 路径格式：<historyDir>/<datePrefix>/<boxID>/<relativePath>。
func extractHistoryRelPath(absPath, boxID string) string {
	absPath = filepath.ToSlash(absPath)
	historyDir := filepath.ToSlash(util.HistoryDir)
	rel, err := filepath.Rel(historyDir, absPath)
	if err != nil {
		return ""
	}
	rel = filepath.ToSlash(rel)
	// rel 格式：<datePrefix>/<boxID>/<relativePath>
	parts := strings.SplitN(rel, "/", 3)
	if len(parts) < 3 || parts[1] != boxID {
		return ""
	}
	return parts[2]
}

func serveThumbnail(context *gin.Context, assetAbsPath, requestPath string) bool {
	// 加密笔记本的资源是密文，imaging.Open 无法解析，跳过缩略图生成（由 serveEncryptedAsset 解密输出原图）
	if model.IsEncryptedAssetPath(assetAbsPath) {
		return false
	}
	if style := context.Query("style"); style == "thumb" && model.NeedGenerateAssetsThumbnail(assetAbsPath) { // 请求缩略图
		thumbnailPath := filepath.Join(util.TempDir, "thumbnails", "assets", requestPath)
		if !gulu.File.IsExist(thumbnailPath) {
			// 如果缩略图不存在，则生成缩略图
			err := model.GenerateAssetsThumbnail(assetAbsPath, thumbnailPath)
			if err != nil {
				logging.LogErrorf("generate thumbnail failed: %s", err)
				return false
			}
		}

		setAssetsAttachmentDisposition(context, assetAbsPath)
		http.ServeFile(context.Writer, context.Request, thumbnailPath)
		return true
	}
	return false
}

func serveRepoDiff(ginServer *gin.Engine) {
	repoDiffBaseDir := filepath.Join(util.TempDir, "repo", "diff")
	ginServer.GET("/repo/diff/*path", model.CheckAuth, model.CheckAdminRole, func(context *gin.Context) {
		requestPath := filepath.Clean(context.Param("path"))
		if strings.Contains(requestPath, "..") {
			context.Status(http.StatusUnauthorized)
			return
		}
		// 从路径提取 boxID，加密笔记本已锁定时拒绝访问（锁定后 repo 预览解密文件仍存在磁盘上）
		parts := strings.SplitN(strings.TrimPrefix(requestPath, "/"), "/", 2)
		if len(parts) >= 1 && model.IsEncryptedBox(parts[0]) {
			model.HoldBoxReadLock(parts[0])
			defer model.ReleaseBoxReadLock(parts[0])
			if _, dekErr := model.GetDEKIfUnlocked(parts[0]); dekErr != nil {
				context.Status(http.StatusForbidden)
				return
			}
		}
		p := filepath.Join(repoDiffBaseDir, requestPath)
		if !gulu.File.IsSubPath(repoDiffBaseDir, p) {
			context.Status(http.StatusUnauthorized)
			return
		}
		http.ServeFile(context.Writer, context.Request, p)
	})
}

func serveDebug(ginServer *gin.Engine) {
	if "prod" == util.Mode {
		// The production environment will no longer register `/debug/pprof/` https://github.com/siyuan-note/siyuan/issues/10152
		return
	}

	ginServer.GET("/debug/pprof/", gin.WrapF(pprof.Index))
	ginServer.GET("/debug/pprof/allocs", gin.WrapF(pprof.Index))
	ginServer.GET("/debug/pprof/block", gin.WrapF(pprof.Index))
	ginServer.GET("/debug/pprof/goroutine", gin.WrapF(pprof.Index))
	ginServer.GET("/debug/pprof/heap", gin.WrapF(pprof.Index))
	ginServer.GET("/debug/pprof/mutex", gin.WrapF(pprof.Index))
	ginServer.GET("/debug/pprof/threadcreate", gin.WrapF(pprof.Index))
	ginServer.GET("/debug/pprof/cmdline", gin.WrapF(pprof.Cmdline))
	ginServer.GET("/debug/pprof/profile", gin.WrapF(pprof.Profile))
	ginServer.GET("/debug/pprof/symbol", gin.WrapF(pprof.Symbol))
	ginServer.GET("/debug/pprof/trace", gin.WrapF(pprof.Trace))
}

func serveWebSocket(ginServer *gin.Engine) {
	util.WebSocketServer = melody.New()
	util.WebSocketServer.Config.MaxMessageSize = 1024 * 1024 * 8

	ginServer.GET("/ws", func(c *gin.Context) {
		if err := util.WebSocketServer.HandleRequest(c.Writer, c.Request); err != nil {
			logging.LogErrorf("handle command failed: %s", err)
		}
	})

	util.WebSocketServer.HandlePong(func(session *melody.Session) {
		//logging.LogInfof("pong")
	})

	util.WebSocketServer.HandleConnect(func(s *melody.Session) {
		//logging.LogInfof("ws check auth for [%s]", s.Request.RequestURI)
		authOk := true

		if "" != model.Conf.AccessAuthCode {
			session, err := sessionStore.Get(s.Request, "siyuan")
			if err != nil {
				authOk = false
				logging.LogErrorf("get cookie failed: %s", err)
			} else {
				val := session.Values["data"]
				if nil == val {
					authOk = false
				} else {
					sess := &util.SessionData{}
					err = gulu.JSON.UnmarshalJSON([]byte(val.(string)), sess)
					if err != nil {
						authOk = false
						logging.LogErrorf("unmarshal cookie failed: %s", err)
					} else {
						workspaceSess := util.GetWorkspaceSession(sess)
						authOk = workspaceSess.AccessAuthCode == model.Conf.AccessAuthCode
					}
				}
			}
		}

		// REF: https://github.com/siyuan-note/siyuan/issues/11364
		if !authOk {
			if token := model.ParseXAuthToken(s.Request); token != nil {
				authOk = token.Valid && model.IsValidRole(model.GetClaimRole(model.GetTokenClaims(token)), []model.Role{
					model.RoleAdministrator,
					model.RoleEditor,
					model.RoleReader,
				})
			}
		}

		if !authOk {
			// 用于授权页保持连接，避免非常驻内存内核自动退出 https://github.com/siyuan-note/insider/issues/1099
			authOk = strings.Contains(s.Request.RequestURI, "/ws?app=siyuan") && strings.Contains(s.Request.RequestURI, "&id=auth&type=auth")
		}

		if !authOk {
			s.CloseWithMsg([]byte("  unauthenticated"))
			logging.LogWarnf("closed an unauthenticated session [%s]", util.GetRemoteAddr(s.Request))
			return
		}

		// 标记发布服务的连接
		if token := model.ParseXAuthToken(s.Request); token != nil {
			if model.IsPublishServiceToken(token) {
				s.Set("isPublish", true)
			}
		}

		util.AddPushChan(s)
		//sessionId, _ := s.Get("id")
		//logging.LogInfof("ws [%s] connected", sessionId)
	})

	util.WebSocketServer.HandleDisconnect(func(s *melody.Session) {
		util.RemovePushChan(s)
		//sessionId, _ := s.Get("id")
		//logging.LogInfof("ws [%s] disconnected", sessionId)
	})

	util.WebSocketServer.HandleError(func(s *melody.Session, err error) {
		//sessionId, _ := s.Get("id")
		//logging.LogWarnf("ws [%s] failed: %s", sessionId, err)
	})

	util.WebSocketServer.HandleClose(func(s *melody.Session, i int, str string) error {
		//sessionId, _ := s.Get("id")
		//logging.LogDebugf("ws [%s] closed: %v, %v", sessionId, i, str)
		return nil
	})

	util.WebSocketServer.HandleMessage(func(s *melody.Session, msg []byte) {
		start := time.Now()
		logging.LogTracef("request [%s]", shortReqMsg(msg))

		if util.IsAuthSession(s) {
			return
		}

		request := map[string]any{}
		if err := gulu.JSON.UnmarshalJSON(msg, &request); err != nil {
			result := util.NewResult()
			result.Code = -1
			result.Msg = "Bad Request"
			responseData, _ := gulu.JSON.MarshalJSON(result)
			s.Write(responseData)
			return
		}

		if _, ok := s.Get("app"); !ok {
			result := util.NewResult()
			result.Code = -1
			result.Msg = "Bad Request"
			s.Write(result.Bytes())
			return
		}

		cmdStr := request["cmd"].(string)
		cmdId := request["reqId"].(float64)
		param := request["param"].(map[string]any)
		command := cmd.NewCommand(cmdStr, cmdId, param, s)
		if nil == command {
			result := util.NewResult()
			result.Code = -1
			result.Msg = "can not find command [" + cmdStr + "]"
			s.Write(result.Bytes())
			return
		}
		if !command.IsRead() {
			readonly := util.ReadOnly
			if !readonly {
				if token := model.ParseXAuthToken(s.Request); token != nil {
					readonly = token.Valid && model.IsValidRole(model.GetClaimRole(model.GetTokenClaims(token)), []model.Role{
						model.RoleReader,
						model.RoleVisitor,
					})
				}
			}

			if readonly {
				result := util.NewResult()
				result.Code = -1
				result.Msg = model.Conf.Language(34)
				s.Write(result.Bytes())
				return
			}
		}

		end := time.Now()
		logging.LogTracef("parse cmd [%s] consumed [%d]ms", command.Name(), end.Sub(start).Milliseconds())

		cmd.Exec(command)
	})
}

// encryptedBoxAwareWebdavFS 包装 webdav.Dir，拦截所有指向加密笔记本的访问。
// 加密笔记本的文件只能通过 assets/serve 路由访问，WebDAV 直接暴露原始磁盘会绕过所有加密流程。
type encryptedBoxAwareWebdavFS struct {
	inner webdav.FileSystem
}

func (fs *encryptedBoxAwareWebdavFS) isEncryptedBoxPath(name string) bool {
	// 标准化路径，WebDAV handler 已去掉 /webdav/ 前缀
	rel := filepath.ToSlash(path.Clean(name))
	rel = strings.TrimPrefix(rel, "/")
	parts := strings.Split(rel, "/")
	if len(parts) < 1 || parts[0] == "" || rel == "" || rel == "." {
		return false
	}
	// 阻止访问 temp/ 目录（包含已解密的导出、repo 快照等）
	if parts[0] == "temp" {
		return true
	}
	// 阻止访问 data/<encryptedBoxID>/ 目录（字面路径）
	if len(parts) >= 2 && parts[0] == "data" && model.IsEncryptedBox(parts[1]) {
		return true
	}
	// 防止 symlink 绕过：解析最长已存在父路径的符号链接后再次检查
	absPath := filepath.Join(util.WorkspaceDir, name)
	if resolved := util.ResolveLongestExistingParent(absPath); resolved != absPath {
		resolvedRel, _ := filepath.Rel(util.WorkspaceDir, resolved)
		resolvedRel = filepath.ToSlash(resolvedRel)
		resolvedParts := strings.Split(resolvedRel, "/")
		if len(resolvedParts) >= 1 && resolvedParts[0] == "temp" {
			return true
		}
		if len(resolvedParts) >= 2 && resolvedParts[0] == "data" && model.IsEncryptedBox(resolvedParts[1]) {
			return true
		}
	}
	return false
}

func (fs *encryptedBoxAwareWebdavFS) Mkdir(ctx context.Context, name string, perm os.FileMode) error {
	if fs.isEncryptedBoxPath(name) {
		return os.ErrPermission
	}
	return fs.inner.Mkdir(ctx, name, perm)
}

func (fs *encryptedBoxAwareWebdavFS) OpenFile(ctx context.Context, name string, flag int, perm os.FileMode) (webdav.File, error) {
	if fs.isEncryptedBoxPath(name) {
		return nil, os.ErrPermission
	}
	return fs.inner.OpenFile(ctx, name, flag, perm)
}

func (fs *encryptedBoxAwareWebdavFS) RemoveAll(ctx context.Context, name string) error {
	if fs.isEncryptedBoxPath(name) {
		return os.ErrPermission
	}
	return fs.inner.RemoveAll(ctx, name)
}

func (fs *encryptedBoxAwareWebdavFS) Rename(ctx context.Context, oldName, newName string) error {
	if fs.isEncryptedBoxPath(oldName) || fs.isEncryptedBoxPath(newName) {
		return os.ErrPermission
	}
	return fs.inner.Rename(ctx, oldName, newName)
}

func (fs *encryptedBoxAwareWebdavFS) Stat(ctx context.Context, name string) (os.FileInfo, error) {
	if fs.isEncryptedBoxPath(name) {
		return nil, os.ErrPermission
	}
	return fs.inner.Stat(ctx, name)
}

func serveWebDAV(ginServer *gin.Engine) {
	// 自定义 WebDAV 文件系统包装——拒绝加密笔记本的所有访问
	// 加密笔记本的读写必须通过 assets/serve 路由的 box-aware + 解密流程，
	// WebDAV 直接访问原始文件系统会绕过所有这些安全控制
	encBoxAwareFS := &encryptedBoxAwareWebdavFS{inner: webdav.Dir(util.WorkspaceDir)}
	handler := webdav.Handler{
		Prefix:     "/webdav/",
		FileSystem: encBoxAwareFS,
		LockSystem: webdav.NewMemLS(),
		Logger: func(r *http.Request, err error) {
			if nil != err {
				logging.LogErrorf("WebDAV [%s %s]: %s", r.Method, r.URL.String(), err.Error())
			}
			// logging.LogDebugf("WebDAV [%s %s]", r.Method, r.URL.String())
		},
	}

	ginGroup := ginServer.Group("/webdav", model.CheckAuth, model.CheckAdminRole)
	// ginGroup.Any NOT support extension methods (PROPFIND etc.)
	ginGroup.Match(WebDavMethods, "/*path", func(c *gin.Context) {
		if util.ReadOnly {
			switch c.Request.Method {
			case http.MethodPost,
				http.MethodPut,
				http.MethodDelete,
				MethodMkCol,
				MethodCopy,
				MethodMove,
				MethodLock,
				MethodUnlock,
				MethodPropPatch:
				c.AbortWithError(http.StatusForbidden, errors.New(model.Conf.Language(34)))
				return
			}
		}
		handler.ServeHTTP(c.Writer, c.Request)
	})
}

func serveCalDAV(ginServer *gin.Engine) {
	// REF: https://github.com/emersion/hydroxide/blob/master/carddav/carddav.go
	handler := caldav.Handler{
		Backend: &model.CalDavBackend{},
		Prefix:  model.CalDavPrincipalsPath,
	}

	ginServer.Match(CalDavMethods, "/.well-known/caldav", func(c *gin.Context) {
		// logging.LogDebugf("CalDAV -> [%s] %s", c.Request.Method, c.Request.URL.String())
		handler.ServeHTTP(c.Writer, c.Request)
	})

	ginGroup := ginServer.Group(model.CalDavPrefixPath, model.CheckAuth, model.CheckAdminRole)
	ginGroup.Match(CalDavMethods, "/*path", func(c *gin.Context) {
		// logging.LogDebugf("CalDAV -> [%s] %s", c.Request.Method, c.Request.URL.String())
		if util.ReadOnly {
			switch c.Request.Method {
			case http.MethodPost,
				http.MethodPut,
				http.MethodDelete,
				MethodMkCol,
				MethodCopy,
				MethodMove,
				MethodLock,
				MethodUnlock,
				MethodPropPatch:
				c.AbortWithError(http.StatusForbidden, errors.New(model.Conf.Language(34)))
				return
			}
		}
		handler.ServeHTTP(c.Writer, c.Request)
		// logging.LogDebugf("CalDAV <- [%s] %v", c.Request.Method, c.Writer.Status())
	})
}

func serveCardDAV(ginServer *gin.Engine) {
	// REF: https://github.com/emersion/hydroxide/blob/master/carddav/carddav.go
	handler := carddav.Handler{
		Backend: &model.CardDavBackend{},
		Prefix:  model.CardDavPrincipalsPath,
	}

	ginServer.Match(CardDavMethods, "/.well-known/carddav", func(c *gin.Context) {
		// logging.LogDebugf("CardDAV [/.well-known/carddav]")
		handler.ServeHTTP(c.Writer, c.Request)
	})

	ginGroup := ginServer.Group(model.CardDavPrefixPath, model.CheckAuth, model.CheckAdminRole)
	ginGroup.Match(CardDavMethods, "/*path", func(c *gin.Context) {
		if util.ReadOnly {
			switch c.Request.Method {
			case http.MethodPost,
				http.MethodPut,
				http.MethodDelete,
				MethodMkCol,
				MethodCopy,
				MethodMove,
				MethodLock,
				MethodUnlock,
				MethodPropPatch:
				c.AbortWithError(http.StatusForbidden, errors.New(model.Conf.Language(34)))
				return
			}
		}
		// TODO: Can't handle Thunderbird's PROPFIND request with prop <current-user-privilege-set/>
		handler.ServeHTTP(c.Writer, c.Request)
		// logging.LogDebugf("CardDAV <- [%s] %v", c.Request.Method, c.Writer.Status())
	})
}

func shortReqMsg(msg []byte) []byte {
	s := gulu.Str.FromBytes(msg)
	max := 128
	if len(s) > max {
		count := 0
		for i := range s {
			count++
			if count > max {
				return gulu.Str.ToBytes(s[:i] + "...")
			}
		}
	}
	return msg
}

func corsMiddleware() gin.HandlerFunc {
	allowMethods := strings.Join(HttpMethods, ", ")
	allowWebDavMethods := strings.Join(WebDavMethods, ", ")
	allowCalDavMethods := strings.Join(CalDavMethods, ", ")
	allowCardDavMethods := strings.Join(CardDavMethods, ", ")

	return func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Credentials", "true")
		c.Header("Access-Control-Allow-Headers", "origin, Content-Length, Content-Type, Authorization")
		c.Header("Access-Control-Allow-Private-Network", "false")

		if strings.HasPrefix(c.Request.RequestURI, "/webdav") {
			c.Header("Access-Control-Allow-Methods", allowWebDavMethods)
			c.Next()
			return
		}

		if strings.HasPrefix(c.Request.RequestURI, "/caldav") {
			c.Header("Access-Control-Allow-Methods", allowCalDavMethods)
			c.Next()
			return
		}

		if strings.HasPrefix(c.Request.RequestURI, "/carddav") {
			c.Header("Access-Control-Allow-Methods", allowCardDavMethods)
			c.Next()
			return
		}

		c.Header("Access-Control-Allow-Methods", allowMethods)

		switch c.Request.Method {
		case http.MethodOptions:
			c.Header("Access-Control-Max-Age", "600")
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}

// jwtMiddleware is a middleware to check jwt token
// REF: https://github.com/siyuan-note/siyuan/issues/11364
func jwtMiddleware(c *gin.Context) {
	if token := model.ParseXAuthToken(c.Request); token != nil {
		// c.Request.Header.Del(model.XAuthTokenKey)
		if token.Valid {
			claims := model.GetTokenClaims(token)
			c.Set(model.ClaimsContextKey, claims)
			c.Set(model.RoleContextKey, model.GetClaimRole(claims))
			c.Next()
			return
		}
	}
	c.Set(model.RoleContextKey, model.RoleVisitor)
	c.Next()
}

func serveMCP(ginServer *gin.Engine) {
	mcp.Serve(ginServer)
}

func serveFixedStaticFiles(ginServer *gin.Engine) {
	ginServer.StaticFile("favicon.ico", filepath.Join(util.WorkingDir, "stage", "icon.png"))

	ginServer.StaticFile("manifest.json", filepath.Join(util.WorkingDir, "stage", "manifest.webmanifest"))
	ginServer.StaticFile("manifest.webmanifest", filepath.Join(util.WorkingDir, "stage", "manifest.webmanifest"))

	ginServer.StaticFile("service-worker.js", filepath.Join(util.WorkingDir, "stage", "service-worker.js"))
}
