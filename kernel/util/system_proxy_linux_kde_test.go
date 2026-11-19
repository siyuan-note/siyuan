// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build linux && !android

package util

import (
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/siyuan-note/httpclient"
)

func TestLinuxDesktopProxyKind(t *testing.T) {
	for _, test := range []struct {
		name                 string
		current, session     string
		desktop, fullSession string
		want                 linuxDesktopProxy
	}{
		{"GNOME", "GNOME", "", "", "", linuxDesktopProxyGNOME},
		{"ubuntu GNOME", "ubuntu:GNOME", "", "", "", linuxDesktopProxyGNOME},
		{"KDE", "KDE", "", "", "", linuxDesktopProxyKDE},
		{"Plasma", "plasma", "", "", "", linuxDesktopProxyKDE},
		{"KDE session", "", "plasma", "", "", linuxDesktopProxyKDE},
		{"Plasma Wayland session", "", "plasmawayland", "", "", linuxDesktopProxyKDE},
		{"KDE full session", "", "", "", "true", linuxDesktopProxyKDE},
		{"current desktop wins", "KDE", "gnome", "", "", linuxDesktopProxyKDE},
		{"XFCE", "XFCE", "", "", "", linuxDesktopProxyUnsupported},
		{"empty", "", "", "", "", linuxDesktopProxyUnsupported},
	} {
		env := map[string]string{
			"XDG_CURRENT_DESKTOP": test.current, "XDG_SESSION_DESKTOP": test.session,
			"DESKTOP_SESSION": test.desktop, "KDE_FULL_SESSION": test.fullSession,
		}
		if got := linuxDesktopProxyKind(func(name string) string { return env[name] }); got != test.want {
			t.Errorf("%s = %v, want %v", test.name, got, test.want)
		}
	}
}

func kdeTestEnvironment(t *testing.T, content string, extra map[string]string) func(string) string {
	t.Helper()
	configHome := t.TempDir()
	if content != "" {
		if err := os.WriteFile(filepath.Join(configHome, "kioslaverc"), []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	env := map[string]string{"XDG_CURRENT_DESKTOP": "KDE", "XDG_CONFIG_HOME": configHome}
	for name, value := range extra {
		env[name] = value
	}
	return func(name string) string { return env[name] }
}

func TestReadKDENetworkProxy(t *testing.T) {
	const manualColon = `[Proxy Settings]
NoProxyFor=localhost,127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,::1
Proxy Config Script=
ProxyType=1
httpProxy=http://127.0.0.1:7890
httpsProxy=http://127.0.0.1:7891
socksProxy=socks://127.0.0.1:7892
`
	for _, test := range []struct {
		name    string
		content string
		env     map[string]string
		want    *systemNetworkProxyConfig
		wantErr bool
	}{
		{
			name:    "manual with colon ports",
			content: manualColon,
			want: &systemNetworkProxyConfig{
				HTTPProxy: "http://127.0.0.1:7890", HTTPSProxy: "http://127.0.0.1:7891",
				NoProxy: "localhost,127.0.0.1,192.168.0.0/16,10.0.0.0/8,172.16.0.0/12,::1",
			},
		},
		{
			name: "legacy space port",
			content: `[Proxy Settings]
ProxyType=1
httpProxy=http://127.0.0.1 7890
`,
			want: &systemNetworkProxyConfig{HTTPProxy: "http://127.0.0.1:7890"},
		},
		{
			name: "https stays direct when only http configured",
			content: `[Proxy Settings]
ProxyType=1
httpProxy=http://proxy.example:8080
`,
			want: &systemNetworkProxyConfig{HTTPProxy: "http://proxy.example:8080"},
		},
		{
			name: "https only",
			content: `[Proxy Settings]
ProxyType=1
httpsProxy=http://secure.example:7891
`,
			want: &systemNetworkProxyConfig{HTTPProxy: "", HTTPSProxy: "http://secure.example:7891"},
		},
		{
			name: "socks only",
			content: `[Proxy Settings]
ProxyType=1
socksProxy=socks://127.0.0.1:7890
`,
			want: &systemNetworkProxyConfig{HTTPProxy: "socks5://127.0.0.1:7890", HTTPSProxy: "socks5://127.0.0.1:7890"},
		},
		{
			name: "https uses socks when https unset",
			content: `[Proxy Settings]
ProxyType=1
httpProxy=http://proxy.example:8080
socksProxy=socks://127.0.0.1:7890
`,
			want: &systemNetworkProxyConfig{HTTPProxy: "http://proxy.example:8080", HTTPSProxy: "socks5://127.0.0.1:7890"},
		},
		{
			name: "local bypass",
			content: `[Proxy Settings]
ProxyType=1
httpProxy=http://127.0.0.1:7890
NoProxyFor=localhost,<local>
`,
			want: &systemNetworkProxyConfig{HTTPProxy: "http://127.0.0.1:7890",
				NoProxy: "localhost,<local>"},
		},
		{
			name: "url bypass",
			content: `[Proxy Settings]
ProxyType=1
httpProxy=http://127.0.0.1:7890
NoProxyFor=http://bugs.kde.org/,10.0.0.0/8
`,
			want: &systemNetworkProxyConfig{HTTPProxy: "http://127.0.0.1:7890",
				NoProxy: "bugs.kde.org,10.0.0.0/8"},
		},
		{
			name: "environment bypass merged",
			content: `[Proxy Settings]
ProxyType=1
httpProxy=http://127.0.0.1:7890
NoProxyFor=localhost
`,
			env: map[string]string{"no_proxy": "private.example"},
			want: &systemNetworkProxyConfig{HTTPProxy: "http://127.0.0.1:7890",
				NoProxy: "localhost,private.example"},
		},
		{
			name: "no proxy",
			content: `[Proxy Settings]
ProxyType=0
httpProxy=http://127.0.0.1:7890
`,
			want: nil,
		},
		{
			name: "missing proxy type",
			content: `[Proxy Settings]
httpProxy=http://127.0.0.1:7890
`,
			want: nil,
		},
		{
			name: "pac unsupported",
			content: `[Proxy Settings]
ProxyType=2
Proxy Config Script=http://127.0.0.1:7890/proxy.pac
`,
			wantErr: true,
		},
		{
			name: "wpad unsupported",
			content: `[Proxy Settings]
ProxyType=3
`,
			wantErr: true,
		},
		{
			name: "environment proxy mode",
			content: `[Proxy Settings]
ProxyType=4
httpProxy=http_proxy
`,
			want: nil,
		},
		{
			name: "reversed exception unsupported",
			content: `[Proxy Settings]
ProxyType=1
httpProxy=http://127.0.0.1:7890
NoProxyFor=localhost
ReversedException=true
`,
			wantErr: true,
		},
		{
			name:    "explicit environment wins",
			content: manualColon,
			env:     map[string]string{"HTTPS_PROXY": "http://environment:8080"},
			want:    nil,
		},
		{
			name: "invalid proxy address",
			content: `[Proxy Settings]
ProxyType=1
httpProxy=http://127.0.0.1 abc
`,
			wantErr: true,
		},
		{
			name:    "missing config",
			content: "",
			want:    nil,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := readKDENetworkProxy(kdeTestEnvironment(t, test.content, test.env))
			if test.wantErr {
				if err == nil {
					t.Fatalf("got %#v, want error", got)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, test.want) {
				t.Fatalf("got %#v, want %#v", got, test.want)
			}
		})
	}
}

func TestKDEProxyConfigHomeOverride(t *testing.T) {
	configHome, kdeHome := t.TempDir(), t.TempDir()
	write := func(path, content string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(filepath.Join(configHome, "kioslaverc"), `[Proxy Settings]
ProxyType=1
httpProxy=http://config-home:8080
`)
	write(filepath.Join(kdeHome, "share", "config", "kioslaverc"), `[Proxy Settings]
ProxyType=1
httpProxy=http://kde-home:8080
`)
	env := map[string]string{"XDG_CURRENT_DESKTOP": "KDE", "XDG_CONFIG_HOME": configHome, "KDEHOME": kdeHome}
	got, err := readKDENetworkProxy(func(name string) string { return env[name] })
	if err != nil {
		t.Fatal(err)
	}
	want := &systemNetworkProxyConfig{HTTPProxy: "http://kde-home:8080"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %#v, want %#v", got, want)
	}
}

func TestNormalizeKDEProxyValue(t *testing.T) {
	for _, test := range []struct {
		value, scheme string
		want          string
		wantErr       bool
	}{
		{"http://127.0.0.1:7890", "http", "http://127.0.0.1:7890", false},
		{"http://127.0.0.1 7890", "http", "http://127.0.0.1:7890", false},
		{"socks://127.0.0.1:7890", "socks5", "socks5://127.0.0.1:7890", false},
		{"SOCKS://127.0.0.1:7890", "socks5", "socks5://127.0.0.1:7890", false},
		{"127.0.0.1:7890", "http", "http://127.0.0.1:7890", false},
		{"", "http", "", false},
		{"//:0", "http", "", false},
		{"http://127.0.0.1 abc", "http", "", true},
		{"ftp://127.0.0.1:21", "http", "", true},
	} {
		got, err := normalizeKDEProxyValue(test.value, test.scheme)
		if test.wantErr {
			if err == nil {
				t.Errorf("%q: got %q, want error", test.value, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("%q: %v", test.value, err)
			continue
		}
		if got != test.want {
			t.Errorf("%q = %q, want %q", test.value, got, test.want)
		}
	}
}

func TestKDEProxyRouting(t *testing.T) {
	const proxies = "httpProxy=http://http-proxy:8080\nhttpsProxy=http://https-proxy:8443\n"
	originalEnvironment := systemNetworkProxyEnvironment
	systemNetworkProxyEnvironment = map[string]networkProxyEnvironmentValue{}
	t.Cleanup(func() {
		systemNetworkProxyEnvironment = originalEnvironment
	})
	for _, test := range []struct {
		name, settings, target, want string
	}{
		{"HTTPS stays direct", "httpProxy=http://http-proxy:8080\n", "https://example.com/", ""},
		{"HTTPS uses SOCKS fallback", "httpProxy=http://http-proxy:8080\nsocksProxy=socks://socks-proxy:1080\n", "https://example.com/", "socks5://socks-proxy:1080"},
		{"local single label", proxies + "NoProxyFor=<local>\n", "http://intranet/", ""},
		{"local HTTPS with port", proxies + "NoProxyFor=<local>\n", "https://nas:8443/", ""},
		{"local case insensitive", proxies + "NoProxyFor=<LOCAL>\n", "http://Intranet/", ""},
		{"local excludes qualified names", proxies + "NoProxyFor=<local>\n", "http://example.com/", "http://http-proxy:8080"},
		{"local excludes trailing dot", proxies + "NoProxyFor=<local>\n", "http://intranet./", "http://http-proxy:8080"},
		{"local excludes IPv4", proxies + "NoProxyFor=<local>\n", "http://192.168.1.12/", "http://http-proxy:8080"},
		{"local excludes IPv6", proxies + "NoProxyFor=<local>\n", "http://[2001:db8::1]/", "http://http-proxy:8080"},
		{"IPv4 loopback stays direct", proxies + "NoProxyFor=<local>\n", "http://127.0.0.1/", ""},
		{"IPv6 loopback stays direct", proxies + "NoProxyFor=<local>\n", "http://[::1]/", ""},
		{"localhost stays direct", proxies + "NoProxyFor=<local>\n", "http://localhost/", ""},
		{"single label without local", proxies, "http://intranet/", "http://http-proxy:8080"},
		{"local with domain exception", proxies + "NoProxyFor=<local>,example.com\n", "http://example.com/", ""},
		{"local with CIDR exception", proxies + "NoProxyFor=<local>,192.168.0.0/16\n", "http://192.168.1.12/", ""},
		{"HTTPS explicit proxy", proxies, "https://example.com/", "http://https-proxy:8443"},
	} {
		t.Run(test.name, func(t *testing.T) {
			for _, name := range networkProxyEnvironmentNames {
				t.Setenv(name, "")
			}
			getenv := kdeTestEnvironment(t, "[Proxy Settings]\nProxyType=1\n"+test.settings, nil)
			t.Setenv("XDG_CURRENT_DESKTOP", "KDE")
			t.Setenv("XDG_CONFIG_HOME", getenv("XDG_CONFIG_HOME"))
			t.Setenv("KDEHOME", "")
			SetNetworkProxy("", true)
			request, err := http.NewRequest(http.MethodGet, test.target, nil)
			if err != nil {
				t.Fatal(err)
			}
			proxy, err := httpclient.ProxyFromEnvironment(request)
			if err != nil {
				t.Fatal(err)
			}
			got := ""
			if proxy != nil {
				got = proxy.String()
			}
			if got != test.want {
				t.Fatalf("proxy for %s = %q, want %q", test.target, got, test.want)
			}
		})
	}
}

func TestKDESystemProxyModeTransitions(t *testing.T) {
	for _, name := range networkProxyEnvironmentNames {
		t.Setenv(name, "")
	}
	configHome := t.TempDir()
	content := `[Proxy Settings]
ProxyType=1
httpProxy=http://127.0.0.1:7890
httpsProxy=http://127.0.0.1:7891
socksProxy=socks://127.0.0.1:7892
NoProxyFor=localhost,<local>
`
	if err := os.WriteFile(filepath.Join(configHome, "kioslaverc"), []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("XDG_CURRENT_DESKTOP", "KDE")
	t.Setenv("XDG_CONFIG_HOME", configHome)
	originalEnvironment := systemNetworkProxyEnvironment
	systemNetworkProxyEnvironment = map[string]networkProxyEnvironmentValue{
		"NO_PROXY": {value: "private.example", set: true},
	}
	t.Cleanup(func() {
		systemNetworkProxyEnvironment = originalEnvironment
	})

	SetNetworkProxy("socks5://manual:1080", false)
	if got := os.Getenv("HTTPS_PROXY"); got != "socks5://manual:1080" {
		t.Fatalf("manual HTTPS = %q", got)
	}
	SetNetworkProxy("", true)
	if got := os.Getenv("HTTP_PROXY"); got != "http://127.0.0.1:7890" {
		t.Fatalf("system HTTP = %q", got)
	}
	if got := os.Getenv("HTTPS_PROXY"); got != "http://127.0.0.1:7891" {
		t.Fatalf("system HTTPS = %q", got)
	}
	if got := os.Getenv("NO_PROXY"); got != "localhost,<local>,private.example" {
		t.Fatalf("system bypass = %q", got)
	}
	SetNetworkProxy("", false)
	if got := os.Getenv("HTTP_PROXY"); got != "" {
		t.Fatalf("direct HTTP = %q", got)
	}
	if got := os.Getenv("NO_PROXY"); got != "private.example" {
		t.Fatalf("direct bypass = %q", got)
	}
}
