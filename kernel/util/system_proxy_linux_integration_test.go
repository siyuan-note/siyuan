// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build linux && !android

package util

import (
	"context"
	"os"
	"testing"
)

func TestGNOMEProxyModeTransitions(t *testing.T) {
	for _, name := range networkProxyEnvironmentNames {
		t.Setenv(name, "")
	}
	t.Setenv("XDG_CURRENT_DESKTOP", "GNOME")
	originalEnvironment, originalLoader := systemNetworkProxyEnvironment, loadSystemNetworkProxy
	systemNetworkProxyEnvironment = map[string]networkProxyEnvironmentValue{
		"NO_PROXY": {value: "private.example", set: true},
	}
	t.Cleanup(func() {
		systemNetworkProxyEnvironment, loadSystemNetworkProxy = originalEnvironment, originalLoader
	})
	settings := gnomeProxyTestSettings()
	loads := 0
	loadSystemNetworkProxy = func() (*systemNetworkProxyConfig, error) {
		loads++
		return readGNOMENetworkProxy(context.Background(), os.Getenv, readGNOMEProxyTestSettings(settings))
	}
	for i := 0; i < 2; i++ {
		SetNetworkProxy("socks5://manual:1080", false)
		if got := os.Getenv("HTTPS_PROXY"); got != "socks5://manual:1080" {
			t.Fatalf("manual proxy = %q", got)
		}
		if loads != i {
			t.Fatal("manual proxy must not load GNOME")
		}
		SetNetworkProxy("", true)
		if got := os.Getenv("HTTP_PROXY"); got != "http://127.0.0.1:7890" {
			t.Fatalf("system HTTP = %q", got)
		}
		if got := os.Getenv("HTTPS_PROXY"); got != "http://127.0.0.1:7891" {
			t.Fatalf("system HTTPS = %q", got)
		}
		if got := os.Getenv("NO_PROXY"); got != "localhost,127.0.0.0/8,::1,private.example" {
			t.Fatalf("system bypass = %q", got)
		}
		SetNetworkProxy("", false)
		if got := os.Getenv("HTTP_PROXY"); got != "" {
			t.Fatalf("direct HTTP = %q", got)
		}
		if got := os.Getenv("HTTPS_PROXY"); got != "" {
			t.Fatalf("direct HTTPS = %q", got)
		}
		if got := os.Getenv("NO_PROXY"); got != "private.example" {
			t.Fatalf("direct bypass = %q", got)
		}
		if loads != i+1 {
			t.Fatal("direct mode must not load GNOME")
		}
	}
	// 重新进入系统模式恢复启动配置，不把上一次手动设置误当成显式环境变量。
	systemNetworkProxyEnvironment["https_proxy"] = networkProxyEnvironmentValue{value: "http://environment:8080", set: true}
	loadSystemNetworkProxy = func() (*systemNetworkProxyConfig, error) {
		return readGNOMENetworkProxy(context.Background(), os.Getenv, func(context.Context, string, string) (string, error) {
			t.Fatal("startup environment must bypass GNOME reads")
			return "", nil
		})
	}
	SetNetworkProxy("socks5://manual:1080", false)
	SetNetworkProxy("", true)
	if got := os.Getenv("https_proxy"); got != "http://environment:8080" {
		t.Fatalf("restored HTTPS = %q", got)
	}
	if got := os.Getenv("HTTP_PROXY"); got != "" {
		t.Fatalf("mixed GNOME HTTP with environment HTTPS: %q", got)
	}
}
