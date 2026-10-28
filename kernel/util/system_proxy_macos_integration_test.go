// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"context"
	"errors"
	"go/build"
	"net/http"
	"os"
	"testing"

	"github.com/siyuan-note/httpclient"
)

func TestMacOSProxyPlatformSelection(t *testing.T) {
	for _, test := range []struct{ platform, want string }{
		{"darwin", "system_proxy_darwin.go"}, {"ios", "system_proxy_other.go"},
		{"linux", "system_proxy_linux.go"}, {"android", "system_proxy_other.go"},
		{"windows", "system_proxy_windows.go"}, {"freebsd", "system_proxy_other.go"},
	} {
		t.Run(test.platform, func(t *testing.T) {
			context := build.Default
			context.GOOS, context.GOARCH = test.platform, "arm64"
			for _, file := range []string{"system_proxy_darwin.go", "system_proxy_linux.go", "system_proxy_windows.go", "system_proxy_other.go"} {
				matches, err := context.MatchFile(".", file)
				if err != nil || matches != (file == test.want) {
					t.Errorf("%s matches %s = %t, %v", test.platform, file, matches, err)
				}
			}
		})
	}
}

func TestMacOSProxyModeTransitions(t *testing.T) {
	clearMacOSProxyTestEnvironment(t)
	originalEnvironment, originalLoader := systemNetworkProxyEnvironment, loadSystemNetworkProxy
	systemNetworkProxyEnvironment = map[string]networkProxyEnvironmentValue{
		"NO_PROXY": {value: "startup.example", set: true},
		"no_proxy": {value: "startup.example", set: true},
	}
	t.Cleanup(func() {
		systemNetworkProxyEnvironment, loadSystemNetworkProxy = originalEnvironment, originalLoader
	})
	output := macOSManualProxyFixture
	var commandError error
	loads := 0
	loadSystemNetworkProxy = func() (*systemNetworkProxyConfig, error) {
		return readMacOSNetworkProxy(context.Background(), func(context.Context) (string, error) {
			loads++
			return output, commandError
		})
	}
	assertRoute := func(target, want string) {
		t.Helper()
		request, err := http.NewRequest(http.MethodGet, target, nil)
		if err != nil {
			t.Fatal(err)
		}
		proxy, err := httpclient.ProxyFromEnvironment(request)
		got := ""
		if proxy != nil {
			got = proxy.String()
		}
		if err != nil || got != want {
			t.Fatalf("route %s = %q, %v, want %q", target, got, err, want)
		}
	}
	for i := 0; i < 2; i++ {
		SetNetworkProxy("socks5://manual.example:1080", false)
		assertRoute("https://public.example", "socks5://manual.example:1080")
		if loads != i {
			t.Fatal("manual mode read system settings")
		}
		SetNetworkProxy("", true)
		assertRoute("http://public.example", "http://127.0.0.1:7890")
		assertRoute("https://public.example", "http://127.0.0.1:7891")
		assertRoute("https://printer.local", "")
		assertRoute("https://startup.example", "")
		if loads != i+1 {
			t.Fatal("system mode did not read settings")
		}
		SetNetworkProxy("", false)
		assertRoute("https://public.example", "")
		if os.Getenv("NO_PROXY") != "startup.example" {
			t.Fatal("direct mode did not restore startup bypass")
		}
	}
	for _, test := range []struct {
		name, output string
		failure      error
	}{
		{"disabled", "<dictionary> {\n}", nil},
		{"malformed", "invalid secret settings", nil},
		{"command failure", "", errors.New("secret command output")},
		{"PAC", "<dictionary> {\nProxyAutoConfigEnable : 1\n}", nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			output, commandError = macOSManualProxyFixture, nil
			SetNetworkProxy("", true)
			assertRoute("https://public.example", "http://127.0.0.1:7891")
			output, commandError = test.output, test.failure
			SetNetworkProxy("", true)
			assertRoute("https://public.example", "")
			if os.Getenv("NO_PROXY") != "startup.example" || os.Getenv("no_proxy") != "startup.example" {
				t.Fatal("system fallback retained stale bypass entries")
			}
		})
	}
	// 重新进入系统模式恢复启动环境，不把手动代理误认为显式环境配置。
	systemNetworkProxyEnvironment["https_proxy"] = networkProxyEnvironmentValue{value: "http://startup.example:8080", set: true}
	systemNetworkProxyEnvironment["HTTPS_PROXY"] = networkProxyEnvironmentValue{value: "http://startup.example:8080", set: true}
	before := loads
	SetNetworkProxy("socks5://manual.example:1080", false)
	SetNetworkProxy("", true)
	assertRoute("https://public.example", "http://startup.example:8080")
	assertRoute("http://public.example", "")
	if loads != before {
		t.Fatal("explicit startup proxy did not bypass system reader")
	}
}
