// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

// Package templatehttp 为一次模板求值提供有界、须确认的公网数据读取。
package templatehttp

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"text/template"
	"time"
)

const (
	maxRequests          = 32
	maxCalls             = 1024
	maxBody              = 1 << 20
	maxTotalBody         = 8 << 20
	maxOutput            = 8 << 20
	maxRedirects         = 3
	maxDuration          = 2 * time.Minute
	maxNetworkDuration   = 30 * time.Second
	maxRequestDuration   = 10 * time.Second
	confirmationDuration = time.Minute
)

var networkSlots = make(chan struct{}, 4)

// Request 只包含可以展示的目标信息，查询参数值及请求头值不会发送给界面。
type Request struct {
	Method      string   `json:"method"`
	URL         string   `json:"url"`
	HeaderNames []string `json:"headerNames"`
	Scope       string   `json:"-"`
}

type result struct {
	OK          bool
	Status      int
	Body, Error string
}

func (r result) value() map[string]any {
	return map[string]any{"ok": r.OK, "status": r.Status, "body": r.Body, "error": r.Error}
}

// Execution 的缓存只存在于本次求值，调用者必须在数据范围失效时取消 ctx。
type Execution struct {
	ctx                    context.Context
	cancel                 context.CancelFunc
	scope                  string
	confirm                func(context.Context, Request) bool
	serial                 chan struct{}
	mu                     sync.Mutex
	cache                  map[[32]byte]result
	onError                func(string)
	preflightErrors        map[string]struct{}
	outputBytes            int
	outputExceeded         bool
	requests, bytes, calls int
	networkTime            time.Duration
	transport              http.RoundTripper
}

func New(ctx context.Context, scope string, confirm func(context.Context, Request) bool) *Execution {
	ctx, cancel := context.WithTimeout(ctx, maxDuration)
	return &Execution{ctx: ctx, cancel: cancel, scope: scope, confirm: confirm,
		serial: make(chan struct{}, 1), cache: make(map[[32]byte]result), transport: newTransport()}
}

func (e *Execution) Funcs() template.FuncMap { return e.FuncsForScope(e.scope) }

// FuncsForScope 让关联数据库共享预算，但不共享不同数据范围的结果。
func (e *Execution) FuncsForScope(scope string) template.FuncMap {
	return template.FuncMap{"httpGet": func(rawURL string, options ...map[string]any) (map[string]any, error) {
		ret := e.getScoped(scope, rawURL, options...)
		if err := e.Err(); err != nil {
			return nil, err
		}
		return ret, nil
	}}
}
func (e *Execution) Err() error { return e.ctx.Err() }

// Writer 在每次输出前检查取消和共享输出预算，不能抢占没有函数调用或输出的纯计算。
func (e *Execution) Writer(destination io.Writer) io.Writer {
	return executionWriter{execution: e, destination: destination}
}

type executionWriter struct {
	execution   *Execution
	destination io.Writer
}

func (w executionWriter) Write(data []byte) (int, error) {
	e := w.execution
	if err := e.Err(); err != nil {
		return 0, err
	}
	e.mu.Lock()
	exceeded := e.outputExceeded || len(data) > maxOutput-e.outputBytes
	notify := exceeded && !e.outputExceeded
	if exceeded {
		e.outputExceeded = true
	} else {
		e.outputBytes += len(data)
	}
	e.mu.Unlock()
	if exceeded {
		if notify {
			e.notifyError("budget_exceeded")
		}
		e.Close()
		return 0, errOutputLimit
	}
	if err := e.Err(); err != nil {
		return 0, err
	}
	return w.destination.Write(data)
}

// SetErrorHandler 仅传递固定错误码，不传递地址、请求头或响应正文。
func (e *Execution) SetErrorHandler(handler func(code string)) {
	e.mu.Lock()
	e.onError = handler
	e.mu.Unlock()
}

func (e *Execution) notifyError(code string) {
	e.mu.Lock()
	handler := e.onError
	e.mu.Unlock()
	if handler != nil {
		handler(code)
	}
}

// preflightFailure 按固定错误码去重，避免无效参数的循环重复显示相同提示。
func (e *Execution) preflightFailure(code string) map[string]any {
	e.mu.Lock()
	if e.preflightErrors == nil {
		e.preflightErrors = make(map[string]struct{})
	}
	_, notified := e.preflightErrors[code]
	e.preflightErrors[code] = struct{}{}
	e.mu.Unlock()
	if !notified && e.Err() == nil {
		e.notifyError(code)
	}
	if e.Err() != nil {
		return result{Error: "execution_ended"}.value()
	}
	return result{Error: code}.value()
}

func (e *Execution) Close() {
	e.cancel()
	e.mu.Lock()
	clear(e.cache)
	e.mu.Unlock()
	if transport, ok := e.transport.(*http.Transport); ok {
		transport.CloseIdleConnections()
	}
}

// Get 允许模板通过 ok/error 分支处理网络故障，不把外部正文解释为模板。
func (e *Execution) Get(rawURL string, options ...map[string]any) map[string]any {
	return e.getScoped(e.scope, rawURL, options...)
}

func (e *Execution) getScoped(scope, rawURL string, options ...map[string]any) map[string]any {
	select {
	case e.serial <- struct{}{}:
		defer func() { <-e.serial }()
	case <-e.ctx.Done():
		return result{Error: "execution_ended"}.value()
	}
	if e.ctx.Err() != nil {
		return result{Error: "execution_ended"}.value()
	}
	e.calls++
	if e.calls > maxCalls {
		e.notifyError("budget_exceeded")
		e.Close()
		return result{Error: "budget_exceeded"}.value()
	}
	u, err := validateURL(rawURL)
	if err != nil {
		return e.preflightFailure("invalid_target")
	}
	headers, timeout, err := parseOptions(options)
	if err != nil {
		return e.preflightFailure("invalid_options")
	}
	keyData, _ := json.Marshal([]any{e.scope, scope, u.String(), headers, timeout})
	key := sha256.Sum256(keyData)
	e.mu.Lock()
	cached, exists := e.cache[key]
	e.mu.Unlock()
	if exists {
		if e.ctx.Err() != nil {
			return result{Error: "execution_ended"}.value()
		}
		return cached.value()
	}
	if e.confirm == nil {
		return e.preflightFailure("interaction_required")
	}
	r := e.get(scope, u, headers, timeout)
	if r.Error == "budget_exceeded" {
		e.notifyError(r.Error)
		e.Close()
		return r.value()
	}
	if e.ctx.Err() != nil {
		return result{Error: "execution_ended"}.value()
	}
	e.mu.Lock()
	if e.ctx.Err() == nil {
		e.cache[key] = r
	}
	e.mu.Unlock()
	if !r.OK {
		e.notifyError(r.Error)
	}
	if e.ctx.Err() != nil {
		return result{Error: "execution_ended"}.value()
	}
	return r.value()
}

func (e *Execution) get(scope string, u *url.URL, headers http.Header, timeout time.Duration) result {
	for redirect := 0; ; redirect++ {
		if e.requests >= maxRequests || e.bytes >= maxTotalBody || e.networkTime >= maxNetworkDuration {
			return result{Error: "budget_exceeded"}
		}
		e.requests++
		names := make([]string, 0, len(headers))
		for name := range headers {
			names = append(names, name)
		}
		sort.Strings(names)
		confirmCtx, cancelConfirm := context.WithTimeout(e.ctx, confirmationDuration)
		approved := e.confirm(confirmCtx, Request{Method: http.MethodGet, URL: displayURL(u), HeaderNames: names, Scope: scope})
		confirmErr := confirmCtx.Err()
		cancelConfirm()
		if e.ctx.Err() != nil {
			return result{Error: "execution_ended"}
		}
		if confirmErr != nil {
			return result{Error: "confirmation_timeout"}
		}
		if !approved {
			return result{Error: "denied"}
		}
		remaining := maxNetworkDuration - e.networkTime
		if timeout > remaining {
			timeout = remaining
		}
		networkCtx, cancelNetwork := context.WithTimeout(e.ctx, timeout)
		select {
		case networkSlots <- struct{}{}:
		case <-networkCtx.Done():
			cancelNetwork()
			return result{Error: "timeout"}
		}
		started := time.Now()
		req, _ := http.NewRequestWithContext(networkCtx, http.MethodGet, u.String(), nil)
		req.Header = headers.Clone()
		resp, requestErr := e.transport.RoundTrip(req)
		var body []byte
		if requestErr == nil {
			limit := min(maxBody, maxTotalBody-e.bytes)
			body, requestErr = io.ReadAll(io.LimitReader(resp.Body, int64(limit+1)))
			resp.Body.Close()
			if len(body) > limit {
				requestErr = errBodyLimit
			}
			e.bytes += len(body)
		}
		e.networkTime += time.Since(started)
		networkErr := networkCtx.Err()
		cancelNetwork()
		<-networkSlots
		if e.ctx.Err() != nil {
			return result{Error: "execution_ended"}
		}
		if requestErr != nil {
			code := "network_error"
			var timeoutErr net.Error
			if errors.As(requestErr, &timeoutErr) && timeoutErr.Timeout() {
				code = "timeout"
			}
			if errors.Is(requestErr, errBodyLimit) {
				code = "response_too_large"
			}
			if errors.Is(requestErr, errUnsafeAddress) {
				code = "unsafe_target"
			}
			if networkErr != nil {
				code = "timeout"
			}
			return result{Error: code}
		}
		if isRedirect(resp.StatusCode) && resp.Header.Get("Location") != "" {
			if redirect >= maxRedirects {
				return result{Status: resp.StatusCode, Error: "redirect_limit"}
			}
			next, err := u.Parse(resp.Header.Get("Location"))
			if err != nil {
				return result{Error: "invalid_target"}
			}
			next, err = validateURL(next.String())
			if err != nil {
				return result{Error: "invalid_target"}
			}
			// 跨来源清空所有自定义头，避免 API 密钥通过非标准头泄漏。
			if next.Scheme != u.Scheme || !strings.EqualFold(next.Host, u.Host) {
				headers = make(http.Header)
			}
			u = next
			continue
		}
		r := result{OK: resp.StatusCode >= 200 && resp.StatusCode < 300, Status: resp.StatusCode, Body: string(body)}
		if !r.OK {
			r.Error = "http_status"
		}
		return r
	}
}

var errBodyLimit = errors.New("template HTTP response exceeds limit")
var errOutputLimit = errors.New("template output exceeds limit")
var errUnsafeAddress = errors.New("template HTTP target is not public")

func validateURL(raw string) (*url.URL, error) {
	if len(raw) > 4096 {
		return nil, errUnsafeAddress
	}
	u, err := url.Parse(raw)
	if err != nil || u == nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || u.Opaque != "" {
		return nil, errUnsafeAddress
	}
	if strings.ContainsAny(u.Hostname(), "%\\") {
		return nil, errUnsafeAddress
	}
	if port := u.Port(); port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || n < 1 || n > 65535 {
			return nil, errUnsafeAddress
		}
	}
	if ip, err := netip.ParseAddr(u.Hostname()); err == nil && unsafeIP(ip) {
		return nil, errUnsafeAddress
	}
	u.Fragment = ""
	u.RawFragment = ""
	return u, nil
}

func displayURL(u *url.URL) string {
	copy := *u
	query := copy.Query()
	for key := range query {
		query[key] = []string{"[redacted]"}
	}
	copy.RawQuery = query.Encode()
	return copy.String()
}

func parseOptions(options []map[string]any) (http.Header, time.Duration, error) {
	headers := make(http.Header)
	timeout := maxRequestDuration
	if len(options) > 1 {
		return nil, 0, errors.New("options")
	}
	if len(options) == 0 {
		return headers, timeout, nil
	}
	for key, value := range options[0] {
		switch key {
		case "timeout":
			seconds, err := strconv.ParseFloat(strings.TrimSpace(toNumber(value)), 64)
			if err != nil || !(seconds > 0 && seconds <= maxRequestDuration.Seconds()) {
				return nil, 0, errors.New("timeout")
			}
			timeout = time.Duration(seconds * float64(time.Second))
		case "headers":
			values, ok := value.(map[string]any)
			if !ok {
				return nil, 0, errors.New("headers")
			}
			total := 0
			for name, value := range values {
				text, ok := value.(string)
				if !ok || !validHeaderName(name) || strings.ContainsAny(text, "\r\n\x00") {
					return nil, 0, errors.New("headers")
				}
				switch strings.ToLower(name) {
				case "host", "connection", "proxy-authorization", "proxy-connection", "transfer-encoding", "content-length", "upgrade", "trailer", "te", "referer", "accept-encoding":
					return nil, 0, errors.New("headers")
				}
				total += len(name) + len(text)
				if len(values) > 32 || total > 8192 {
					return nil, 0, errors.New("headers")
				}
				headers.Set(name, text)
			}
		default:
			return nil, 0, errors.New("options")
		}
	}
	return headers, timeout, nil
}

func toNumber(value any) string {
	switch n := value.(type) {
	case int:
		return strconv.Itoa(n)
	case int64:
		return strconv.FormatInt(n, 10)
	case float64:
		return strconv.FormatFloat(n, 'g', -1, 64)
	case string:
		return n
	default:
		return ""
	}
}

func validHeaderName(name string) bool {
	if name == "" {
		return false
	}
	for _, c := range name {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || strings.ContainsRune("!#$%&'*+-.^_`|~", c)) {
			return false
		}
	}
	return true
}

func isRedirect(status int) bool {
	return status == 301 || status == 302 || status == 303 || status == 307 || status == 308
}

func newTransport() *http.Transport {
	dialer := &net.Dialer{Timeout: 5 * time.Second, Control: func(_, address string, _ syscall.RawConn) error {
		host, _, err := net.SplitHostPort(address)
		if err != nil {
			return errUnsafeAddress
		}
		ip, err := netip.ParseAddr(host)
		if err != nil || unsafeIP(ip) {
			return errUnsafeAddress
		}
		return nil
	}}
	// Control 校验 DNS 解析后的实际连接地址；不使用环境代理或连接复用。
	return &http.Transport{Proxy: nil, DialContext: dialer.DialContext, DisableKeepAlives: true,
		TLSHandshakeTimeout: 5 * time.Second, ResponseHeaderTimeout: 10 * time.Second, MaxResponseHeaderBytes: 32 << 10}
}

var forbiddenPrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.88.99.0/24"), netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"), netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("240.0.0.0/4"), netip.MustParsePrefix("2001::/23"),
	netip.MustParsePrefix("2001:db8::/32"), netip.MustParsePrefix("2002::/16"),
	netip.MustParsePrefix("3fff::/20"),
}

func unsafeIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsValid() || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.Zone() != "" {
		return true
	}
	// IPv6 只允许全球单播分配范围，阻止 NAT64、IPv4 兼容及本地转换地址。
	if ip.Is6() && !netip.MustParsePrefix("2000::/3").Contains(ip) {
		return true
	}
	for _, prefix := range forbiddenPrefixes {
		if prefix.Contains(ip) {
			return true
		}
	}
	return false
}
