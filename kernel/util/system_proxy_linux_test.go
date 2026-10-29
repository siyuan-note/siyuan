// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build linux && !android

package util

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func gnomeProxyTestSettings() map[string]string {
	return map[string]string{
		gnomeProxySchema + ".mode":                    "'manual'",
		gnomeProxySchema + ".ignore-hosts":            "['localhost', '127.0.0.0/8', '::1']",
		gnomeProxySchema + ".http.host":               "'127.0.0.1'",
		gnomeProxySchema + ".http.port":               "7890",
		gnomeProxySchema + ".http.use-authentication": "false",
		gnomeProxySchema + ".https.host":              "'127.0.0.1'",
		gnomeProxySchema + ".https.port":              "7891",
		gnomeProxySchema + ".socks.host":              "'::1'",
		gnomeProxySchema + ".socks.port":              "7892",
	}
}

func readGNOMEProxyTestSettings(settings map[string]string) gnomeProxySettingReader {
	return func(ctx context.Context, schema, key string) (string, error) {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		value, ok := settings[schema+"."+key]
		if !ok {
			return "", errors.New("setting unavailable")
		}
		return value, nil
	}
}

func TestGNOMEProxySession(t *testing.T) {
	for _, test := range []struct {
		current, session, desktop string
		want                      bool
	}{
		{"GNOME", "", "", true},
		{"ubuntu:GNOME", "", "", true},
		{"GNOME:GNOME-Classic", "", "", true},
		{"gnome", "", "", true},
		{"KDE", "gnome", "gnome", false},
		{"X-Cinnamon", "", "", false},
		{"", "gnome", "", true},
		{"", "", "gnome-classic", true},
		{"", "plasma", "", false},
		{"", "plasma", "gnome", false},
		{"", "", "", false},
	} {
		env := map[string]string{"XDG_CURRENT_DESKTOP": test.current, "XDG_SESSION_DESKTOP": test.session, "DESKTOP_SESSION": test.desktop}
		if got := isGNOMEProxySession(func(name string) string { return env[name] }); got != test.want {
			t.Errorf("session %#v = %v, want %v", test, got, test.want)
		}
	}
}

func TestGNOMENetworkProxyEnvironmentPriority(t *testing.T) {
	for _, variable := range []string{"HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"} {
		t.Run(variable, func(t *testing.T) {
			env := map[string]string{"XDG_CURRENT_DESKTOP": "GNOME", variable: "http://environment:8080"}
			read := func(context.Context, string, string) (string, error) {
				t.Fatal("explicit proxy environment must not read GNOME settings")
				return "", nil
			}
			got, err := readGNOMENetworkProxy(context.Background(), func(name string) string { return env[name] }, read)
			if err != nil || got != nil {
				t.Fatalf("got %#v, %v; want environment fallback", got, err)
			}
		})
	}
	for _, desktop := range []string{"KDE", "XFCE", ""} {
		got, err := readGNOMENetworkProxy(context.Background(), func(name string) string {
			if name == "XDG_CURRENT_DESKTOP" {
				return desktop
			}
			return ""
		}, func(context.Context, string, string) (string, error) {
			t.Fatal("other desktops must not invoke gsettings")
			return "", nil
		})
		if err != nil || got != nil {
			t.Fatalf("desktop %q: got %#v, %v", desktop, got, err)
		}
	}
}

func TestGNOMENetworkProxy(t *testing.T) {
	for _, test := range []struct {
		name, httpHost, httpPort, httpsHost, socksHost string
		wantHTTP, wantHTTPS                            string
	}{
		{"separate HTTP HTTPS", "'127.0.0.1'", "7890", "'secure.example'", "'::1'", "http://127.0.0.1:7890", "http://secure.example:7891"},
		{"HTTPS falls back to HTTP before SOCKS", "'proxy.example'", "7890", "''", "'::1'", "http://proxy.example:7890", "http://proxy.example:7890"},
		{"SOCKS only", "''", "7890", "''", "'::1'", "socks5://[::1]:7892", "socks5://[::1]:7892"},
		{"SOCKS with HTTPS", "''", "7890", "'secure.example'", "'::1'", "socks5://[::1]:7892", "http://secure.example:7891"},
		{"disabled HTTP port", "'proxy.example'", "0", "''", "'::1'", "socks5://[::1]:7892", "socks5://[::1]:7892"},
		{"bracketed IPv6", "'[2001:db8::1]'", "7890", "''", "''", "http://[2001:db8::1]:7890", "http://[2001:db8::1]:7890"},
	} {
		t.Run(test.name, func(t *testing.T) {
			settings := gnomeProxyTestSettings()
			settings[gnomeProxySchema+".http.host"] = test.httpHost
			settings[gnomeProxySchema+".http.port"] = test.httpPort
			settings[gnomeProxySchema+".https.host"] = test.httpsHost
			settings[gnomeProxySchema+".socks.host"] = test.socksHost
			env := map[string]string{"XDG_CURRENT_DESKTOP": "GNOME", "no_proxy": "private.example,localhost", "NO_PROXY": "ignored.example"}
			got, err := readGNOMENetworkProxy(context.Background(), func(name string) string { return env[name] }, readGNOMEProxyTestSettings(settings))
			want := &systemNetworkProxyConfig{HTTPProxy: test.wantHTTP, HTTPSProxy: test.wantHTTPS, NoProxy: "localhost,127.0.0.0/8,::1,private.example"}
			if err != nil || !reflect.DeepEqual(got, want) {
				t.Fatalf("got %#v, %v; want %#v", got, err, want)
			}
		})
	}
}

func TestGNOMEProxyBypassSemantics(t *testing.T) {
	settings := gnomeProxyTestSettings()
	settings[gnomeProxySchema+".ignore-hosts"] = "['*.corp.example', '.other.example', 'corp.example', '*', '10.0.0.0/8', '2001:db8::/32']"
	env := map[string]string{"XDG_CURRENT_DESKTOP": "GNOME", "no_proxy": "*.env.example,.private.example"}
	got, err := readGNOMENetworkProxy(context.Background(), func(name string) string { return env[name] }, readGNOMEProxyTestSettings(settings))
	if err != nil {
		t.Fatal(err)
	}
	want := "corp.example,other.example,10.0.0.0/8,2001:db8::/32,*.env.example,.private.example"
	if got.NoProxy != want {
		t.Fatalf("bypass = %q, want %q", got.NoProxy, want)
	}
}

func TestGNOMENetworkProxyInvalidSettings(t *testing.T) {
	for _, test := range []struct{ key, value string }{
		{"mode", "'auto'"}, {"mode", "'unknown'"}, {"mode", "manual"},
		{"http.host", "'http://bad'"}, {"http.host", "'user@host'"}, {"http.host", "'host:8080'"},
		{"http.host", "'host name'"}, {"http.host", "'host\\nname'"}, {"http.host", "'unterminated"},
		{"http.port", "-1"}, {"http.port", "65536"}, {"http.port", "'7890'"},
		{"http.use-authentication", "true"}, {"http.use-authentication", "invalid"},
		{"ignore-hosts", "['one' 'two']"}, {"ignore-hosts", "['one,two']"},
	} {
		t.Run(test.key+"/"+test.value, func(t *testing.T) {
			settings := gnomeProxyTestSettings()
			settings[gnomeProxySchema+"."+test.key] = test.value
			got, err := readGNOMENetworkProxy(context.Background(), func(name string) string {
				if name == "XDG_CURRENT_DESKTOP" {
					return "GNOME"
				}
				return ""
			}, readGNOMEProxyTestSettings(settings))
			if err == nil || got != nil {
				t.Fatalf("got %#v, %v; want error without partial proxy config", got, err)
			}
		})
	}
}

func TestGNOMENetworkProxyUnavailable(t *testing.T) {
	getenv := func(name string) string {
		if name == "XDG_CURRENT_DESKTOP" {
			return "GNOME"
		}
		return ""
	}
	settings := gnomeProxyTestSettings()
	settings[gnomeProxySchema+".mode"] = "'none'"
	if got, err := readGNOMENetworkProxy(context.Background(), getenv, readGNOMEProxyTestSettings(settings)); err != nil || got != nil {
		t.Fatalf("disabled proxy = %#v, %v", got, err)
	}
	for _, key := range []string{"http.host", "https.host", "socks.host"} {
		settings[gnomeProxySchema+"."+key] = "''"
	}
	settings[gnomeProxySchema+".mode"] = "'manual'"
	if got, err := readGNOMENetworkProxy(context.Background(), getenv, readGNOMEProxyTestSettings(settings)); err != nil || got != nil {
		t.Fatalf("empty manual proxy = %#v, %v", got, err)
	}
	if got, err := readGNOMENetworkProxy(context.Background(), getenv, readGNOMEProxyTestSettings(nil)); err == nil || got != nil {
		t.Fatalf("missing schema = %#v, %v", got, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if got, err := readGNOMENetworkProxy(ctx, getenv, readGNOMEProxyTestSettings(gnomeProxyTestSettings())); err == nil || got != nil {
		t.Fatalf("cancelled read = %#v, %v", got, err)
	}
}

func TestGNOMEProxyGVariantStrings(t *testing.T) {
	for _, test := range []struct {
		input string
		want  []string
	}{
		{"@as []", []string{}}, {"[]", []string{}},
		{`['localhost', "quoted'host", 'escaped\'host', 'back\\slash', '\u4e2d',]`, []string{"localhost", "quoted'host", "escaped'host", `back\slash`, "中"}},
	} {
		got, err := parseGNOMEProxyStrings(test.input)
		if err != nil || !reflect.DeepEqual(got, test.want) {
			t.Fatalf("parse %q = %#v, %v", test.input, got, err)
		}
	}
	for _, input := range []string{"", "[", "['x'", "['x']junk", "['x',,]", "['\\q']", "['x' 'y']"} {
		if _, err := parseGNOMEProxyStrings(input); err == nil {
			t.Fatalf("accepted invalid list %q", input)
		}
	}
}

func TestGNOMEProxyCommandTimeoutAndMissing(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("PATH", dir)
	if _, err := readGNOMEProxySetting(context.Background(), gnomeProxySchema, "mode"); err == nil {
		t.Fatal("missing command must fail")
	}
	// 用本地替身验证超时，不读取或修改真实桌面配置。
	script := "#!/bin/sh\nexec /bin/sleep 10\n"
	if err := os.WriteFile(filepath.Join(dir, "gsettings"), []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	started := time.Now()
	if _, err := readGNOMEProxySetting(ctx, gnomeProxySchema, "mode"); err == nil {
		t.Fatal("timed out command must fail")
	}
	if time.Since(started) > time.Second {
		t.Fatal("gsettings timeout was not bounded")
	}
	if !strings.Contains(ctx.Err().Error(), "deadline") {
		t.Fatalf("unexpected context error: %v", ctx.Err())
	}
}

func TestGNOMEProxyGSettingsKeyfile(t *testing.T) {
	gsettings, err := exec.LookPath("gsettings")
	if err != nil {
		t.Skip("gsettings is not installed")
	}
	// 隔离到临时 keyfile 后端，不读取或更改当前用户的 dconf 数据。
	t.Setenv("GSETTINGS_BACKEND", "keyfile")
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	t.Setenv("XDG_CURRENT_DESKTOP", "GNOME")
	for _, name := range []string{"HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy"} {
		t.Setenv(name, "")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	schemas, err := exec.CommandContext(ctx, gsettings, "list-schemas").Output()
	if err != nil || !strings.Contains(string(schemas), gnomeProxySchema+"\n") {
		t.Skip("GNOME proxy schema is not installed")
	}
	settings := gnomeProxyTestSettings()
	settings[gnomeProxySchema+".ignore-hosts"] = "['*.corp.example', '::1']"
	for name, value := range settings {
		index := strings.LastIndex(name, ".")
		if output, err := exec.CommandContext(ctx, gsettings, "set", name[:index], name[index+1:], value).CombinedOutput(); err != nil {
			t.Fatalf("configure isolated setting %s: %v, %s", name, err, output)
		}
	}
	got, err := readSystemNetworkProxy()
	want := &systemNetworkProxyConfig{HTTPProxy: "http://127.0.0.1:7890", HTTPSProxy: "http://127.0.0.1:7891", NoProxy: "corp.example,::1"}
	if err != nil || !reflect.DeepEqual(got, want) {
		t.Fatalf("real gsettings read = %#v, %v; want %#v", got, err, want)
	}
}
