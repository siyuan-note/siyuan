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

package api

import (
	"encoding/base32"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/textproto"
	"net/url"
	"strings"
	"syscall"
	"time"

	"github.com/88250/gulu"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/imroc/req/v3"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type File struct {
	Filename string
	Header   textproto.MIMEHeader
	Size     int64
	Content  string
}

type MultipartForm struct {
	Value map[string][]string
	File  map[string][]File
}

func echo(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	var (
		password      string
		multipartForm *MultipartForm
		rawData       any
	)

	if form, err := c.MultipartForm(); err != nil || nil == form {
		multipartForm = nil
	} else {
		multipartForm = &MultipartForm{
			Value: form.Value,
			File:  map[string][]File{},
		}
		for k, handlers := range form.File {
			files := make([]File, len(handlers))
			multipartForm.File[k] = files
			for i, handler := range handlers {
				files[i].Filename = handler.Filename
				files[i].Header = handler.Header
				files[i].Size = handler.Size
				if file, err := handler.Open(); err != nil {
					logging.LogWarnf("echo open form [%s] file [%s] error: %s", k, handler.Filename, err.Error())
				} else {
					content := make([]byte, handler.Size)
					if n, err := file.Read(content); err != nil {
						logging.LogWarnf("echo read form [%s] file [%s] error: %s", k, handler.Filename, err.Error())
					} else {
						files[i].Content = base64.StdEncoding.EncodeToString(content[:n])
					}
				}
			}
		}
	}

	if data, err := c.GetRawData(); err == nil {
		rawData = base64.StdEncoding.EncodeToString(data)
	} else {
		logging.LogWarnf("echo get raw data error: %s", err.Error())
		rawData = nil
	}

	username, password, ok := c.Request.BasicAuth()

	ret.Data = map[string]any{
		"Context": map[string]any{
			"Params":       c.Params,
			"HandlerNames": c.HandlerNames(),
			"FullPath":     c.FullPath(),
			"ClientIP":     c.ClientIP(),
			"RemoteIP":     c.RemoteIP(),
			"ContentType":  c.ContentType(),
			"IsWebsocket":  c.IsWebsocket(),
			"RawData":      rawData,
		},
		"Request": map[string]any{
			"Method":           c.Request.Method,
			"URL":              c.Request.URL,
			"Proto":            c.Request.Proto,
			"ProtoMajor":       c.Request.ProtoMajor,
			"ProtoMinor":       c.Request.ProtoMinor,
			"Header":           c.Request.Header,
			"ContentLength":    c.Request.ContentLength,
			"TransferEncoding": c.Request.TransferEncoding,
			"Close":            c.Request.Close,
			"Host":             c.Request.Host,
			"Form":             c.Request.Form,
			"PostForm":         c.Request.PostForm,
			"MultipartForm":    multipartForm,
			"Trailer":          c.Request.Trailer,
			"RemoteAddr":       c.Request.RemoteAddr,
			"TLS":              c.Request.TLS,
			"UserAgent":        c.Request.UserAgent(),
			"Cookies":          c.Request.Cookies(),
			"Referer":          c.Request.Referer(),
		},
		"URL": map[string]any{
			"EscapedPath":     c.Request.URL.EscapedPath(),
			"EscapedFragment": c.Request.URL.EscapedFragment(),
			"String":          c.Request.URL.String(),
			"Redacted":        c.Request.URL.Redacted(),
			"IsAbs":           c.Request.URL.IsAbs(),
			"Query":           c.Request.URL.Query(),
			"RequestURI":      c.Request.URL.RequestURI(),
			"Hostname":        c.Request.URL.Hostname(),
			"Port":            c.Request.URL.Port(),
		},
		"User": map[string]any{
			"Exists":   ok,
			"Username": username,
			"Password": password,
		},
	}
}

func forwardProxy(c *gin.Context) {
	ret := gulu.Ret.NewResult()
	defer c.JSON(http.StatusOK, ret)

	arg, ok := util.JsonArg(c, ret)
	if !ok {
		return
	}

	var destURL string
	if !util.ParseJsonArgs(arg, ret, util.BindJsonArg("url", &destURL, true, true)) {
		return
	}
	u, e := url.ParseRequestURI(destURL)
	if nil != e {
		ret.Code = -1
		ret.Msg = "invalid [url]"
		return
	}

	if u.Scheme != "http" && u.Scheme != "https" {
		ret.Code = -1
		ret.Msg = "only http/https is allowed"
		return
	}

	method := "POST"
	if methodArg := arg["method"]; nil != methodArg {
		method = strings.ToUpper(methodArg.(string))
	}
	timeout := 7000
	if timeoutArg := arg["timeout"]; nil != timeoutArg {
		timeout = int(timeoutArg.(float64))
		if 1 > timeout {
			timeout = 7000
		}
	}

	client := getSafeClient(time.Duration(timeout) * time.Millisecond)
	request := client.R()
	if headers, ok := arg["headers"].([]any); ok {
		for _, pair := range headers {
			if m, ok := pair.(map[string]any); ok {
				for k, v := range m {
					request.SetHeader(k, fmt.Sprintf("%v", v))
				}
			}
		}
	}

	contentType := "application/json"
	if contentTypeArg := arg["contentType"]; nil != contentTypeArg {
		contentType = contentTypeArg.(string)
	}
	request.SetHeader("Content-Type", contentType)

	payloadEncoding := "json"
	if payloadEncodingArg := arg["payloadEncoding"]; nil != payloadEncodingArg {
		payloadEncoding = payloadEncodingArg.(string)
	}

	switch payloadEncoding {
	case "base64":
		fallthrough
	case "base64-std":
		if payload, err := base64.StdEncoding.DecodeString(arg["payload"].(string)); err != nil {
			ret.Code = -2
			ret.Msg = "decode base64-std payload failed: " + err.Error()
			return
		} else {
			request.SetBody(payload)
		}
	case "base64-url":
		if payload, err := base64.URLEncoding.DecodeString(arg["payload"].(string)); err != nil {
			ret.Code = -2
			ret.Msg = "decode base64-url payload failed: " + err.Error()
			return
		} else {
			request.SetBody(payload)
		}
	case "base32":
		fallthrough
	case "base32-std":
		if payload, err := base32.StdEncoding.DecodeString(arg["payload"].(string)); err != nil {
			ret.Code = -2
			ret.Msg = "decode base32-std payload failed: " + err.Error()
			return
		} else {
			request.SetBody(payload)
		}
	case "base32-hex":
		if payload, err := base32.HexEncoding.DecodeString(arg["payload"].(string)); err != nil {
			ret.Code = -2
			ret.Msg = "decode base32-hex payload failed: " + err.Error()
			return
		} else {
			request.SetBody(payload)
		}
	case "hex":
		if payload, err := hex.DecodeString(arg["payload"].(string)); err != nil {
			ret.Code = -2
			ret.Msg = "decode hex payload failed: " + err.Error()
			return
		} else {
			request.SetBody(payload)
		}
	case "text":
	default:
		request.SetBody(arg["payload"])
	}

	started := time.Now()
	resp, err := request.Send(method, destURL)
	if err != nil {
		ret.Code = -1
		ret.Msg = "forward request failed: " + err.Error()
		return
	}

	bodyData, err := io.ReadAll(resp.Body)
	if err != nil {
		ret.Code = -1
		ret.Msg = "read response body failed: " + err.Error()
		return
	}

	elapsed := time.Since(started)

	responseEncoding := "text"
	if responseEncodingArg := arg["responseEncoding"]; nil != responseEncodingArg {
		responseEncoding = responseEncodingArg.(string)
	}

	body := ""
	switch responseEncoding {
	case "base64":
		fallthrough
	case "base64-std":
		body = base64.StdEncoding.EncodeToString(bodyData)
	case "base64-url":
		body = base64.URLEncoding.EncodeToString(bodyData)
	case "base32":
		fallthrough
	case "base32-std":
		body = base32.StdEncoding.EncodeToString(bodyData)
	case "base32-hex":
		body = base32.HexEncoding.EncodeToString(bodyData)
	case "hex":
		body = hex.EncodeToString(bodyData)
	case "text":
		fallthrough
	default:
		responseEncoding = "text"
		body = string(bodyData)
	}

	data := map[string]any{
		"url":          destURL,
		"status":       resp.StatusCode,
		"contentType":  resp.GetHeader("content-type"),
		"body":         body,
		"bodyEncoding": responseEncoding,
		"headers":      resp.Header,
		"elapsed":      elapsed.Milliseconds(),
	}
	ret.Data = data

	//shortBody := ""
	//if 64 > len(body) {
	//	shortBody = body
	//} else {
	//	shortBody = body[:64]
	//}
	//
	//logging.LogInfof("elapsed [%.1fs], length [%d], request [url=%s, headers=%s, content-type=%s, body=%s], status [%d], body [%s]",
	//	elapsed.Seconds(), len(bodyData), data["url"], headers, contentType, arg["payload"], data["status"], shortBody)
}

// 校验 IP 是否为私有内网地址
func isPrivateIP(ip net.IP) bool {
	return ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsPrivate() || ip.IsUnspecified()
}

// 创建安全的 HTTP Client，防止 SSRF 和 DNS 重绑定
func getSafeClient(timeout time.Duration) *req.Client {
	dialer := &net.Dialer{
		Timeout: timeout,
		// Control 函数在解析出 IP 后、建立连接前执行，是防御 DNS Rebinding 的关键
		Control: func(network, address string, c syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			ip := net.ParseIP(host)
			if ip != nil && isPrivateIP(ip) {
				return fmt.Errorf("ip address [%s] is prohibited", host)
			}
			return nil
		},
	}

	client := req.C()
	client.SetTimeout(timeout)
	client.SetDial(dialer.DialContext)
	client.SetRedirectPolicy(req.MaxRedirectPolicy(3))
	return client
}

// parseForwardProxyParams decodes the `u` and `h` query parameters.
//
// Query params:
//   - `u`: RawURLEncoding base64 of the target URL string.
//   - `h`: RawURLEncoding base64 of a JSON object map[string][]string.
func parseForwardProxyParams(c *gin.Context) (parsedURL *url.URL, headers *http.Header, err error) {
	uParam := c.Query("u")
	if uParam == "" {
		err = fmt.Errorf("missing query param [u]")
		return
	}
	uBytes, decErr := base64.RawURLEncoding.DecodeString(uParam)
	if decErr != nil {
		err = fmt.Errorf("decode [u] failed: %s", decErr.Error())
		return
	}
	parsedURL, err = url.ParseRequestURI(string(uBytes))
	if err != nil {
		err = fmt.Errorf("parse [u] failed: %s", err.Error())
		return
	}

	h := http.Header{}
	headers = &h
	hParam := c.Query("h")
	if hParam == "" {
		return
	}
	hBytes, decErr := base64.RawURLEncoding.DecodeString(hParam)
	if decErr != nil {
		err = fmt.Errorf("decode [h] failed: %s", decErr.Error())
		return
	}
	var record map[string][]string
	if jsonErr := json.Unmarshal(hBytes, &record); jsonErr != nil {
		err = fmt.Errorf("parse [h] failed: %s", jsonErr.Error())
		return
	}
	for k, vs := range record {
		for _, v := range vs {
			h.Add(k, v)
		}
	}
	return
}

// ssrfSafeDialer returns a net.Dialer whose Control hook blocks private IPs.
func ssrfSafeDialer(connectTimeout time.Duration) *net.Dialer {
	return &net.Dialer{
		Timeout: connectTimeout,
		Control: func(network, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			if ip := net.ParseIP(host); ip != nil && isPrivateIP(ip) {
				return fmt.Errorf("ip address [%s] is prohibited", host)
			}
			return nil
		},
	}
}

// wsProxy proxies a WebSocket connection to a remote WebSocket endpoint.
//
// Query params:
//   - u: RawURLEncoding base64 of the target ws/wss URL
//   - h: RawURLEncoding base64 of JSON map[string][]string forwarded as handshake headers
func wsProxy(c *gin.Context) {
	targetURL, targetHeaders, err := parseForwardProxyParams(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": -1, "msg": err.Error()})
		return
	}

	if targetURL.Scheme != "ws" && targetURL.Scheme != "wss" {
		c.JSON(http.StatusBadRequest, gin.H{"code": -1, "msg": "only ws/wss is allowed"})
		return
	}

	wsDialer := &websocket.Dialer{
		NetDialContext:   ssrfSafeDialer(30 * time.Second).DialContext,
		HandshakeTimeout: 30 * time.Second,
	}

	targetConn, _, dialErr := wsDialer.DialContext(c.Request.Context(), targetURL.String(), *targetHeaders)
	if dialErr != nil {
		c.JSON(http.StatusBadGateway, gin.H{"code": -1, "msg": "dial target failed: " + dialErr.Error()})
		return
	}
	defer targetConn.Close()

	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
	clientConn, upgradeErr := upgrader.Upgrade(c.Writer, c.Request, nil)
	if upgradeErr != nil {
		logging.LogErrorf("ws forward proxy upgrade failed: %s", upgradeErr.Error())
		return
	}
	defer clientConn.Close()

	errChan := make(chan error, 2)
	go func() {
		for {
			msgType, msg, readErr := targetConn.ReadMessage()
			if readErr != nil {
				errChan <- readErr
				return
			}
			if writeErr := clientConn.WriteMessage(msgType, msg); writeErr != nil {
				errChan <- writeErr
				return
			}
		}
	}()
	go func() {
		for {
			msgType, msg, readErr := clientConn.ReadMessage()
			if readErr != nil {
				errChan <- readErr
				return
			}
			if writeErr := targetConn.WriteMessage(msgType, msg); writeErr != nil {
				errChan <- writeErr
				return
			}
		}
	}()
	<-errChan
}

// esProxy proxies an EventSource (SSE) stream from a remote HTTP endpoint.
//
// Query params:
//   - u: RawURLEncoding base64 of the target http/https URL
//   - h: RawURLEncoding base64 of JSON map[string][]string forwarded as request headers
func esProxy(c *gin.Context) {
	targetURL, targetHeaders, err := parseForwardProxyParams(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": -1, "msg": err.Error()})
		return
	}

	if targetURL.Scheme != "http" && targetURL.Scheme != "https" {
		c.JSON(http.StatusBadRequest, gin.H{"code": -1, "msg": "only http/https is allowed"})
		return
	}

	transport := &http.Transport{
		DialContext: ssrfSafeDialer(30 * time.Second).DialContext,
	}
	httpClient := &http.Client{Transport: transport}

	proxyReq, reqErr := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, targetURL.String(), nil)
	if reqErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": -1, "msg": "create request failed: " + reqErr.Error()})
		return
	}
	for k, vs := range *targetHeaders {
		for _, v := range vs {
			proxyReq.Header.Add(k, v)
		}
	}
	if proxyReq.Header.Get("Accept") == "" {
		proxyReq.Header.Set("Accept", "text/event-stream")
	}

	resp, respErr := httpClient.Do(proxyReq)
	if respErr != nil {
		c.JSON(http.StatusBadGateway, gin.H{"code": -1, "msg": "connect target failed: " + respErr.Error()})
		return
	}
	defer resp.Body.Close()

	for k, vs := range resp.Header {
		for _, v := range vs {
			c.Writer.Header().Add(k, v)
		}
	}
	c.Writer.WriteHeader(resp.StatusCode)

	clientGone := c.Writer.CloseNotify()
	buf := make([]byte, 4096)
	for {
		select {
		case <-clientGone:
			return
		default:
			n, readErr := resp.Body.Read(buf)
			if n > 0 {
				if _, writeErr := c.Writer.Write(buf[:n]); writeErr != nil {
					return
				}
				c.Writer.Flush()
			}
			if readErr != nil {
				return
			}
		}
	}
}
