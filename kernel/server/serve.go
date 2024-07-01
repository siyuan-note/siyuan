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
	"github.com/gin-contrib/gzip"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/mssola/useragent"
	"github.com/olahol/melody"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/api"
	"github.com/siyuan-note/siyuan/kernel/cmd"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/server/proxy"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	cookieStore = cookie.NewStore([]byte("ATN51UlxVq1Gcvdf"))
)

func Serve(fastMode bool) {
	gin.SetMode(gin.ReleaseMode)
	ginServer := gin.New()
	ginServer.UseH2C = true
	ginServer.MaxMultipartMemory = 1024 * 1024 * 32 // 插入较大的资源文件时内存占用较大 https://github.com/siyuan-note/siyuan/issues/5023
	ginServer.Use(
		model.ControlConcurrency, // 请求串行化 Concurrency control when requesting the kernel API https://github.com/siyuan-note/siyuan/issues/9939
		model.Timing,
		model.Recover,
		corsMiddleware(), // 后端服务支持 CORS 预检请求验证 https://github.com/siyuan-note/siyuan/pull/5593
		jwtMiddleware,    // 解析 JWT https://github.com/siyuan-note/siyuan/issues/11364
		gzip.Gzip(gzip.DefaultCompression, gzip.WithExcludedExtensions([]string{".pdf", ".mp3", ".wav", ".ogg", ".mov", ".weba", ".mkv", ".mp4", ".webm"})),
	)

	cookieStore.Options(sessions.Options{
		Path:   "/",
		Secure: util.SSL,
		//MaxAge:   60 * 60 * 24 * 7, // 默认是 Session
		HttpOnly: true,
	})
	ginServer.Use(sessions.Sessions("siyuan", cookieStore))

	serveDebug(ginServer)
	serveAssets(ginServer)
	serveAppearance(ginServer)
	serveWebSocket(ginServer)
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
	if nil != err {
		if !fastMode {
			logging.LogErrorf("boot kernel failed: %s", err)
			os.Exit(logging.ExitCodeUnavailablePort)
		}

		// fast 模式下启动失败则直接返回
		return
	}

	_, port, err := net.SplitHostPort(ln.Addr().String())
	if nil != err {
		if !fastMode {
			logging.LogErrorf("boot kernel failed: %s", err)
			os.Exit(logging.ExitCodeUnavailablePort)
		}
	}
	util.ServerPort = port

	util.ServerURL, err = url.Parse("http://127.0.0.1:" + port)
	if err != nil {
		logging.LogErrorf("parse server url failed: %s", err)
	}

	pid := fmt.Sprintf("%d", os.Getpid())
	if !fastMode {
		rewritePortJSON(pid, port)
	}
	logging.LogInfof("kernel [pid=%s] http server [%s] is booting", pid, host+":"+port)
	util.HttpServing = true

	go util.HookUILoaded()

	go func() {
		time.Sleep(1 * time.Second)
		go proxy.InitFixedPortService(host)
		go proxy.InitPublishService()
		// 反代服务器启动失败不影响核心服务器启动
	}()

	if err = http.Serve(ln, ginServer.Handler()); nil != err {
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
		if nil != err {
			logging.LogWarnf("read port.json failed: %s", err)
		} else {
			if err = gulu.JSON.UnmarshalJSON(data, &pidPorts); nil != err {
				logging.LogWarnf("unmarshal port.json failed: %s", err)
			}
		}
	}

	pidPorts[pid] = port
	if data, err = gulu.JSON.MarshalIndentJSON(pidPorts, "", "  "); nil != err {
		logging.LogWarnf("marshal port.json failed: %s", err)
	} else {
		if err = os.WriteFile(portJSON, data, 0644); nil != err {
			logging.LogWarnf("write port.json failed: %s", err)
		}
	}
}

func serveExport(ginServer *gin.Engine) {
	ginServer.Static("/export/", filepath.Join(util.TempDir, "export"))
}

func serveWidgets(ginServer *gin.Engine) {
	ginServer.Static("/widgets/", filepath.Join(util.DataDir, "widgets"))
}

func servePlugins(ginServer *gin.Engine) {
	ginServer.Static("/plugins/", filepath.Join(util.DataDir, "plugins"))
}

func serveEmojis(ginServer *gin.Engine) {
	ginServer.Static("/emojis/", filepath.Join(util.DataDir, "emojis"))
}

func serveTemplates(ginServer *gin.Engine) {
	ginServer.Static("/templates/", filepath.Join(util.DataDir, "templates"))
}

func servePublic(ginServer *gin.Engine) {
	// Support directly access `data/public/*` contents via URL link https://github.com/siyuan-note/siyuan/issues/8593
	ginServer.Static("/public/", filepath.Join(util.DataDir, "public"))
}

func serveSnippets(ginServer *gin.Engine) {
	ginServer.Handle("GET", "/snippets/*filepath", func(c *gin.Context) {
		filePath := strings.TrimPrefix(c.Request.URL.Path, "/snippets/")
		ext := filepath.Ext(filePath)
		name := strings.TrimSuffix(filePath, ext)
		confSnippets, err := model.LoadSnippets()
		if nil != err {
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
		if strings.HasSuffix(c.Request.URL.Path, "/theme.js") {
			if !gulu.File.IsExist(filePath) {
				// 主题 js 不存在时生成空内容返回
				c.Data(200, "application/x-javascript", nil)
				return
			}
		} else if strings.Contains(c.Request.URL.Path, "/langs/") && strings.HasSuffix(c.Request.URL.Path, ".json") {
			lang := path.Base(c.Request.URL.Path)
			lang = strings.TrimSuffix(lang, ".json")
			if "zh_CN" != lang && "en_US" != lang {
				// 多语言配置缺失项使用对应英文配置项补齐 https://github.com/siyuan-note/siyuan/issues/5322

				enUSFilePath := filepath.Join(appearancePath, "langs", "en_US.json")
				enUSData, err := os.ReadFile(enUSFilePath)
				if nil != err {
					logging.LogErrorf("read en_US.json [%s] failed: %s", enUSFilePath, err)
					util.ReportFileSysFatalError(err)
					return
				}
				enUSMap := map[string]interface{}{}
				if err = gulu.JSON.UnmarshalJSON(enUSData, &enUSMap); nil != err {
					logging.LogErrorf("unmarshal en_US.json [%s] failed: %s", enUSFilePath, err)
					util.ReportFileSysFatalError(err)
					return
				}

				for {
					data, err := os.ReadFile(filePath)
					if nil != err {
						c.JSON(200, enUSMap)
						return
					}

					langMap := map[string]interface{}{}
					if err = gulu.JSON.UnmarshalJSON(data, &langMap); nil != err {
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

	siyuan.Static("/stage/", filepath.Join(util.WorkingDir, "stage"))
}

func serveCheckAuth(ginServer *gin.Engine) {
	ginServer.GET("/check-auth", serveAuthPage)
}

func serveAuthPage(c *gin.Context) {
	data, err := os.ReadFile(filepath.Join(util.WorkingDir, "stage/auth.html"))
	if nil != err {
		logging.LogErrorf("load auth page failed: %s", err)
		c.Status(500)
		return
	}

	tpl, err := template.New("auth").Parse(string(data))
	if nil != err {
		logging.LogErrorf("parse auth page failed: %s", err)
		c.Status(500)
		return
	}

	keymapHideWindow := "⌥M"
	if nil != (*model.Conf.Keymap)["general"] {
		switch (*model.Conf.Keymap)["general"].(type) {
		case map[string]interface{}:
			keymapGeneral := (*model.Conf.Keymap)["general"].(map[string]interface{})
			if nil != keymapGeneral["toggleWin"] {
				switch keymapGeneral["toggleWin"].(type) {
				case map[string]interface{}:
					toggleWin := keymapGeneral["toggleWin"].(map[string]interface{})
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
	model := map[string]interface{}{
		"l0":                     model.Conf.Language(173),
		"l1":                     model.Conf.Language(174),
		"l2":                     template.HTML(model.Conf.Language(172)),
		"l3":                     model.Conf.Language(175),
		"l4":                     model.Conf.Language(176),
		"l5":                     model.Conf.Language(177),
		"l6":                     model.Conf.Language(178),
		"l7":                     template.HTML(model.Conf.Language(184)),
		"l8":                     model.Conf.Language(95),
		"appearanceMode":         model.Conf.Appearance.Mode,
		"appearanceModeOS":       model.Conf.Appearance.ModeOS,
		"workspace":              filepath.Base(util.WorkspaceDir),
		"workspacePath":          util.WorkspaceDir,
		"keymapGeneralToggleWin": keymapHideWindow,
		"trayMenuLangs":          util.TrayMenuLangs[util.Lang],
		"workspaceDir":           util.WorkspaceDir,
	}
	buf := &bytes.Buffer{}
	if err = tpl.Execute(buf, model); nil != err {
		logging.LogErrorf("execute auth page failed: %s", err)
		c.Status(500)
		return
	}
	data = buf.Bytes()
	c.Data(http.StatusOK, "text/html; charset=utf-8", data)
}

func serveAssets(ginServer *gin.Engine) {
	ginServer.POST("/upload", model.CheckAuth, model.CheckAdminRole, model.CheckReadonly, model.Upload)

	ginServer.GET("/assets/*path", model.CheckAuth, func(context *gin.Context) {
		requestPath := context.Param("path")
		relativePath := path.Join("assets", requestPath)
		p, err := model.GetAssetAbsPath(relativePath)
		if nil != err {
			if strings.Contains(strings.TrimPrefix(requestPath, "/"), "/") {
				// 再使用编码过的路径解析一次 https://github.com/siyuan-note/siyuan/issues/11823
				dest := url.PathEscape(strings.TrimPrefix(requestPath, "/"))
				dest = strings.ReplaceAll(dest, ":", "%3A")
				relativePath = path.Join("assets", dest)
				p, err = model.GetAssetAbsPath(relativePath)
			}

			if nil != err {
				context.Status(http.StatusNotFound)
				return
			}
		}
		http.ServeFile(context.Writer, context.Request, p)
		return
	})
	ginServer.GET("/history/*path", model.CheckAuth, model.CheckAdminRole, func(context *gin.Context) {
		p := filepath.Join(util.HistoryDir, context.Param("path"))
		http.ServeFile(context.Writer, context.Request, p)
		return
	})
}

func serveRepoDiff(ginServer *gin.Engine) {
	ginServer.GET("/repo/diff/*path", model.CheckAuth, model.CheckAdminRole, func(context *gin.Context) {
		requestPath := context.Param("path")
		p := filepath.Join(util.TempDir, "repo", "diff", requestPath)
		http.ServeFile(context.Writer, context.Request, p)
		return
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
	util.WebSocketServer.Config.MaxMessageSize = 1024 * 1024 * 8

	ginServer.GET("/ws", func(c *gin.Context) {
		if err := util.WebSocketServer.HandleRequest(c.Writer, c.Request); nil != err {
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
			session, err := cookieStore.Get(s.Request, "siyuan")
			if nil != err {
				authOk = false
				logging.LogErrorf("get cookie failed: %s", err)
			} else {
				val := session.Values["data"]
				if nil == val {
					authOk = false
				} else {
					sess := &util.SessionData{}
					err = gulu.JSON.UnmarshalJSON([]byte(val.(string)), sess)
					if nil != err {
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
			authOk = strings.Contains(s.Request.RequestURI, "/ws?app=siyuan&id=auth")
		}

		if !authOk {
			s.CloseWithMsg([]byte("  unauthenticated"))
			logging.LogWarnf("closed an unauthenticated session [%s]", util.GetRemoteAddr(s.Request))
			return
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
		request := map[string]interface{}{}
		if err := gulu.JSON.UnmarshalJSON(msg, &request); nil != err {
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
		param := request["param"].(map[string]interface{})
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
	return func(c *gin.Context) {

		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Credentials", "true")
		c.Header("Access-Control-Allow-Headers", "origin, Content-Length, Content-Type, Authorization")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS")
		c.Header("Access-Control-Allow-Private-Network", "true")

		if c.Request.Method == "OPTIONS" {
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
	return
}

func serveFixedStaticFiles(ginServer *gin.Engine) {
	ginServer.StaticFile("favicon.ico", filepath.Join(util.WorkingDir, "stage", "icon.png"))

	ginServer.StaticFile("manifest.json", filepath.Join(util.WorkingDir, "stage", "manifest.webmanifest"))
	ginServer.StaticFile("manifest.webmanifest", filepath.Join(util.WorkingDir, "stage", "manifest.webmanifest"))

	ginServer.StaticFile("service-worker.js", filepath.Join(util.WorkingDir, "stage", "service-worker.js"))
}
