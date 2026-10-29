// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
	"unicode"
)

type macOSProxyValue struct {
	scalar string
	kind   string
	fields map[string]*macOSProxyValue
}

// readMacOSNetworkProxy 整组保留显式代理环境，避免混合环境和系统设置。
// 调用方先恢复启动环境；命令及解析错误不包含配置内容或标准错误。
func readMacOSNetworkProxy(ctx context.Context, read func(context.Context) (string, error)) (*systemNetworkProxyConfig, error) {
	for _, name := range []string{"HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"} {
		if os.Getenv(name) != "" {
			return nil, nil
		}
	}
	output, err := read(ctx)
	if err != nil {
		return nil, fmt.Errorf("read macOS system proxy failed")
	}
	ret, err := parseMacOSNetworkProxy(output)
	if err != nil || ret == nil {
		return ret, err
	}
	// 与实际请求读取顺序一致，保留启动环境中的直连例外。
	bypass := os.Getenv("NO_PROXY")
	if bypass == "" {
		bypass = os.Getenv("no_proxy")
	}
	if bypass != "" {
		if ret.NoProxy != "" {
			ret.NoProxy += ","
		}
		ret.NoProxy += bypass
	}
	return ret, nil
}

func readMacOSProxyCommand(ctx context.Context) (string, error) {
	// 使用固定系统路径且不经过 shell；超时也限制子进程输出管道的等待时间。
	cmd := exec.CommandContext(ctx, "/usr/sbin/scutil", "--proxy")
	cmd.WaitDelay = 100 * time.Millisecond
	output, err := cmd.Output()
	return string(output), err
}

func parseMacOSNetworkProxy(output string) (*systemNetworkProxyConfig, error) {
	if strings.TrimSpace(output) == "No proxy configuration available" {
		return nil, nil
	}
	root, err := parseMacOSProxyDictionary(output)
	if err != nil {
		return nil, err
	}
	get := func(key string) (string, error) {
		value := root.fields[key]
		if value == nil {
			return "", nil
		}
		if value.kind != "" {
			return "", fmt.Errorf("invalid macOS proxy field %s", key)
		}
		return value.scalar, nil
	}
	enabled := func(key string) (bool, error) {
		value, err := get(key)
		if err != nil || value == "" {
			return false, err
		}
		number, err := strconv.Atoi(value)
		if err != nil {
			return false, fmt.Errorf("invalid macOS proxy flag %s", key)
		}
		return number != 0, nil
	}
	for _, key := range []string{"ProxyAutoConfigEnable", "ProxyAutoDiscoveryEnable"} {
		on, err := enabled(key)
		if err != nil {
			return nil, err
		}
		if on {
			return nil, fmt.Errorf("macOS automatic proxy configuration is not supported")
		}
	}
	proxies := make(map[string]string, 3)
	for _, protocol := range []string{"HTTP", "HTTPS", "SOCKS"} {
		on, err := enabled(protocol + "Enable")
		if err != nil {
			return nil, err
		}
		if !on {
			continue
		}
		host, err := get(protocol + "Proxy")
		if err != nil {
			return nil, err
		}
		portValue, err := get(protocol + "Port")
		if err != nil {
			return nil, err
		}
		port, err := strconv.Atoi(portValue)
		if err != nil || port < 1 || port > 65535 {
			return nil, fmt.Errorf("invalid macOS proxy port for %s", protocol)
		}
		if strings.HasPrefix(host, "[") && strings.HasSuffix(host, "]") {
			host = host[1 : len(host)-1]
		}
		if host == "" || strings.ContainsAny(host, "/\\@?#[]") || strings.IndexFunc(host, func(r rune) bool {
			return unicode.IsSpace(r) || unicode.IsControl(r)
		}) >= 0 || (strings.Contains(host, ":") && net.ParseIP(host) == nil) {
			return nil, fmt.Errorf("invalid macOS proxy host for %s", protocol)
		}
		// HTTPS 表示目标协议，macOS 的安全 Web 代理仍通过 HTTP CONNECT 建立隧道。
		scheme := "http"
		if protocol == "SOCKS" {
			scheme = "socks5"
		}
		proxies[protocol] = (&url.URL{Scheme: scheme, Host: net.JoinHostPort(host, strconv.Itoa(port))}).String()
	}
	ret := &systemNetworkProxyConfig{HTTPProxy: proxies["HTTP"], HTTPSProxy: proxies["HTTPS"]}
	// 各目标协议独立配置，缺省时仅回退 SOCKS，不把 HTTP 配置套用于 HTTPS。
	if ret.HTTPProxy == "" {
		ret.HTTPProxy = proxies["SOCKS"]
	}
	if ret.HTTPSProxy == "" {
		ret.HTTPSProxy = proxies["SOCKS"]
	}
	if ret.HTTPProxy == "" && ret.HTTPSProxy == "" {
		return nil, nil
	}
	simple, err := enabled("ExcludeSimpleHostnames")
	if err != nil {
		return nil, err
	}
	if simple {
		return nil, fmt.Errorf("macOS simple-hostname proxy bypass is not supported; disable it and use explicit bypass entries instead")
	}
	if exceptions := root.fields["ExceptionsList"]; exceptions != nil {
		if exceptions.kind != "array" {
			return nil, fmt.Errorf("invalid macOS proxy bypass list")
		}
		entries := make([]string, 0, len(exceptions.fields))
		seen := map[string]bool{}
		for i := 0; i < len(exceptions.fields); i++ {
			value := exceptions.fields[strconv.Itoa(i)]
			if value == nil || value.kind != "" {
				return nil, fmt.Errorf("invalid macOS proxy bypass entry")
			}
			entry, err := macOSProxyBypassEntry(value.scalar)
			if err != nil {
				return nil, err
			}
			if entry != "" && !seen[entry] {
				entries, seen[entry] = append(entries, entry), true
			}
		}
		ret.NoProxy = strings.Join(entries, ",")
	}
	return ret, nil
}

// parseMacOSProxyDictionary 按容器层级解析 scutil 输出，避免把接口内的配置当作全局配置。
func parseMacOSProxyDictionary(output string) (*macOSProxyValue, error) {
	invalid := func() (*macOSProxyValue, error) { return nil, fmt.Errorf("invalid macOS proxy configuration") }
	var root *macOSProxyValue
	var stack []*macOSProxyValue
	for line := range strings.SplitSeq(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if root == nil {
			if line != "<dictionary> {" {
				return invalid()
			}
			root = &macOSProxyValue{kind: "dictionary", fields: map[string]*macOSProxyValue{}}
			stack = append(stack, root)
			continue
		}
		if len(stack) == 0 {
			return invalid()
		}
		if line == "}" {
			stack = stack[:len(stack)-1]
			continue
		}
		key, value, ok := strings.Cut(line, " : ")
		if !ok || key == "" {
			return invalid()
		}
		parent := stack[len(stack)-1]
		if _, exists := parent.fields[key]; exists {
			return invalid()
		}
		node := &macOSProxyValue{scalar: value}
		parent.fields[key] = node
		if value == "<dictionary> {" || value == "<array> {" {
			if len(stack) >= 32 {
				return invalid()
			}
			node.kind = strings.TrimSuffix(strings.TrimPrefix(value, "<"), "> {")
			node.fields = map[string]*macOSProxyValue{}
			stack = append(stack, node)
		}
	}
	if root == nil || len(stack) != 0 {
		return invalid()
	}
	return root, nil
}

func macOSProxyBypassEntry(entry string) (string, error) {
	entry = strings.TrimSpace(entry)
	invalid := func() (string, error) { return "", fmt.Errorf("unsupported macOS proxy bypass entry") }
	if entry == "" || entry == "*" {
		return entry, nil
	}
	if strings.ContainsAny(entry, ",;@?#\\<>") || strings.IndexFunc(entry, func(r rune) bool {
		return unicode.IsSpace(r) || unicode.IsControl(r)
	}) >= 0 {
		return invalid()
	}
	if strings.Contains(entry, "/") {
		// macOS 常见的 169.254/16 需要补齐为 NO_PROXY 接受的 IPv4 CIDR。
		address, prefix, _ := strings.Cut(entry, "/")
		if !strings.Contains(address, ":") {
			parts := strings.Split(address, ".")
			for len(parts) < 4 {
				parts = append(parts, "0")
			}
			entry = strings.Join(parts, ".") + "/" + prefix
		}
		_, network, err := net.ParseCIDR(entry)
		if err != nil {
			return invalid()
		}
		return network.String(), nil
	}
	if strings.Contains(entry, "*") {
		if strings.HasPrefix(entry, "*.") && !strings.Contains(entry[2:], "*") {
			return entry, nil
		}
		// IPv4 尾部通配符转换为网络段，不接受任意位置的主机名通配符。
		parts := strings.Split(entry, ".")
		fixed := 0
		for fixed < len(parts) && parts[fixed] != "*" {
			fixed++
		}
		if fixed == 0 || fixed == len(parts) || len(parts) > 4 {
			return invalid()
		}
		for _, part := range parts[fixed:] {
			if part != "*" {
				return invalid()
			}
		}
		for len(parts) < 4 {
			parts = append(parts, "0")
		}
		for i := fixed; i < 4; i++ {
			parts[i] = "0"
		}
		_, network, err := net.ParseCIDR(strings.Join(parts, ".") + "/" + strconv.Itoa(fixed*8))
		if err != nil {
			return invalid()
		}
		return network.String(), nil
	}
	if strings.Contains(entry, ":") && net.ParseIP(entry) == nil {
		return invalid()
	}
	return entry, nil
}
