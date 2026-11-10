// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build linux && !android

package util

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	kdeProxySettingsGroup = "[Proxy Settings]"
	kdeProxyConfigLimit   = 1 << 20
)

// kdeProxySettings 汇总 kioslaverc 中与出站代理相关的键，后读取的文件覆盖先读取的文件。
type kdeProxySettings struct {
	proxyType         int
	httpProxy         string
	httpsProxy        string
	socksProxy        string
	noProxyFor        string
	reversedException bool
}

// kdeProxyConfigPaths 按读取顺序返回 kioslaverc 路径。
// KDE 5 起配置迁到 XDG 配置目录，$KDEHOME 的旧位置放最后读取，以覆盖同一组键。
var kdeProxyConfigPaths = func(getenv func(string) string) []string {
	paths := []string{}
	if configHome := getenv("XDG_CONFIG_HOME"); configHome != "" {
		paths = append(paths, filepath.Join(configHome, "kioslaverc"))
	} else if home, err := os.UserHomeDir(); err == nil {
		paths = append(paths, filepath.Join(home, ".config", "kioslaverc"))
	}
	if kdeHome := getenv("KDEHOME"); kdeHome != "" {
		paths = append(paths, filepath.Join(kdeHome, "share", "config", "kioslaverc"))
	}
	return paths
}

// readKDENetworkProxy 读取 KDE 的手动代理配置，自动配置与反转例外不支持。
// 显式代理环境整组优先，与 GNOME 分支保持一致。
func readKDENetworkProxy(getenv func(string) string) (*systemNetworkProxyConfig, error) {
	if explicitProxyEnvironment(getenv) {
		return nil, nil
	}
	settings, err := loadKDEProxySettings(kdeProxyConfigPaths(getenv))
	if err != nil || settings == nil {
		return nil, err
	}
	switch settings.proxyType {
	case 0, 4:
		// 0 为不使用代理；4 表示使用环境变量，由 SetNetworkProxy 还原启动环境。
		return nil, nil
	case 1:
	case 2:
		return nil, fmt.Errorf("KDE automatic proxy configuration is not supported")
	case 3:
		return nil, fmt.Errorf("KDE automatic proxy discovery is not supported")
	default:
		return nil, nil
	}
	if settings.reversedException {
		// NO_PROXY 无法表达「仅例外列表走代理」的反转语义。
		return nil, fmt.Errorf("KDE reversed proxy exception list is not supported")
	}
	httpProxy, err := normalizeKDEProxyValue(settings.httpProxy, "http")
	if err != nil {
		return nil, err
	}
	httpsProxy, err := normalizeKDEProxyValue(settings.httpsProxy, "http")
	if err != nil {
		return nil, err
	}
	socksProxy, err := normalizeKDEProxyValue(settings.socksProxy, "socks5")
	if err != nil {
		return nil, err
	}
	ret := &systemNetworkProxyConfig{HTTPProxy: httpProxy, HTTPSProxy: httpsProxy}
	applyLinuxProxyFallback(ret, socksProxy)
	if ret.HTTPProxy == "" && ret.HTTPSProxy == "" {
		return nil, nil
	}
	if ret.NoProxy, err = mergeProxyBypass(parseKDEProxyBypass(settings.noProxyFor), getenv); err != nil {
		return nil, err
	}
	return ret, nil
}

func loadKDEProxySettings(paths []string) (*kdeProxySettings, error) {
	ret := &kdeProxySettings{}
	found := false
	for _, path := range paths {
		content, err := readKDEProxyConfig(path)
		if err != nil {
			return nil, err
		}
		if content == nil {
			continue
		}
		found = true
		parseKDEProxyConfig(string(content), ret)
	}
	if !found {
		return nil, nil
	}
	return ret, nil
}

// readKDEProxyConfig 返回 nil 表示配置文件不存在；错误信息不包含文件内容。
func readKDEProxyConfig(path string) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, fmt.Errorf("read KDE proxy settings failed")
	}
	defer file.Close()
	content, err := io.ReadAll(io.LimitReader(file, kdeProxyConfigLimit))
	if err != nil {
		return nil, fmt.Errorf("read KDE proxy settings failed")
	}
	return content, nil
}

// parseKDEProxyConfig 只解析 [Proxy Settings] 段，按 KConfig 的行格式读取；后出现的同名键覆盖先前值。
func parseKDEProxyConfig(content string, settings *kdeProxySettings) {
	inProxySettings := false
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "[") {
			inProxySettings = line == kdeProxySettingsGroup
			continue
		}
		if !inProxySettings {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		// 去掉 KConfig 的本地化后缀，例如 ProxyType[zh_CN]。
		if index := strings.LastIndex(key, "["); 0 < index && strings.HasSuffix(key, "]") {
			key = strings.TrimSpace(key[:index])
		}
		value = strings.TrimSpace(value)
		switch key {
		case "ProxyType":
			settings.proxyType = parseKDEProxyInt(value)
		case "httpProxy":
			settings.httpProxy = value
		case "httpsProxy":
			settings.httpsProxy = value
		case "socksProxy":
			settings.socksProxy = value
		case "NoProxyFor":
			settings.noProxyFor = value
		case "ReversedException":
			settings.reversedException = parseKDEProxyBool(value)
		}
	}
}

// normalizeKDEProxyValue 兼容两代写法：新版本用冒号分隔端口，旧版本用空格。
func normalizeKDEProxyValue(value, defaultScheme string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || strings.HasPrefix(value, "//:") {
		return "", nil
	}
	if index := strings.LastIndex(value, " "); 0 < index {
		port := value[index+1:]
		if port != "" && strings.IndexFunc(port, func(r rune) bool { return r < '0' || '9' < r }) < 0 {
			value = value[:index] + ":" + port
		} else {
			return "", fmt.Errorf("invalid KDE proxy address")
		}
	}
	if 8 <= len(value) && strings.EqualFold(value[:8], "socks://") {
		value = "socks5://" + value[8:]
	}
	return normalizeSystemNetworkProxyURL(value, defaultScheme)
}

// parseKDEProxyBypass 拆分 KDE 的 NoProxyFor，KDE 允许逗号或空格分隔，并支持 <local> 写法。
func parseKDEProxyBypass(value string) []string {
	entries := []string{}
	for _, field := range strings.FieldsFunc(value, func(r rune) bool { return r == ',' || r == ' ' }) {
		field = normalizeKDEProxyBypassEntry(field)
		if strings.EqualFold(field, "<local>") {
			entries = append(entries, "localhost", "127.0.0.1", "::1")
			continue
		}
		entries = append(entries, field)
	}
	return entries
}

// normalizeKDEProxyBypassEntry 去掉 KDE 允许的 URL 形式，NO_PROXY 只接受主机。
func normalizeKDEProxyBypassEntry(entry string) string {
	entry = strings.TrimSpace(entry)
	if index := strings.Index(entry, "://"); 0 <= index {
		entry = entry[index+3:]
		if slash := strings.IndexByte(entry, '/'); 0 <= slash {
			entry = entry[:slash]
		}
	}
	return strings.TrimSuffix(entry, "/")
}

func parseKDEProxyInt(value string) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return 0
	}
	return parsed
}

func parseKDEProxyBool(value string) bool {
	value = strings.TrimSpace(value)
	if strings.EqualFold(value, "true") {
		return true
	}
	return parseKDEProxyInt(value) != 0
}
