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

package util

import (
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/imroc/req/v3"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
)

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

	for i := 0; i < 2; i++ {
		resp, err := c.R().Get(checkURL)
		if resp.GetHeader("Location") != "" {
			return true
		}

		switch err.(type) {
		case *url.Error:
			if err.(*url.Error).URL != checkURL {
				// DNS 重定向
				logging.LogWarnf("network is online [DNS redirect, checkURL=%s, retURL=%s]", checkURL, err.(*url.Error).URL)
				return true
			}
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

func JsonArg(c *gin.Context, result *gulu.Result) (arg map[string]interface{}, ok bool) {
	arg = map[string]interface{}{}
	if err := c.BindJSON(&arg); err != nil {
		result.Code = -1
		result.Msg = "parses request failed"
		return
	}

	ok = true
	return
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
