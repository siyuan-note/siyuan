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
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/imroc/req/v3"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
)

var auditedAddresses sync.Map // 用于记录已审计的 SSRF 地址，避免重复日志输出

// GetPrivateIPv4s 获取本地所有的私有 IPv4 地址（排除虚拟网卡）
func GetPrivateIPv4s() (ret []string) {
	ret = []string{}

	interfaces, err := net.Interfaces()
	if err != nil {
		return
	}

	// 常见的虚拟网卡名称关键字黑名单
	virtualKeywords := []string{"docker", "veth", "br-", "vmnet", "vbox", "utun", "tun", "tap", "bridge", "cloud", "hyper-"}

	for _, itf := range interfaces {
		// 1. 基础状态过滤：必须是启动状态且不能是回环网卡
		if itf.Flags&net.FlagUp == 0 || itf.Flags&net.FlagLoopback != 0 {
			continue
		}

		// 2. 硬件地址过滤：物理网卡通常必须有 MAC 地址
		if len(itf.HardwareAddr) == 0 {
			continue
		}

		// 3. 名称过滤：排除已知虚拟网卡前缀
		name := strings.ToLower(itf.Name)
		isVirtual := false
		for _, kw := range virtualKeywords {
			if strings.Contains(name, kw) {
				isVirtual = true
				break
			}
		}
		if isVirtual {
			continue
		}

		// 4. 提取并校验 IP
		addrs, err := itf.Addrs()
		if err != nil {
			continue
		}

		for _, addr := range addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok {
				continue
			}

			ip := ipNet.IP
			// 仅保留 IPv4 且必须是私有局域网地址 (10.x, 172.16.x, 192.168.x)
			if ip.To4() != nil && ip.IsPrivate() {
				ret = append(ret, ip.String())
			}
		}
	}
	return
}

func IsLocalHostname(hostname string) bool {
	if "localhost" == hostname || strings.HasSuffix(hostname, ".localhost") {
		return true
	}
	if ip := net.ParseIP(hostname); nil != ip {
		return ip.IsLoopback()
	}
	return false
}

func IsLocalHost(host string) bool {
	if hostname, _, err := net.SplitHostPort(strings.TrimSpace(host)); err != nil {
		return false
	} else {
		return IsLocalHostname(hostname)
	}
}

func IsLocalOrigin(origin string) bool {
	if u, err := url.Parse(origin); err == nil {
		return IsLocalHostname(u.Hostname())
	}
	return false
}

// IsSessionOriginAllowed 校验会话 Cookie 认证请求的 Origin，防止跨站请求伪造
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-hhm2-g993-p656
func IsSessionOriginAllowed(origin, host string) bool {
	if "" == origin {
		// 浏览器发起的跨站请求都会携带 Origin，未携带时视为非浏览器客户端，按原行为放行
		return true
	}
	if IsLocalOrigin(origin) {
		return true
	}
	// 已设置锁屏密码的远程访问场景：Origin 必须与 Host 一致，否则视为跨站请求
	return originHostEquals(origin, host)
}

func originHostEquals(origin, host string) bool {
	u, err := url.Parse(origin)
	if nil != err {
		return false
	}
	originHost := strings.ToLower(strings.TrimSuffix(strings.TrimSuffix(u.Host, ":80"), ":443"))
	host = strings.ToLower(strings.TrimSuffix(strings.TrimSuffix(strings.TrimSpace(host), ":80"), ":443"))
	return "" != originHost && originHost == host
}

// SSRFSafeDialer returns a net.Dialer whose Control hook blocks private, loopback, link-local and unspecified IPs.
func SSRFSafeDialer(timeout time.Duration) *net.Dialer {
	return &net.Dialer{
		Timeout: timeout,
		Control: func(network, address string, _ syscall.RawConn) error {
			host, _, err := net.SplitHostPort(address)
			if err != nil {
				return err
			}
			if ip := net.ParseIP(host); ip != nil && isPrivateIP(ip) {
				if _, loaded := auditedAddresses.LoadOrStore(address, struct{}{}); !loaded {
					logging.LogWarnf("Establishing a connection to the private network [address=%s, network=%s]", address, network)
				}
				if SafeMode {
					return fmt.Errorf("ip address [%s] is prohibited", host)
				}
			}
			return nil
		},
	}
}

// ssrfSafeDialContext 返回智能体出站请求专用的拨号函数：拨号时自行解析主机名并拒绝私网地址，
// 同时直接连接解析出的公网 IP，使 CheckHostSSRF 的守卫结果与拨号目标一致，
// 从根上杜绝 DNS 重绑定导致的 TOCTOU 绕过。
// 与 SSRFSafeDialer 不同，本拨号函数不依赖 SafeMode，始终强制执行。
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-x8gv-g2g3-65fj
func ssrfSafeDialContext(timeout time.Duration) func(ctx context.Context, network, addr string) (net.Conn, error) {
	dialer := &net.Dialer{Timeout: timeout}
	return func(ctx context.Context, network, addr string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, err
		}
		if ip := net.ParseIP(host); ip != nil {
			if isPrivateIP(ip) {
				return nil, errors.New("access to private/internal IP is prohibited")
			}
			return dialer.DialContext(ctx, network, addr)
		}
		ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, err
		}
		var lastErr error
		for _, ipAddr := range ips {
			if isPrivateIP(ipAddr.IP) {
				continue
			}
			conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(ipAddr.IP.String(), port))
			if err == nil {
				return conn, nil
			}
			lastErr = err
		}
		if lastErr != nil {
			return nil, lastErr
		}
		return nil, errors.New("host has no public IP: " + host)
	}
}

// isPrivateIP 判断 IP 是否为私网地址，含内嵌私网 IPv4 的 IPv6 过渡地址（NAT64、6to4、Teredo、IPv4 兼容）。
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-qq8m-8p8v-x4xg
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-rg26-cg95-gq6p
func isPrivateIP(ip net.IP) bool {
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsPrivate() || ip.IsUnspecified() || ip.IsMulticast() {
		return true
	}
	// Go 标准库的分类方法不识别 IPv6 过渡地址，需按 RFC 内嵌格式提取其中的 IPv4 后再递归判断。
	if ip4 := extractEmbeddedIPv4(ip); nil != ip4 && !ip4.Equal(ip) {
		return isPrivateIP(ip4)
	}
	return false
}

// extractEmbeddedIPv4 提取 IPv6 过渡地址（NAT64、6to4、Teredo、IPv4 兼容）中内嵌的 IPv4 地址，非过渡地址返回 nil。
func extractEmbeddedIPv4(ip net.IP) net.IP {
	ip16 := ip.To16()
	if nil == ip16 || 16 != len(ip16) {
		return nil
	}
	// NAT64（RFC 6052 64:ff9b::/96，含 RFC 8215 64:ff9b:1::/48）：低 32 位为内嵌 IPv4。
	if ip16[0] == 0x00 && ip16[1] == 0x64 && ip16[2] == 0xff && ip16[3] == 0x9b {
		return net.IPv4(ip16[12], ip16[13], ip16[14], ip16[15])
	}
	// 6to4（RFC 3056 2002::/16）：第 16-47 位为内嵌 IPv4。
	if ip16[0] == 0x20 && ip16[1] == 0x02 {
		return net.IPv4(ip16[2], ip16[3], ip16[4], ip16[5])
	}
	// Teredo（RFC 4380 2001:0000::/32）：低 32 位按位取反后为内嵌 IPv4。
	if ip16[0] == 0x20 && ip16[1] == 0x01 && ip16[2] == 0x00 && ip16[3] == 0x00 {
		return net.IPv4(ip16[12]^0xff, ip16[13]^0xff, ip16[14]^0xff, ip16[15]^0xff)
	}
	// IPv4 兼容地址（RFC 4291 已废弃 ::/96）：低 32 位为内嵌 IPv4。
	if isZeroIPv6(ip16[0:12]) {
		return net.IPv4(ip16[12], ip16[13], ip16[14], ip16[15])
	}
	return nil
}

// isZeroIPv6 判断字节切片是否全为零。
func isZeroIPv6(b []byte) bool {
	for _, v := range b {
		if 0 != v {
			return false
		}
	}
	return true
}

func IsOnline(checkURL string, skipTlsVerify bool, timeout int) bool {
	if "" == checkURL {
		return false
	}

	u, err := url.Parse(checkURL)
	if err != nil {
		logging.LogWarnf("invalid check URL [%s]", checkURL)
		return false
	}
	if u.Scheme == "file" {
		filePath := strings.TrimPrefix(checkURL, "file://")
		_, err := os.Stat(filePath)
		return err == nil
	}

	if isOnline(checkURL, skipTlsVerify, timeout) {
		return true
	}

	logging.LogWarnf("network is offline [checkURL=%s]", checkURL)
	return false
}

func IsPortOpen(port string) bool {
	timeout := time.Second
	conn, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", port), timeout)
	if err != nil {
		return false
	}
	if nil != conn {
		conn.Close()
		return true
	}
	return false
}

func isOnline(checkURL string, skipTlsVerify bool, timeout int) (ret bool) {
	c := req.C().
		SetTimeout(time.Duration(timeout) * time.Millisecond).
		SetProxy(httpclient.ProxyFromEnvironment).
		SetUserAgent(UserAgent)
	if skipTlsVerify {
		c.EnableInsecureSkipVerify()
	}

	for range 2 {
		resp, err := c.R().Get(checkURL)
		if resp.GetHeader("Location") != "" {
			return true
		}

		var urlErr *url.Error
		if errors.As(err, &urlErr) && urlErr.URL != checkURL {
			// DNS 重定向
			logging.LogWarnf("network is online [DNS redirect, checkURL=%s, retURL=%s]", checkURL, urlErr.URL)
			return true
		}

		ret = err == nil
		if ret {
			break
		}

		logging.LogWarnf("check url [%s] is online failed: %s", checkURL, err)
		time.Sleep(1 * time.Second)
	}
	return
}

func GetRemoteAddr(req *http.Request) string {
	ret := req.Header.Get("X-forwarded-for")
	ret = strings.TrimSpace(ret)
	if "" == ret {
		ret = req.Header.Get("X-Real-IP")
	}
	ret = strings.TrimSpace(ret)
	if "" == ret {
		return req.RemoteAddr
	}
	return strings.Split(ret, ",")[0]
}

func JsonArg(c *gin.Context, result *gulu.Result) (arg map[string]any, ok bool) {
	arg = map[string]any{}
	if err := c.ShouldBindJSON(&arg); err != nil {
		result.Code = -1
		var detail string
		if errors.Is(err, io.EOF) {
			detail = "the request body is empty or truncated (EOF)"
		} else {
			detail = err.Error()
		}
		result.Msg = fmt.Sprintf("Parses request [%s] failed: %s", c.Request.URL.Path, detail)
		return
	}

	ok = true
	return
}

// GetRequestUrlStringParam extracts a string parameter from URL (path or query parameters).
func GetRequestUrlStringParam(c *gin.Context, key string) string {
	// /path/:name
	if value := c.Param(key); value != "" {
		return value
	}

	// /path?name=xxx
	if value := c.Query(key); value != "" {
		return value
	}

	return ""
}

// GetRequestStringParam extracts a string parameter from the request (URL or JSON body), with validation and error handling.
func GetRequestStringParam(c *gin.Context, key string, result *gulu.Result) string {
	// /path/:name
	if value := GetRequestUrlStringParam(c, key); value != "" {
		return value
	}

	// /path with JSON body {key: "xxx"}
	arg, ok := JsonArg(c, result)
	if !ok {
		return ""
	}
	if arg[key] == nil {
		result.Code = 1
		result.Msg = fmt.Sprintf("Request body prop [%s] does not exist", key)
		return ""
	}

	value, ok := arg[key].(string)
	if !ok {
		result.Code = 2
		result.Msg = fmt.Sprintf("Request body prop [%s] is not a string", key)
		return ""
	}
	return value
}

// ParseJsonArg 使用泛型从 JSON 参数中提取指定键的值。
//   - 如果 required 为 true 但参数缺失，则会在 ret.Msg 中说明需要传入的键
//   - 如果 rejectEmpty 为 true 但参数值为空，则会在 ret.Msg 中说明该键必须不为空（字符串去空白后、空数组、无任何键的对象）
//   - 如果参数存在但类型不匹配，则会在 ret.Msg 中说明该键期望的类型
//   - 返回值 ok 为 false 时，表示提取失败、类型不匹配或不满足非空约束
func ParseJsonArg[T any](key string, arg map[string]any, ret *gulu.Result, required, rejectEmpty bool) (value T, ok bool) {
	raw, exists := arg[key]
	if !exists || raw == nil {
		if required {
			ret.Code = -1
			ret.Msg = fmt.Sprintf("Field [%s] is required", key)
		} else {
			ok = true
		}
		return
	}

	value, ok = raw.(T)
	if !ok {
		var zero T
		ret.Code = -1

		// 返回对应的 JSON 类型
		jsonType := ""
		switch any(zero).(type) {
		case string:
			jsonType = "String"
		case float64:
			jsonType = "Number"
		case bool:
			jsonType = "Boolean"
		case []any:
			jsonType = "Array"
		case map[string]any:
			jsonType = "Object"
		default:
			jsonType = fmt.Sprintf("%T", zero)
		}

		ret.Msg = fmt.Sprintf("Field [%s] should be of type [%s]", key, jsonType)
		return
	}

	if rejectEmpty {
		var bad bool
		switch x := any(value).(type) {
		case string:
			if t := strings.TrimSpace(x); t == "" {
				bad = true
			} else {
				value = any(t).(T)
			}
		case []any:
			bad = len(x) == 0
		case map[string]any:
			bad = len(x) == 0
		}
		if bad {
			ret.Code = -1
			ret.Msg = fmt.Sprintf("Field [%s] must not be empty", key)
			ok = false
		}
	}
	return
}

// JsonArgParseFunc 为单次提取函数，用于 ParseJsonArgs 批量提取。
type JsonArgParseFunc func(arg map[string]any, ret *gulu.Result) bool

// BindJsonArg 创建一个提取函数：从 arg 取 key 并写入 dest，供 ParseJsonArgs 使用。
func BindJsonArg[T any](key string, dest *T, required, rejectEmpty bool) JsonArgParseFunc {
	return func(arg map[string]any, ret *gulu.Result) bool {
		v, ok := ParseJsonArg[T](key, arg, ret, required, rejectEmpty)
		if !ok {
			return false
		}
		*dest = v
		return true
	}
}

// ParseJsonArgs 按顺序执行多个提取函数。
//   - 任一失败返回 false 并在 ret 中写入错误信息
//   - 全部成功返回 true
func ParseJsonArgs(arg map[string]any, ret *gulu.Result, extractors ...JsonArgParseFunc) bool {
	for _, ext := range extractors {
		if !ext(arg, ret) {
			return false
		}
	}
	return true
}

func InvalidIDPattern(idArg string, result *gulu.Result) bool {
	if ast.IsNodeIDPattern(idArg) {
		return false
	}

	result.Code = -1
	result.Msg = "invalid ID argument"
	return true
}

func initHttpClient() {
	http.DefaultClient = httpclient.GetCloudFileClient2Min()
	http.DefaultTransport = httpclient.NewTransport(false)
}

func ParsePort(portString string) (uint16, error) {
	port, err := strconv.ParseUint(portString, 10, 16)
	if err != nil {
		logging.LogErrorf("parse port [%s] failed: %s", portString, err)
		return 0, err
	}
	return uint16(port), nil
}
