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
	"encoding/base32"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/imroc/req/v3"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const maxForwardProxyResponseSize int64 = 32 * 1024 * 1024

var echo = contractHandler(apicontract.NetworkEcho, echoContract)
var echoPath = contractHandler(apicontract.NetworkEchoPath, echoContract)

func echoContract(c *gin.Context, _ apicontract.EmptyRequest) apicontract.Response[apicontract.NetworkEchoData] {
	var multipartForm *apicontract.NetworkEchoMultipart
	var rawData *string

	if form, err := c.MultipartForm(); err != nil || nil == form {
		multipartForm = nil
	} else {
		multipartForm = &apicontract.NetworkEchoMultipart{
			Value: form.Value,
			File:  map[string][]apicontract.NetworkEchoFile{},
		}
		for k, handlers := range form.File {
			files := make([]apicontract.NetworkEchoFile, len(handlers))
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
		encoded := base64.StdEncoding.EncodeToString(data)
		rawData = &encoded
	} else {
		logging.LogWarnf("echo get raw data error: %s", err.Error())
		rawData = nil
	}

	username, password, ok := c.Request.BasicAuth()

	var params []apicontract.NetworkEchoParam
	if c.Params != nil {
		params = make([]apicontract.NetworkEchoParam, len(c.Params))
		for i, param := range c.Params {
			params[i] = apicontract.NetworkEchoParam{Key: param.Key, Value: param.Value}
		}
	}
	return apicontract.Success(apicontract.NetworkEchoData{
		Context: apicontract.NetworkEchoContext{
			Params:       params,
			HandlerNames: c.HandlerNames(),
			FullPath:     c.FullPath(),
			ClientIP:     c.ClientIP(),
			RemoteIP:     c.RemoteIP(),
			ContentType:  c.ContentType(),
			IsWebsocket:  c.IsWebsocket(),
			RawData:      rawData,
		},
		Request: apicontract.NetworkEchoRequest{
			Method:           c.Request.Method,
			URL:              apicontract.EchoURL(c.Request.URL),
			Proto:            c.Request.Proto,
			ProtoMajor:       c.Request.ProtoMajor,
			ProtoMinor:       c.Request.ProtoMinor,
			Header:           c.Request.Header,
			ContentLength:    c.Request.ContentLength,
			TransferEncoding: c.Request.TransferEncoding,
			Close:            c.Request.Close,
			Host:             c.Request.Host,
			Form:             c.Request.Form,
			PostForm:         c.Request.PostForm,
			MultipartForm:    multipartForm,
			Trailer:          c.Request.Trailer,
			RemoteAddr:       c.Request.RemoteAddr,
			TLS:              apicontract.EchoTLS(c.Request.TLS),
			UserAgent:        c.Request.UserAgent(),
			Cookies:          apicontract.EchoCookies(c.Request.Cookies()),
			Referer:          c.Request.Referer(),
		},
		URL: apicontract.NetworkEchoURLInfo{
			EscapedPath:     c.Request.URL.EscapedPath(),
			EscapedFragment: c.Request.URL.EscapedFragment(),
			String:          c.Request.URL.String(),
			Redacted:        c.Request.URL.Redacted(),
			IsAbs:           c.Request.URL.IsAbs(),
			Query:           c.Request.URL.Query(),
			RequestURI:      c.Request.URL.RequestURI(),
			Hostname:        c.Request.URL.Hostname(),
			Port:            c.Request.URL.Port(),
		},
		User: apicontract.NetworkEchoUser{
			Exists:   ok,
			Username: username,
			Password: password,
		},
	})
}

var forwardProxy = contractHandler(apicontract.NetworkForwardProxy, func(c *gin.Context, input apicontract.NetworkForwardRequest) apicontract.Response[apicontract.NetworkForwardData] {
	destURL := input.URL
	u, e := url.ParseRequestURI(destURL)
	if nil != e {
		return apicontract.Failure[apicontract.NetworkForwardData](1, "invalid [url]")
	}

	if u.Scheme != "http" && u.Scheme != "https" {
		return apicontract.Failure[apicontract.NetworkForwardData](2, "only http/https is allowed")
	}

	options, err := input.Options()
	if err != nil {
		return apicontract.NetworkForwardProxy.DecodeFailure(err)
	}
	method := "POST"
	if methodArg := options.Method; nil != methodArg {
		method = strings.ToUpper(*methodArg)
	}
	timeout := 7000
	if timeoutArg := options.Timeout; nil != timeoutArg {
		timeout = int(*timeoutArg)
		if 1 > timeout {
			timeout = 7000
		}
	}

	client := getSafeClient(time.Duration(timeout) * time.Millisecond)
	responseEncoding := configureForwardProxyClient(client, maxForwardProxyResponseSize, options.ResponseEncoding)
	if options.Redirect != nil && !*options.Redirect {
		client.SetRedirectPolicy(req.NoRedirectPolicy())
	}
	request := client.R()
	for _, pair := range options.Headers {
		for key, value := range pair {
			request.SetHeader(key, fmt.Sprint(networkJSONPayload(value)))
		}
	}

	contentType := "application/json"
	if contentTypeArg := options.ContentType; nil != contentTypeArg {
		contentType = *contentTypeArg
	}
	request.SetHeader("Content-Type", contentType)

	payloadEncoding := "json"
	if payloadEncodingArg := options.PayloadEncoding; nil != payloadEncodingArg {
		payloadEncoding = *payloadEncodingArg
	}

	payloadText, payloadIsText := options.Payload.StringValue()
	switch payloadEncoding {
	case "base64", "base64-std", "base64-url", "base32", "base32-std", "base32-hex", "hex":
		if !payloadIsText {
			return apicontract.Failure[apicontract.NetworkForwardData](-1, "[payload] must be a string")
		}
	}
	switch payloadEncoding {
	case "base64":
		fallthrough
	case "base64-std":
		if payload, err := base64.StdEncoding.DecodeString(payloadText); err != nil {
			return apicontract.Failure[apicontract.NetworkForwardData](3, "decode base64-std payload failed: "+err.Error())
		} else {
			request.SetBody(payload)
		}
	case "base64-url":
		if payload, err := base64.URLEncoding.DecodeString(payloadText); err != nil {
			return apicontract.Failure[apicontract.NetworkForwardData](4, "decode base64-url payload failed: "+err.Error())
		} else {
			request.SetBody(payload)
		}
	case "base32":
		fallthrough
	case "base32-std":
		if payload, err := base32.StdEncoding.DecodeString(payloadText); err != nil {
			return apicontract.Failure[apicontract.NetworkForwardData](5, "decode base32-std payload failed: "+err.Error())
		} else {
			request.SetBody(payload)
		}
	case "base32-hex":
		if payload, err := base32.HexEncoding.DecodeString(payloadText); err != nil {
			return apicontract.Failure[apicontract.NetworkForwardData](6, "decode base32-hex payload failed: "+err.Error())
		} else {
			request.SetBody(payload)
		}
	case "hex":
		if payload, err := hex.DecodeString(payloadText); err != nil {
			return apicontract.Failure[apicontract.NetworkForwardData](7, "decode hex payload failed: "+err.Error())
		} else {
			request.SetBody(payload)
		}
	case "text":
	default:
		request.SetBody(networkJSONPayload(options.Payload))
	}

	started := time.Now()
	resp, bodyData, err := sendForwardProxyRequest(request, method, destURL)
	if errors.Is(err, req.ErrResponseBodyTooLarge) {
		return apicontract.Failure[apicontract.NetworkForwardData](10, fmt.Sprintf("response body too large: limit is %d bytes", maxForwardProxyResponseSize))
	}
	if err != nil {
		return apicontract.Failure[apicontract.NetworkForwardData](8, "forward request failed: "+err.Error())
	}

	elapsed := time.Since(started)

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

	return apicontract.Success(apicontract.NetworkForwardData{URL: destURL, Status: resp.StatusCode, ContentType: resp.GetHeader("content-type"), Body: body, BodyEncoding: responseEncoding, Headers: resp.Header, Elapsed: elapsed.Milliseconds()})
})

// 任意 JSON 载荷按代理客户端的字符串、标量与复合值规则传输。
func networkJSONPayload(value apicontract.JSONValue) any {
	encoded, err := value.MarshalJSON()
	if err != nil {
		panic(err)
	}
	var payload any
	if err := json.Unmarshal(encoded, &payload); err != nil {
		panic(err)
	}
	return payload
}

func configureForwardProxyClient(client *req.Client, maxResponseSize int64, value any) string {
	client.SetMaxResponseSize(maxResponseSize)

	responseEncoding, ok := value.(string)
	if !ok {
		return "text"
	}

	switch responseEncoding {
	case "base64", "base64-std", "base64-url", "base32", "base32-std", "base32-hex", "hex":
		client.DisableAutoDecode()
		return responseEncoding
	default:
		return "text"
	}
}

func sendForwardProxyRequest(request *req.Request, method, destURL string) (response *req.Response, body []byte, err error) {
	response, err = request.Send(method, destURL)
	if err != nil {
		return
	}
	body = response.Bytes()
	return
}

// 创建安全的 HTTP Client，防止 SSRF 和 DNS 重绑定
func getSafeClient(timeout time.Duration) *req.Client {
	dialer := util.SSRFSafeDialer(timeout)

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
//   - `timeout`: The timeout for the request in nanoseconds.
func parseForwardProxyParams(c *gin.Context) (parsedURL *url.URL, headers *http.Header, timeout time.Duration, err error) {
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
	if hParam != "" {
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
	}

	timeout = 30 * time.Second
	tParam := c.Query("t")
	if tParam != "" {
		if t, parseErr := time.ParseDuration(tParam); parseErr != nil {
			err = fmt.Errorf("parse [t] failed: %s", parseErr.Error())
			return
		} else {
			timeout = t
		}
	}

	return
}

// forwardResponseHeaders copies src headers into dst with a "Siyuan-Proxy-" prefix on each key.
func forwardResponseHeaders(dst http.Header, src http.Header) {
	for k, vs := range src {
		for _, v := range vs {
			dst.Add("Siyuan-Proxy-"+k, v)
		}
	}
}

// secureProxyResponseHeaders 为代理响应设置安全头和固定内容类型，
// 防止上游可控内容被浏览器嗅探为 HTML 造成同源脚本执行
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-2w6q-wgc8-q743
func secureProxyResponseHeaders(w gin.ResponseWriter, contentType string, attachment bool) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Type", contentType)
	if attachment {
		w.Header().Set("Content-Disposition", "attachment")
	}
}

// httpProxy proxies an HTTP request to a remote HTTP endpoint.
//
// Query params:
//   - u: RawURLEncoding base64 of the target http/https URL
//   - h: RawURLEncoding base64 of JSON map[string][]string forwarded as request headers
//
// The request method and body are taken from the incoming request.
// Target response headers are forwarded with a "Siyuan-Proxy-" prefix.
var httpProxy = contractHandler(apicontract.NetworkHTTPProxy, func(c *gin.Context, _ apicontract.EmptyRequest) apicontract.Response[apicontract.ProxyFailure] {
	targetURL, targetHeaders, timeout, err := parseForwardProxyParams(c)
	if err != nil {
		return apicontract.RejectProxy(http.StatusBadRequest, err.Error())
	}

	if targetURL.Scheme != "http" && targetURL.Scheme != "https" {
		return apicontract.RejectProxy(http.StatusBadRequest, "only http/https is allowed")
	}

	transport := &http.Transport{
		DialContext: util.SSRFSafeDialer(timeout).DialContext,
	}
	httpClient := &http.Client{Transport: transport}

	proxyReq, reqErr := http.NewRequestWithContext(c.Request.Context(), c.Request.Method, targetURL.String(), c.Request.Body)
	if reqErr != nil {
		return apicontract.RejectProxy(http.StatusBadRequest, "create request failed: "+reqErr.Error())
	}

	proxyReq.ContentLength = c.Request.ContentLength

	contentType := c.Request.Header.Get("Content-Type")
	if contentType != "" {
		proxyReq.Header.Set("Content-Type", contentType)
	}

	for k, vs := range *targetHeaders {
		for _, v := range vs {
			proxyReq.Header.Add(k, v)
		}
	}

	resp, respErr := httpClient.Do(proxyReq)
	if respErr != nil {
		return apicontract.RejectProxy(http.StatusBadGateway, "connect target failed: "+respErr.Error())
	}
	return apicontract.StreamProxy(resp.StatusCode, func(_ http.ResponseWriter, _ *http.Request) {
		defer resp.Body.Close()

		secureProxyResponseHeaders(c.Writer, "application/octet-stream", true)
		forwardResponseHeaders(c.Writer.Header(), resp.Header)
		c.Writer.WriteHeader(resp.StatusCode)
		if _, err := io.Copy(c.Writer, resp.Body); err != nil {
			logging.LogWarnf("http proxy copy response failed: %s", err.Error())
		}
	})
})

// wsProxy proxies a WebSocket connection to a remote WebSocket endpoint.
//
// Query params:
//   - u: RawURLEncoding base64 of the target ws/wss URL
//   - h: RawURLEncoding base64 of JSON map[string][]string forwarded as handshake headers
//
// Target response headers are forwarded with a "Siyuan-Proxy-" prefix.
var wsProxy = contractHandler(apicontract.NetworkWebSocketProxy, func(c *gin.Context, _ apicontract.EmptyRequest) apicontract.Response[apicontract.ProxyFailure] {
	targetURL, targetHeaders, timeout, err := parseForwardProxyParams(c)
	if err != nil {
		return apicontract.RejectProxy(http.StatusBadRequest, err.Error())
	}

	if targetURL.Scheme != "ws" && targetURL.Scheme != "wss" {
		return apicontract.RejectProxy(http.StatusBadRequest, "only ws/wss is allowed")
	}

	wsDialer := &websocket.Dialer{
		NetDialContext:   util.SSRFSafeDialer(timeout).DialContext,
		HandshakeTimeout: timeout,
	}

	targetConn, targetResp, dialErr := wsDialer.DialContext(c.Request.Context(), targetURL.String(), *targetHeaders)
	if dialErr != nil {
		return apicontract.RejectProxy(http.StatusBadGateway, "dial target failed: "+dialErr.Error())
	}
	return apicontract.StreamProxy(http.StatusSwitchingProtocols, func(_ http.ResponseWriter, _ *http.Request) {
		defer targetConn.Close()

		upgradeHeaders := http.Header{}
		if targetResp != nil {
			forwardResponseHeaders(upgradeHeaders, targetResp.Header)
		}
		upgrader := websocket.Upgrader{
			// 校验 Origin，防止跨站 WebSocket 劫持（CSWSH） https://github.com/siyuan-note/siyuan/security/advisories/GHSA-3cc2-h3v6-rqpq
			CheckOrigin: func(r *http.Request) bool {
				return util.IsSessionOriginAllowedRequest(r)
			},
		}
		clientConn, upgradeErr := upgrader.Upgrade(c.Writer, c.Request, upgradeHeaders)
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
					if closeError, ok := readErr.(*websocket.CloseError); ok {
						clientConn.WriteMessage(
							websocket.CloseMessage,
							websocket.FormatCloseMessage(
								closeError.Code,
								closeError.Text,
							),
						)
					}
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
					if closeError, ok := readErr.(*websocket.CloseError); ok {
						targetConn.WriteMessage(
							websocket.CloseMessage,
							websocket.FormatCloseMessage(
								closeError.Code,
								closeError.Text,
							),
						)
					}
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
	})
})

// esProxy proxies an EventSource (SSE) stream from a remote HTTP endpoint.
//
// Query params:
//   - u: RawURLEncoding base64 of the target http/https URL
//   - h: RawURLEncoding base64 of JSON map[string][]string forwarded as request headers
//
// Target response headers are forwarded with a "Siyuan-Proxy-" prefix.
var esProxy = contractHandler(apicontract.NetworkEventSourceProxy, func(c *gin.Context, _ apicontract.EmptyRequest) apicontract.Response[apicontract.ProxyFailure] {
	targetURL, targetHeaders, timeout, err := parseForwardProxyParams(c)
	if err != nil {
		return apicontract.RejectProxy(http.StatusBadRequest, err.Error())
	}

	if targetURL.Scheme != "http" && targetURL.Scheme != "https" {
		return apicontract.RejectProxy(http.StatusBadRequest, "only http/https is allowed")
	}

	transport := &http.Transport{
		DialContext: util.SSRFSafeDialer(timeout).DialContext,
	}
	httpClient := &http.Client{Transport: transport}

	proxyReq, reqErr := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, targetURL.String(), nil)
	if reqErr != nil {
		return apicontract.RejectProxy(http.StatusBadRequest, "create request failed: "+reqErr.Error())
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
		return apicontract.RejectProxy(http.StatusBadGateway, "connect target failed: "+respErr.Error())
	}
	return apicontract.StreamProxy(resp.StatusCode, func(_ http.ResponseWriter, _ *http.Request) {
		defer resp.Body.Close()

		secureProxyResponseHeaders(c.Writer, "text/event-stream; charset=utf-8", false)
		forwardResponseHeaders(c.Writer.Header(), resp.Header)
		c.Writer.WriteHeader(resp.StatusCode)

		buf := make([]byte, 4096)
		for {
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
	})
})
