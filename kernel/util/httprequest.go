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

package util

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/siyuan-note/httpclient"
	golangProxy "golang.org/x/net/proxy"
)

const (
	maxHTTPRequestBytes     = 5 * 1024 * 1024  // text/html、text/plain、application/json 等文本类响应上限
	maxHTTPRequestFileBytes = 10 * 1024 * 1024 // 二进制响应落盘上限
	maxHTTPRequestChars     = 50000
)

// CheckHostSSRF 校验主机名解析出的 IP 不落在内网/回环等不可达地址段，
// 防止智能体被诱导发起 SSRF 攻击。web_fetch 与 http_request 共用此校验。
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-rg26-cg95-gq6p
func CheckHostSSRF(host string) error {
	ips, err := net.LookupIP(host)
	if err != nil {
		return errors.New("failed to resolve host: " + err.Error())
	}
	for _, ip := range ips {
		// 与 SSRFSafeDialer 共用 isPrivateIP，覆盖 NAT64、6to4、Teredo 等 IPv6 过渡地址。
		if isPrivateIP(ip) {
			return errors.New("access to private/internal IP is prohibited")
		}
	}
	return nil
}

// ssrfSafeClient 是智能体出站请求专用的 HTTP 客户端：直连时将目标固定到已校验的公网 IP，
// 使用代理时则先与用户配置的代理建立隧道，再通过隧道连接固定后的目标 IP，同时保留原始 Host 和 TLS SNI。
// 两种方式都不会在校验后再次按目标域名解析，避免 DNS 重绑定 TOCTOU 绕过。
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-x8gv-g2g3-65fj
var ssrfSafeClient = newSSRFSafeClient()

func newSSRFSafeClient() *http.Client {
	return newSSRFSafeClientWithResolver(net.DefaultResolver.LookupIPAddr)
}

type lookupIPAddrFunc func(context.Context, string) ([]net.IPAddr, error)

type ssrfSafeTransport struct {
	directTransport *http.Transport
	lookupIPAddr    lookupIPAddrFunc
}

func newSSRFSafeClientWithResolver(lookupIPAddr lookupIPAddrFunc) *http.Client {
	directTransport := httpclient.NewTransport(false)
	directTransport.Proxy = nil
	directTransport.DialContext = ssrfSafeDialContext(30 * time.Second)
	transport := &ssrfSafeTransport{directTransport: directTransport, lookupIPAddr: lookupIPAddr}
	return &http.Client{Timeout: 30 * time.Second, Transport: &httpclient.UserAgentTransport{Base: transport}}
}

func (t *ssrfSafeTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	proxyURL, err := httpclient.ProxyFromEnvironment(req)
	if err != nil {
		return nil, err
	}
	if proxyURL == nil {
		return t.directTransport.RoundTrip(req)
	}

	targetAddr, err := t.resolvePublicTarget(req.Context(), req.URL)
	if err != nil {
		return nil, err
	}
	conn, reader, err := dialProxyTunnel(req.Context(), proxyURL, targetAddr)
	if err != nil {
		return nil, err
	}

	if req.URL.Scheme == "https" {
		if reader.Buffered() != 0 {
			conn.Close()
			return nil, errors.New("proxy returned unexpected tunnel data")
		}
		tlsConn := tls.Client(conn, &tls.Config{ServerName: req.URL.Hostname(), NextProtos: []string{"http/1.1"}})
		if err = tlsConn.HandshakeContext(req.Context()); err != nil {
			conn.Close()
			return nil, err
		}
		conn = tlsConn
		reader = bufio.NewReader(conn)
	}

	targetReq := req.Clone(req.Context())
	targetReq.URL = cloneURL(req.URL)
	targetReq.URL.Scheme = ""
	targetReq.URL.Host = ""
	targetReq.RequestURI = ""
	targetReq.Header.Del("Proxy-Authorization")
	if targetReq.Host == "" {
		targetReq.Host = req.URL.Host
	}
	if err = targetReq.Write(conn); err != nil {
		conn.Close()
		return nil, err
	}
	resp, err := http.ReadResponse(reader, targetReq)
	if err != nil {
		conn.Close()
		return nil, err
	}
	resp.Request = req
	resp.Body = newConnectionReadCloser(req.Context(), resp.Body, conn)
	return resp, nil
}

func (t *ssrfSafeTransport) resolvePublicTarget(ctx context.Context, targetURL *url.URL) (string, error) {
	host := targetURL.Hostname()
	port := targetURL.Port()
	if port == "" {
		switch targetURL.Scheme {
		case "http":
			port = "80"
		case "https":
			port = "443"
		default:
			return "", errors.New("URL must start with http:// or https://")
		}
	}

	if ip := net.ParseIP(host); ip != nil {
		if isPrivateIP(ip) {
			return "", errors.New("access to private/internal IP is prohibited")
		}
		return net.JoinHostPort(ip.String(), port), nil
	}

	ips, err := t.lookupIPAddr(ctx, host)
	if err != nil {
		return "", errors.New("failed to resolve host: " + err.Error())
	}
	if len(ips) == 0 {
		return "", errors.New("host has no IP address: " + host)
	}
	for _, ipAddr := range ips {
		if isPrivateIP(ipAddr.IP) {
			return "", errors.New("access to private/internal IP is prohibited")
		}
	}
	return net.JoinHostPort(ips[0].IP.String(), port), nil
}

func cloneURL(src *url.URL) *url.URL {
	ret := *src
	return &ret
}

func dialProxyTunnel(ctx context.Context, proxyURL *url.URL, targetAddr string) (net.Conn, *bufio.Reader, error) {
	proxyAddr, err := proxyAddress(proxyURL)
	if err != nil {
		return nil, nil, err
	}
	dialer := &net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}
	if strings.EqualFold(proxyURL.Scheme, "socks5") || strings.EqualFold(proxyURL.Scheme, "socks5h") {
		var auth *golangProxy.Auth
		if proxyURL.User != nil {
			password, _ := proxyURL.User.Password()
			auth = &golangProxy.Auth{User: proxyURL.User.Username(), Password: password}
		}
		socksDialer, err := golangProxy.SOCKS5("tcp", proxyAddr, auth, dialer)
		if err != nil {
			return nil, nil, err
		}
		contextDialer, ok := socksDialer.(golangProxy.ContextDialer)
		if !ok {
			return nil, nil, errors.New("SOCKS5 proxy does not support context dialing")
		}
		conn, err := contextDialer.DialContext(ctx, "tcp", targetAddr)
		if err != nil {
			return nil, nil, err
		}
		return conn, bufio.NewReader(conn), nil
	}

	conn, err := dialer.DialContext(ctx, "tcp", proxyAddr)
	if err != nil {
		return nil, nil, err
	}
	if strings.EqualFold(proxyURL.Scheme, "https") {
		tlsConn := tls.Client(conn, &tls.Config{ServerName: proxyURL.Hostname(), NextProtos: []string{"http/1.1"}})
		if err = tlsConn.HandshakeContext(ctx); err != nil {
			conn.Close()
			return nil, nil, err
		}
		conn = tlsConn
	}

	connectReq := &http.Request{
		Method: http.MethodConnect,
		URL:    &url.URL{Opaque: targetAddr},
		Host:   targetAddr,
		Header: make(http.Header),
	}
	if proxyURL.User != nil {
		password, _ := proxyURL.User.Password()
		credentials := proxyURL.User.Username() + ":" + password
		connectReq.Header.Set("Proxy-Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(credentials)))
	}
	if err = connectReq.Write(conn); err != nil {
		conn.Close()
		return nil, nil, err
	}
	reader := bufio.NewReader(conn)
	resp, err := http.ReadResponse(reader, connectReq)
	if err != nil {
		conn.Close()
		return nil, nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		conn.Close()
		return nil, nil, fmt.Errorf("proxy CONNECT returned %s", resp.Status)
	}
	return conn, reader, nil
}

func proxyAddress(proxyURL *url.URL) (string, error) {
	port := proxyURL.Port()
	if port == "" {
		switch strings.ToLower(proxyURL.Scheme) {
		case "http":
			port = "80"
		case "https":
			port = "443"
		case "socks5", "socks5h":
			port = "1080"
		default:
			return "", errors.New("agent HTTP tools support HTTP, HTTPS and SOCKS5 proxies")
		}
	}
	return net.JoinHostPort(proxyURL.Hostname(), port), nil
}

type connectionReadCloser struct {
	io.ReadCloser
	conn      net.Conn
	done      chan struct{}
	closeOnce sync.Once
	closeErr  error
}

func newConnectionReadCloser(ctx context.Context, body io.ReadCloser, conn net.Conn) *connectionReadCloser {
	ret := &connectionReadCloser{ReadCloser: body, conn: conn, done: make(chan struct{})}
	go func() {
		select {
		case <-ctx.Done():
			conn.Close()
		case <-ret.done:
		}
	}()
	return ret
}

func (c *connectionReadCloser) Close() error {
	c.closeOnce.Do(func() {
		close(c.done)
		c.closeErr = c.ReadCloser.Close()
		c.conn.Close()
	})
	return c.closeErr
}

// HTTPRequest 发起一次通用 HTTP 调用，供智能体 http_request 工具使用。
// 与 WebFetch 不同：本函数不做 HTML→Markdown 转换，文本类响应（含 JSON/XML）原样返回，
// 便于智能体直接消费 REST API 的 JSON 输出。method 取值：GET/POST/PUT/DELETE/PATCH。
// 返回的 text 为响应正文（文本类）或落盘后的文件路径（二进制类）。
func HTTPRequest(method, rawURL string, headers map[string]string, body string) (statusCode int, contentType string, text string, err error) {
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") {
		return 0, "", "", errors.New("URL must start with http:// or https://")
	}
	if u.Host == "" {
		return 0, "", "", errors.New("URL has no host")
	}

	if serr := CheckHostSSRF(u.Hostname()); serr != nil {
		return 0, "", "", serr
	}

	method = strings.ToUpper(strings.TrimSpace(method))
	if method == "" {
		method = "GET"
	}

	var reqBody io.Reader
	if body != "" && method != "GET" && method != "HEAD" {
		reqBody = strings.NewReader(body)
	}
	req, err := http.NewRequest(method, rawURL, reqBody)
	if err != nil {
		return 0, "", "", errors.New("invalid request: " + err.Error())
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := ssrfSafeClient.Do(req)
	if err != nil {
		return 0, "", "", errors.New("request failed: " + err.Error())
	}
	if resp == nil {
		return 0, "", "", errors.New("nil response")
	}
	defer resp.Body.Close()

	statusCode = resp.StatusCode
	contentType = resp.Header.Get("Content-Type")

	maxReadBytes := int64(maxHTTPRequestBytes)
	if !isTextContentType(contentType) {
		maxReadBytes = maxHTTPRequestFileBytes
	}
	// ContentLength 为 -1（chunked）时跳过大小预检，交由 LimitReader 兜底截断。
	if resp.ContentLength > maxReadBytes {
		return statusCode, contentType, "", errors.New("response too large")
	}

	respBody, rerr := io.ReadAll(io.LimitReader(resp.Body, maxReadBytes))
	if rerr != nil {
		return statusCode, contentType, "", errors.New("read body failed: " + rerr.Error())
	}

	// 二进制响应落盘，返回文件路径，供智能体按需进一步处理。
	if !isTextContentType(contentType) {
		importDir := filepath.Join(TempDir, "import")
		if merr := os.MkdirAll(importDir, 0755); merr != nil {
			return statusCode, contentType, "", errors.New("create import dir failed: " + merr.Error())
		}
		filename := extractFilename(rawURL, contentType)
		filePath := filepath.Join(importDir, filename)
		if werr := os.WriteFile(filePath, respBody, 0644); werr != nil {
			return statusCode, contentType, "", errors.New("write file failed: " + werr.Error())
		}
		return statusCode, contentType, fmt.Sprintf("Saved to: %s (%d bytes)", filePath, len(respBody)), nil
	}

	return statusCode, contentType, truncateRunes(string(respBody), maxHTTPRequestChars), nil
}

// isTextContentType 判断 Content-Type 是否为可直接展示给智能体的文本类响应。
// 覆盖 text/*、application/json、application/xml、application/*+json 等。
func isTextContentType(contentType string) bool {
	ct := strings.ToLower(strings.TrimSpace(strings.SplitN(contentType, ";", 2)[0]))
	if ct == "" {
		return false
	}
	if strings.HasPrefix(ct, "text/") {
		return true
	}
	switch ct {
	case "application/json", "application/xml":
		return true
	}
	if strings.HasPrefix(ct, "application/") && (strings.HasSuffix(ct, "+json") || strings.HasSuffix(ct, "+xml")) {
		return true
	}
	return false
}
