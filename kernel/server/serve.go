// SiYuan - Build Your Eternal Digital Garden
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
	"net/http"
	"net/http/pprof"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/melody"
	"github.com/gin-contrib/gzip"
	"github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/mssola/user_agent"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/api"
	"github.com/siyuan-note/siyuan/kernel/cmd"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var cookieStore = cookie.NewStore([]byte("ATN51UlxVq1Gcvdf"))

func CORSMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {

		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Credentials", "true")
		c.Header("Access-Control-Allow-Headers", "origin, Content-Length, Content-Type, Authorization")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}

func Serve(fastMode bool) {
	gin.SetMode(gin.ReleaseMode)
	ginServer := gin.New()
	ginServer.MaxMultipartMemory = 1024 * 1024 * 32 // 插入较大的资源文件时内存占用较大 https://github.com/siyuan-note/siyuan/issues/5023
	ginServer.Use(gin.Recovery())
	// 跨域支持验证
	// ginServer.Use(cors.Default())
	ginServer.Use(CORSMiddleware())
	ginServer.Use(gzip.Gzip(gzip.DefaultCompression, gzip.WithExcludedExtensions([]string{".pdf", ".mp3", ".wav", ".ogg", ".mov", ".weba", ".mkv", ".mp4", ".webm"})))

	cookieStore.Options(sessions.Options{
		Path:   "/",
		Secure: util.SSL,
		//MaxAge:   60 * 60 * 24 * 7, // 默认是 Session
		HttpOnly: true,
	})
	ginServer.Use(sessions.Sessions("siyuan", cookieStore))

	if "dev" == util.Mode {
		serveDebug(ginServer)
	}

	serveAssets(ginServer)
	serveAppearance(ginServer)
	serveWebSocket(ginServer)
	serveExport(ginServer)
	serveWidgets(ginServer)
	serveEmojis(ginServer)
	api.ServeAPI(ginServer)

	var addr string
	if model.Conf.System.NetworkServe || "docker" == util.Container {
		addr = "0.0.0.0:" + util.ServerPort
	} else {
		addr = "127.0.0.1:" + util.ServerPort
	}
	logging.LogInfof("kernel is booting [%s]", "http://"+addr)
	util.HttpServing = true
	if err := ginServer.Run(addr); nil != err {
		if !fastMode {
			logging.LogErrorf("boot kernel failed: %s", err)
			os.Exit(util.ExitCodeUnavailablePort)
		}
	}
}

func serveExport(ginServer *gin.Engine) {
	ginServer.Static("/export/", filepath.Join(util.TempDir, "export"))
}

func serveWidgets(ginServer *gin.Engine) {
	ginServer.Static("/widgets/", filepath.Join(util.DataDir, "widgets"))
}

func serveEmojis(ginServer *gin.Engine) {
	ginServer.Static("/emojis/", filepath.Join(util.DataDir, "emojis"))
}

func serveAppearance(ginServer *gin.Engine) {
	siyuan := ginServer.Group("", model.CheckAuth)

	siyuan.Handle("GET", "/", func(c *gin.Context) {
		userAgentHeader := c.GetHeader("User-Agent")
		if strings.Contains(userAgentHeader, "Electron") {
			c.Redirect(302, "/stage/build/app/?r="+gulu.Rand.String(7))
			return
		}

		ua := user_agent.New(userAgentHeader)
		if ua.Mobile() {
			c.Redirect(302, "/stage/build/mobile/?r="+gulu.Rand.String(7))
			return
		}

		c.Redirect(302, "/stage/build/desktop/?r="+gulu.Rand.String(7))
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
					logging.LogFatalf("read en_US.json [%s] failed: %s", enUSFilePath, err)
					return
				}
				enUSMap := map[string]interface{}{}
				if err = gulu.JSON.UnmarshalJSON(enUSData, &enUSMap); nil != err {
					logging.LogFatalf("unmarshal en_US.json [%s] failed: %s", enUSFilePath, err)
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
	siyuan.StaticFile("favicon.ico", filepath.Join(util.WorkingDir, "stage", "icon.png"))

	siyuan.GET("/check-auth", serveCheckAuth)
}

func serveCheckAuth(c *gin.Context) {
	data, err := os.ReadFile(filepath.Join(util.WorkingDir, "stage/auth.html"))
	if nil != err {
		logging.LogErrorf("load auth page failed: %s", err)
		c.Status(500)
		return
	}
	c.Data(http.StatusOK, "text/html; charset=utf-8", data)
}

func serveAssets(ginServer *gin.Engine) {
	ginServer.POST("/upload", model.CheckAuth, model.Upload)

	ginServer.GET("/assets/*path", model.CheckAuth, func(context *gin.Context) {
		requestPath := context.Param("path")
		relativePath := path.Join("assets", requestPath)
		p, err := model.GetAssetAbsPath(relativePath)
		if nil != err {
			context.Status(404)
			return
		}
		http.ServeFile(context.Writer, context.Request, p)
		return
	})
	ginServer.GET("/history/:dir/assets/*name", model.CheckAuth, func(context *gin.Context) {
		dir := context.Param("dir")
		name := context.Param("name")
		relativePath := path.Join(dir, "assets", name)
		p := filepath.Join(util.HistoryDir, relativePath)
		http.ServeFile(context.Writer, context.Request, p)
		return
	})
}

func serveDebug(ginServer *gin.Engine) {
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
	if "docker" == util.Container { // Docker 容器运行时启用 WebSocket 传输压缩
		util.WebSocketServer.Config.EnableCompression = true
		util.WebSocketServer.Config.CompressionLevel = 4
	}

	ginServer.GET("/ws", func(c *gin.Context) {
		if err := util.WebSocketServer.HandleRequest(c.Writer, c.Request); nil != err {
			logging.LogErrorf("handle command failed: %s", err)
		}
	})

	util.WebSocketServer.HandlePong(func(session *melody.Session) {
		//model.Logger.Debugf("pong")
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
					sess := map[string]interface{}{}
					err = gulu.JSON.UnmarshalJSON([]byte(val.(string)), &sess)
					if nil != err {
						authOk = false
						logging.LogErrorf("unmarshal cookie failed: %s", err)
					} else {
						authOk = sess["AccessAuthCode"].(string) == model.Conf.AccessAuthCode
					}
				}
			}
		}

		if !authOk {
			s.CloseWithMsg([]byte("  unauthenticated"))
			//logging.LogWarnf("closed a unauthenticated session [%s]", util.GetRemoteAddr(s))
			return
		}

		util.AddPushChan(s)
		//sessionId, _ := s.Get("id")
		//logging.LogInfof("ws [%s] connected", sessionId)
	})

	util.WebSocketServer.HandleDisconnect(func(s *melody.Session) {
		util.RemovePushChan(s)
		//sessionId, _ := s.Get("id")
		//model.Logger.Debugf("ws [%s] disconnected", sessionId)
	})

	util.WebSocketServer.HandleError(func(s *melody.Session, err error) {
		//sessionId, _ := s.Get("id")
		//logging.LogDebugf("ws [%s] failed: %s", sessionId, err)
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
		if util.ReadOnly && !command.IsRead() {
			result := util.NewResult()
			result.Code = -1
			result.Msg = model.Conf.Language(34)
			s.Write(result.Bytes())
			return
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
