// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package proxy

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/http/httputil"
	"strings"
	"testing"

	ginSessions "github.com/gin-contrib/sessions"
	"github.com/gin-contrib/sessions/cookie"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 验证客户端协议与回源协议的各种组合均可保留登录会话，且两类代理都会覆盖伪造的协议标记。
func TestReverseProxyLoginSessionRoundTrip(t *testing.T) {
	previousConf, previousSSL := model.Conf, util.SSL
	previousWrongAuthCount := util.WrongAuthCount
	model.Conf = model.NewAppConf()
	model.Conf.AccessAuthCode = "test-access-code"
	util.SSL = false
	util.WrongAuthCount = 0
	t.Cleanup(func() {
		model.Conf, util.SSL = previousConf, previousSSL
		util.WrongAuthCount = previousWrongAuthCount
	})

	gin.SetMode(gin.TestMode)
	engine := gin.New()
	engine.Use(ginSessions.Sessions("siyuan", cookie.NewStore([]byte("test-cookie-key"))))
	engine.POST("/api/system/loginAuth", func(c *gin.Context) {
		result := model.LoginAuth(c, apicontract.SystemLoginAuthRequest{AuthCode: "test-access-code", RememberMe: true})
		c.JSON(http.StatusOK, result)
	})
	paths := []string{"/stage/build/desktop/", "/stage/build/mobile/"}
	for _, path := range paths {
		engine.GET(path, model.CheckAuth, func(c *gin.Context) { c.Status(http.StatusNoContent) })
	}

	for _, proxyName := range []string{"fixed port", "publish"} {
		t.Run(proxyName, func(t *testing.T) {
			for _, backendTLS := range []bool{false, true} {
				backendName := "HTTP backend"
				if backendTLS {
					backendName = "HTTPS backend"
				}
				t.Run(backendName, func(t *testing.T) {
					backend := httptest.NewUnstartedServer(engine)
					if backendTLS {
						backend.StartTLS()
					} else {
						backend.Start()
					}
					defer backend.Close()

					for _, clientTLS := range []bool{false, true} {
						clientName := "HTTP client"
						if clientTLS {
							clientName = "HTTPS client"
						}
						t.Run(clientName, func(t *testing.T) {
							target := mustParseURL(t, backend.URL)
							var handler *httputil.ReverseProxy
							if proxyName == "fixed port" {
								handler = newFixedPortReverseProxy(target)
							} else {
								handler = newPublishReverseProxy(target, backend.Client().Transport)
							}
							server := httptest.NewUnstartedServer(handler)
							scheme := "http"
							if clientTLS {
								server.StartTLS()
								scheme = "https"
							} else {
								server.Start()
							}
							defer server.Close()

							jar, err := cookiejar.New(nil)
							if err != nil {
								t.Fatal(err)
							}
							// 使用非环回域名检查 Secure 限制，避免客户端对 localhost 的特殊处理掩盖会话丢失。
							transport := &http.Transport{
								TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
								DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
									return (&net.Dialer{}).DialContext(ctx, network, server.Listener.Addr().String())
								},
							}
							defer transport.CloseIdleConnections()
							client := &http.Client{Jar: jar, Transport: transport}
							baseURL := scheme + "://notes.example.test"
							request, err := http.NewRequest(http.MethodPost, baseURL+"/api/system/loginAuth", strings.NewReader(`{}`))
							if err != nil {
								t.Fatal(err)
							}
							if clientTLS {
								request.Header.Set(util.ClientTLSHeader, util.ClientTLSHeaderPlaintextValue)
							} else {
								request.Header.Set(util.ClientTLSHeader, util.ClientTLSHeaderValue)
							}
							response, err := client.Do(request)
							if err != nil {
								t.Fatal(err)
							}
							var result struct {
								Code *int   `json:"code"`
								Msg  string `json:"msg"`
							}
							err = json.NewDecoder(response.Body).Decode(&result)
							response.Body.Close()
							if err != nil {
								t.Fatal(err)
							}
							if response.StatusCode != http.StatusOK || result.Code == nil || *result.Code != 0 {
								t.Fatalf("login status = %d, result = %+v", response.StatusCode, result)
							}
							cookies := response.Cookies()
							if len(cookies) != 1 {
								t.Fatalf("Set-Cookie count = %d, want 1", len(cookies))
							}
							if cookies[0].Secure != clientTLS {
								t.Fatalf("cookie Secure = %v, want %v", cookies[0].Secure, clientTLS)
							}
							for _, path := range paths {
								response, err = client.Get(baseURL + path)
								if err != nil {
									t.Fatal(err)
								}
								response.Body.Close()
								if response.StatusCode != http.StatusNoContent {
									t.Fatalf("authenticated %s status = %d, want %d", path, response.StatusCode, http.StatusNoContent)
								}
							}
						})
					}
				})
			}
		})
	}
}
