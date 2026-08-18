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
	"net"
	"testing"
	"time"
)

// TestIsSessionOriginAllowed 验证会话 Cookie 认证的 Origin 校验逻辑
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-hhm2-g993-p656
func TestIsSessionOriginAllowed(t *testing.T) {
	tests := []struct {
		name   string
		origin string
		host   string
		want   bool
	}{
		{name: "no origin header", origin: "", host: "127.0.0.1:6806", want: true},
		{name: "local loopback origin", origin: "http://127.0.0.1:6806", host: "127.0.0.1:6806", want: true},
		{name: "localhost origin", origin: "http://localhost:6806", host: "localhost:6806", want: true},
		{name: "cross-site origin", origin: "https://evil.example", host: "127.0.0.1:6806", want: false},
		{name: "remote access with matching host", origin: "http://192.168.1.5:6806", host: "192.168.1.5:6806", want: true},
		{name: "remote access with same host different port", origin: "http://192.168.1.5:8080", host: "192.168.1.5:6806", want: false},
		{name: "default port normalized", origin: "http://192.168.1.5:80", host: "192.168.1.5", want: true},
		{name: "https default port normalized", origin: "https://192.168.1.5:443", host: "192.168.1.5", want: true},
		{name: "null origin", origin: "null", host: "127.0.0.1:6806", want: false},
		{name: "malformed origin", origin: "://bad", host: "127.0.0.1:6806", want: false},
		{name: "origin without host header", origin: "http://192.168.1.5:6806", host: "", want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := IsSessionOriginAllowed(test.origin, test.host); got != test.want {
				t.Fatalf("IsSessionOriginAllowed(%q, %q) = %v, want %v", test.origin, test.host, got, test.want)
			}
		})
	}
}

// TestIsPrivateIP 验证 isPrivateIP 对私网地址及 IPv6 过渡地址的判断
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-qq8m-8p8v-x4xg
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-rg26-cg95-gq6p
func TestIsPrivateIP(t *testing.T) {
	tests := []struct {
		name string
		ip   string
		want bool
	}{
		// IPv4
		{name: "IPv4 loopback", ip: "127.0.0.1", want: true},
		{name: "IPv4 private 10/8", ip: "10.0.0.1", want: true},
		{name: "IPv4 private 172.16/12", ip: "172.16.0.1", want: true},
		{name: "IPv4 private 192.168/16", ip: "192.168.1.1", want: true},
		{name: "IPv4 link-local", ip: "169.254.169.254", want: true},
		{name: "IPv4 unspecified", ip: "0.0.0.0", want: true},
		{name: "IPv4 multicast", ip: "224.0.0.1", want: true},
		{name: "IPv4 public", ip: "8.8.8.8", want: false},
		// IPv6
		{name: "IPv6 loopback", ip: "::1", want: true},
		{name: "IPv6 ULA", ip: "fc00::1", want: true},
		{name: "IPv6 link-local", ip: "fe80::1", want: true},
		{name: "IPv6 unspecified", ip: "::", want: true},
		{name: "IPv6 multicast", ip: "ff02::1", want: true},
		{name: "IPv6 IPv4-mapped private", ip: "::ffff:192.168.1.1", want: true},
		{name: "IPv6 documentation", ip: "2001:db8::1", want: false},
		{name: "IPv6 public", ip: "2606:4700:4700::1111", want: false},
		// IPv6 过渡地址
		{name: "NAT64 loopback", ip: "64:ff9b::7f00:1", want: true},
		{name: "NAT64 link-local", ip: "64:ff9b::a9fe:a9fe", want: true},
		{name: "NAT64 private", ip: "64:ff9b::c0a8:101", want: true},
		{name: "NAT64 public", ip: "64:ff9b::808:808", want: false},
		{name: "NAT64 local-use private", ip: "64:ff9b:1::c0a8:101", want: true},
		{name: "6to4 private", ip: "2002:c0a8:101::1", want: true},
		{name: "6to4 loopback", ip: "2002:7f00:1::1", want: true},
		{name: "6to4 public", ip: "2002:808:808::1", want: false},
		{name: "Teredo private", ip: "2001:0000:0000:0000:0000:0000:3f57:fefe", want: true},
		{name: "Teredo link-local", ip: "2001:0000:0000:0000:0000:0000:5601:5601", want: true},
		{name: "Teredo public", ip: "2001:0000:0000:0000:0000:0000:f7f7:f7f7", want: false},
		// IPv4 兼容地址（RFC 4291 已废弃 ::/96）
		{name: "IPv4-compatible loopback", ip: "::127.0.0.1", want: true},
		{name: "IPv4-compatible private", ip: "::c0a8:101", want: true},
		{name: "IPv4-compatible public", ip: "::808:808", want: false},
		{name: "IPv6 non-transition", ip: "::2", want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ip := net.ParseIP(test.ip)
			if nil == ip {
				t.Fatalf("parse IP [%s] failed", test.ip)
			}
			if got := isPrivateIP(ip); got != test.want {
				t.Fatalf("isPrivateIP(%q) = %v, want %v", test.ip, got, test.want)
			}
		})
	}
}

// TestCheckHostSSRF 验证 CheckHostSSRF 对私网地址及 IPv6 过渡地址的拦截
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-rg26-cg95-gq6p
func TestCheckHostSSRF(t *testing.T) {
	tests := []struct {
		name string
		host string
		want bool
	}{
		{name: "IPv4 loopback", host: "127.0.0.1", want: true},
		{name: "IPv4 private", host: "192.168.1.1", want: true},
		{name: "IPv4 link-local", host: "169.254.169.254", want: true},
		{name: "IPv6 loopback", host: "::1", want: true},
		{name: "IPv6 IPv4-mapped loopback", host: "::ffff:127.0.0.1", want: true},
		{name: "NAT64 loopback", host: "64:ff9b::7f00:1", want: true},
		{name: "NAT64 link-local", host: "64:ff9b::a9fe:a9fe", want: true},
		{name: "NAT64 private", host: "64:ff9b::c0a8:101", want: true},
		{name: "NAT64 local-use private", host: "64:ff9b:1::c0a8:101", want: true},
		{name: "6to4 loopback", host: "2002:7f00:1::1", want: true},
		{name: "6to4 private", host: "2002:c0a8:101::1", want: true},
		{name: "Teredo private", host: "2001:0000:0000:0000:0000:0000:3f57:fefe", want: true},
		{name: "IPv4-compatible loopback", host: "::127.0.0.1", want: true},
		{name: "public IPv4", host: "8.8.8.8", want: false},
		{name: "public IPv6", host: "2606:4700:4700::1111", want: false},
		{name: "NAT64 public", host: "64:ff9b::808:808", want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := CheckHostSSRF(test.host)
			if test.want != (nil != err) {
				t.Fatalf("CheckHostSSRF(%q) error [%v], want blocked [%v]", test.host, err, test.want)
			}
		})
	}
}

// TestSSRFSafeDialerSafeMode 验证安全模式下 SSRFSafeDialer 会阻止对私网及 IPv6 过渡地址的连接
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-qq8m-8p8v-x4xg
func TestSSRFSafeDialerSafeMode(t *testing.T) {
	previous := SafeMode
	SafeMode = true
	defer func() { SafeMode = previous }()

	tests := []struct {
		name    string
		address string
		blocked bool
	}{
		{name: "loopback", address: "127.0.0.1:80", blocked: true},
		{name: "private", address: "192.168.1.1:80", blocked: true},
		{name: "NAT64 loopback", address: "64:ff9b::7f00:1:80", blocked: true},
		{name: "NAT64 link-local", address: "64:ff9b::a9fe:a9fe:80", blocked: true},
		{name: "6to4 private", address: "2002:c0a8:101::1:80", blocked: true},
		{name: "Teredo private", address: "2001:0000:0000:0000:0000:0000:3f57:fefe:80", blocked: true},
		{name: "public", address: "8.8.8.8:80", blocked: false},
	}

	dialer := SSRFSafeDialer(30)
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := dialer.Control("tcp", test.address, nil)
			if test.blocked != (nil != err) {
				t.Fatalf("Control(%q) error [%v], want blocked [%v]", test.address, err, test.blocked)
			}
		})
	}
}

// TestSSRFSafeDialContext 验证 ssrfSafeDialContext 在连接阶段无条件拦截私网地址（不依赖 SafeMode），
// 并拒绝解析结果全部为私网的域名，杜绝 DNS 重绑定 TOCTOU。
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-x8gv-g2g3-65fj
func TestSSRFSafeDialContext(t *testing.T) {
	dialContext := ssrfSafeDialContext(500 * time.Millisecond)

	tests := []struct {
		name    string
		address string
		blocked bool
	}{
		{name: "loopback", address: "127.0.0.1:80", blocked: true},
		{name: "private", address: "192.168.1.1:80", blocked: true},
		{name: "link-local", address: "169.254.169.254:80", blocked: true},
		{name: "IPv6 loopback", address: "[::1]:80", blocked: true},
		{name: "NAT64 loopback", address: "[64:ff9b::7f00:1]:80", blocked: true},
		{name: "localhost 解析结果全为私网", address: "localhost:80", blocked: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			conn, err := dialContext(context.Background(), "tcp", test.address)
			if conn != nil {
				conn.Close()
			}
			if test.blocked != (nil != err) {
				t.Fatalf("dial %q error [%v], want blocked [%v]", test.address, err, test.blocked)
			}
		})
	}
}
