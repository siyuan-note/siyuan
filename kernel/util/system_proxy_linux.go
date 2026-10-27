// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build linux && !android

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

const gnomeProxySchema = "org.gnome.system.proxy"

type gnomeProxySettingReader func(context.Context, string, string) (string, error)

func readSystemNetworkProxy() (*systemNetworkProxyConfig, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return readGNOMENetworkProxy(ctx, os.Getenv, readGNOMEProxySetting)
}

// readGNOMENetworkProxy 仅在 GNOME 会话且没有显式代理环境配置时读取桌面代理。
// 整组保留环境代理，避免将两个来源的 HTTP 和 HTTPS 配置混合。
func readGNOMENetworkProxy(ctx context.Context, getenv func(string) string, read gnomeProxySettingReader) (*systemNetworkProxyConfig, error) {
	if !isGNOMEProxySession(getenv) {
		return nil, nil
	}
	for _, name := range []string{"HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"} {
		if getenv(name) != "" {
			return nil, nil
		}
	}
	get := func(schema, key string) (string, error) {
		value, err := read(ctx, schema, key)
		if err != nil {
			// 不记录设置内容或命令标准错误，避免泄露代理配置。
			return "", fmt.Errorf("read GNOME proxy setting %s.%s failed", schema, key)
		}
		return strings.TrimSpace(value), nil
	}
	getString := func(schema, key string) (string, error) {
		value, err := get(schema, key)
		if err != nil {
			return "", err
		}
		parsed, rest, err := consumeGNOMEProxyString(value)
		if err != nil || strings.TrimSpace(rest) != "" {
			return "", fmt.Errorf("invalid GNOME proxy string %s.%s", schema, key)
		}
		return parsed, nil
	}
	mode, err := getString(gnomeProxySchema, "mode")
	if err != nil {
		return nil, err
	}
	switch mode {
	case "none":
		return nil, nil
	case "auto":
		return nil, fmt.Errorf("GNOME automatic proxy configuration is not supported")
	case "manual":
	default:
		return nil, fmt.Errorf("invalid GNOME proxy mode")
	}
	proxies := make(map[string]string, 3)
	for _, protocol := range []string{"http", "https", "socks"} {
		schema := gnomeProxySchema + "." + protocol
		host, readErr := getString(schema, "host")
		if readErr != nil {
			return nil, readErr
		}
		if host == "" {
			continue
		}
		portValue, readErr := get(schema, "port")
		if readErr != nil {
			return nil, readErr
		}
		port, parseErr := strconv.Atoi(portValue)
		if parseErr != nil || port < 0 || port > 65535 {
			return nil, fmt.Errorf("invalid GNOME proxy port for %s", protocol)
		}
		if port == 0 {
			continue
		}
		if protocol == "http" {
			auth, authErr := get(schema, "use-authentication")
			if authErr != nil {
				return nil, authErr
			}
			if auth != "false" {
				return nil, fmt.Errorf("GNOME authenticated HTTP proxy is not supported")
			}
		}
		proxy, parseErr := gnomeProxyURL(host, port, protocol)
		if parseErr != nil {
			return nil, parseErr
		}
		proxies[protocol] = proxy
	}
	ret := &systemNetworkProxyConfig{HTTPProxy: proxies["http"], HTTPSProxy: proxies["https"]}
	// GNOME 的 HTTPS 未单独配置时复用 HTTP，然后才回退 SOCKS。
	if ret.HTTPSProxy == "" {
		ret.HTTPSProxy = ret.HTTPProxy
	}
	if ret.HTTPProxy == "" {
		ret.HTTPProxy = proxies["socks"]
	}
	if ret.HTTPSProxy == "" {
		ret.HTTPSProxy = proxies["socks"]
	}
	if ret.HTTPProxy == "" && ret.HTTPSProxy == "" {
		return nil, nil
	}
	ignore, err := get(gnomeProxySchema, "ignore-hosts")
	if err != nil {
		return nil, err
	}
	bypass, err := parseGNOMEProxyStrings(ignore)
	if err != nil {
		return nil, err
	}
	// GNOME 的前导点和通配域名同时包含主域名，NO_PROXY 的对应写法只匹配子域名。
	for i, entry := range bypass {
		entry = strings.TrimSpace(entry)
		bypass[i] = strings.TrimPrefix(strings.TrimPrefix(entry, "*."), ".")
		if bypass[i] == "*" {
			// GNOME 不把单独的星号作为全局直连规则。
			bypass[i] = ""
		}
	}
	// 单独设置 NO_PROXY 不阻止读取桌面代理；保留两方的直连例外。
	environmentBypass := getenv("no_proxy")
	if environmentBypass == "" {
		environmentBypass = getenv("NO_PROXY")
	}
	bypass = append(bypass, strings.Split(environmentBypass, ",")...)
	seen := map[string]bool{}
	entries := []string{}
	for _, entry := range bypass {
		entry = strings.TrimSpace(entry)
		if strings.ContainsAny(entry, ",\x00\r\n") {
			return nil, fmt.Errorf("invalid GNOME proxy bypass entry")
		}
		if entry != "" && !seen[entry] {
			seen[entry] = true
			entries = append(entries, entry)
		}
	}
	ret.NoProxy = strings.Join(entries, ",")
	return ret, nil
}

func isGNOMEProxySession(getenv func(string) string) bool {
	desktop := getenv("XDG_CURRENT_DESKTOP")
	if desktop != "" {
		for _, name := range strings.Split(desktop, ":") {
			if strings.EqualFold(strings.TrimSpace(name), "GNOME") {
				return true
			}
		}
		return false
	}
	for _, name := range []string{"XDG_SESSION_DESKTOP", "DESKTOP_SESSION"} {
		session := strings.ToLower(getenv(name))
		switch session {
		case "gnome", "gnome-classic", "gnome-xorg", "gnome-wayland":
			return true
		}
		if session != "" {
			return false
		}
	}
	return false
}

func readGNOMEProxySetting(ctx context.Context, schema, key string) (string, error) {
	// 不经过 shell；调用方只传入固定的 schema 和 key，整个读取流程共享超时。
	cmd := exec.CommandContext(ctx, "gsettings", "get", schema, key)
	cmd.WaitDelay = 100 * time.Millisecond
	output, err := cmd.Output()
	return string(output), err
}

func gnomeProxyURL(host string, port int, protocol string) (string, error) {
	if strings.HasPrefix(host, "[") && strings.HasSuffix(host, "]") {
		host = host[1 : len(host)-1]
	}
	if host == "" || strings.ContainsAny(host, "/\\@?#[]") || strings.IndexFunc(host, func(r rune) bool {
		return unicode.IsSpace(r) || unicode.IsControl(r)
	}) >= 0 || (strings.Contains(host, ":") && net.ParseIP(host) == nil) {
		return "", fmt.Errorf("invalid GNOME proxy host for %s", protocol)
	}
	scheme := "http"
	if protocol == "socks" {
		scheme = "socks5"
	}
	return (&url.URL{Scheme: scheme, Host: net.JoinHostPort(host, strconv.Itoa(port))}).String(), nil
}

// consumeGNOMEProxyString 解析 gsettings 输出的 GVariant 引号字符串，不执行转义后的内容。
func consumeGNOMEProxyString(value string) (string, string, error) {
	value = strings.TrimSpace(value)
	if len(value) < 2 || (value[0] != '\'' && value[0] != '"') {
		return "", "", fmt.Errorf("invalid GNOME proxy string")
	}
	quote := value[0]
	value = value[1:]
	var result strings.Builder
	for len(value) > 0 {
		if value[0] == quote {
			return result.String(), value[1:], nil
		}
		char, _, tail, err := strconv.UnquoteChar(value, quote)
		if err != nil {
			return "", "", fmt.Errorf("invalid GNOME proxy string escape")
		}
		result.WriteRune(char)
		value = tail
	}
	return "", "", fmt.Errorf("unterminated GNOME proxy string")
}

func parseGNOMEProxyStrings(value string) ([]string, error) {
	value = strings.TrimSpace(strings.TrimPrefix(value, "@as "))
	if !strings.HasPrefix(value, "[") {
		return nil, fmt.Errorf("invalid GNOME proxy bypass list")
	}
	value = strings.TrimSpace(value[1:])
	result := []string{}
	for !strings.HasPrefix(value, "]") {
		entry, rest, err := consumeGNOMEProxyString(value)
		if err != nil {
			return nil, err
		}
		result = append(result, entry)
		value = strings.TrimSpace(rest)
		if strings.HasPrefix(value, ",") {
			value = strings.TrimSpace(value[1:])
		} else if !strings.HasPrefix(value, "]") {
			return nil, fmt.Errorf("invalid GNOME proxy bypass separator")
		}
	}
	if strings.TrimSpace(value[1:]) != "" {
		return nil, fmt.Errorf("invalid GNOME proxy bypass suffix")
	}
	return result, nil
}
