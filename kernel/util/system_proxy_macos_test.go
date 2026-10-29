// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"context"
	"errors"
	"net/url"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"

	"golang.org/x/net/http/httpproxy"
)

const macOSManualProxyFixture = `<dictionary> {
  ExceptionsList : <array> {
    0 : *.local
    1 : 169.254/16
    2 : 10.*
    3 : ::1
    4 : private.example
    5 : *.local
  }
  ExcludeSimpleHostnames : 0
  HTTPEnable : 1
  HTTPPort : 7890
  HTTPProxy : 127.0.0.1
  HTTPSEnable : 1
  HTTPSPort : 7891
  HTTPSProxy : 127.0.0.1
  SOCKSEnable : 1
  SOCKSPort : 7892
  SOCKSProxy : 127.0.0.1
}`

func TestParseMacOSNetworkProxy(t *testing.T) {
	tests := []struct {
		name, input string
		want        *systemNetworkProxyConfig
	}{
		{"manual proxies and bypass", macOSManualProxyFixture, &systemNetworkProxyConfig{
			HTTPProxy: "http://127.0.0.1:7890", HTTPSProxy: "http://127.0.0.1:7891",
			NoProxy: "*.local,169.254.0.0/16,10.0.0.0/8,::1,private.example",
		}},
		{"HTTP does not supply HTTPS", "<dictionary> {\nHTTPEnable : 1\nHTTPProxy : localhost\nHTTPPort : 8080\n}",
			&systemNetworkProxyConfig{HTTPProxy: "http://localhost:8080"}},
		{"HTTPS does not supply HTTP", "<dictionary> {\nHTTPSEnable : 1\nHTTPSProxy : proxy.example\nHTTPSPort : 8081\n}",
			&systemNetworkProxyConfig{HTTPSProxy: "http://proxy.example:8081"}},
		{"SOCKS fallback and IPv6", "<dictionary> {\nSOCKSEnable : 1\nSOCKSProxy : ::1\nSOCKSPort : 1080\n}",
			&systemNetworkProxyConfig{HTTPProxy: "socks5://[::1]:1080", HTTPSProxy: "socks5://[::1]:1080"}},
		{"HTTP and SOCKS fallback", "<dictionary> {\nHTTPEnable : 1\nHTTPProxy : proxy.example\nHTTPPort : 8080\nSOCKSEnable : 1\nSOCKSProxy : [::1]\nSOCKSPort : 1080\n}",
			&systemNetworkProxyConfig{HTTPProxy: "http://proxy.example:8080", HTTPSProxy: "socks5://[::1]:1080"}},
		{"disabled stale values", "<dictionary> {\nHTTPEnable : 0\nHTTPProxy : stale\nHTTPPort : invalid\n}", nil},
		{"empty dictionary", "<dictionary> {\n}", nil},
		{"no configuration", "No proxy configuration available\n", nil},
		{"nested settings do not enable global proxy", "<dictionary> {\n__SCOPED__ : <dictionary> {\nen0 : <dictionary> {\nHTTPEnable : 1\nHTTPProxy : scoped.example\nHTTPPort : 8080\n}\n}\n}", nil},
		{"disabled PAC URL", "<dictionary> {\nProxyAutoConfigEnable : 0\nProxyAutoConfigURLString : http://pac.example/proxy.pac\n}", nil},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := parseMacOSNetworkProxy(test.input)
			if err != nil || !reflect.DeepEqual(got, test.want) {
				t.Fatalf("proxy = %#v, error = %v, want %#v", got, err, test.want)
			}
		})
	}
}

func TestParseMacOSNetworkProxyRejectsInvalidConfig(t *testing.T) {
	for _, test := range []struct{ name, input string }{
		{"empty output", ""},
		{"unclosed dictionary", "<dictionary> {\nHTTPEnable : 1"},
		{"extra closing brace", "<dictionary> {\n}\n}"},
		{"trailing output", "<dictionary> {\n}\nsecret"},
		{"duplicate key", "<dictionary> {\nHTTPEnable : 1\nHTTPEnable : 0\n}"},
		{"invalid flag", "<dictionary> {\nHTTPEnable : true\n}"},
		{"PAC", "<dictionary> {\nProxyAutoConfigEnable : 1\n}"},
		{"automatic discovery", "<dictionary> {\nProxyAutoDiscoveryEnable : 1\n}"},
		{"missing host", "<dictionary> {\nHTTPEnable : 1\nHTTPPort : 8080\n}"},
		{"missing port", "<dictionary> {\nHTTPEnable : 1\nHTTPProxy : secret.example\n}"},
		{"zero port", strings.Replace(macOSManualProxyFixture, "HTTPPort : 7890", "HTTPPort : 0", 1)},
		{"negative port", strings.Replace(macOSManualProxyFixture, "HTTPPort : 7890", "HTTPPort : -1", 1)},
		{"large port", strings.Replace(macOSManualProxyFixture, "HTTPPort : 7890", "HTTPPort : 65536", 1)},
		{"host contains credentials", strings.Replace(macOSManualProxyFixture, "HTTPProxy : 127.0.0.1", "HTTPProxy : secret:password@host", 1)},
		{"host contains path", strings.Replace(macOSManualProxyFixture, "HTTPProxy : 127.0.0.1", "HTTPProxy : host/secret", 1)},
		{"host contains whitespace", strings.Replace(macOSManualProxyFixture, "HTTPProxy : 127.0.0.1", "HTTPProxy : secret host", 1)},
		{"simple hostname exclusion", strings.Replace(macOSManualProxyFixture, "ExcludeSimpleHostnames : 0", "ExcludeSimpleHostnames : 1", 1)},
		{"bypass is not array", strings.Replace(macOSManualProxyFixture, "ExceptionsList : <array>", "ExceptionsList : <dictionary>", 1)},
		{"bypass indices have gap", strings.Replace(macOSManualProxyFixture, "0 : *.local", "8 : *.local", 1)},
		{"bypass contains delimiter", strings.Replace(macOSManualProxyFixture, "0 : *.local", "0 : secret,*", 1)},
		{"bypass contains unsupported glob", strings.Replace(macOSManualProxyFixture, "0 : *.local", "0 : secret.*.example", 1)},
		{"nested flag", "<dictionary> {\nHTTPEnable : <array> {\n}\n}"},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := parseMacOSNetworkProxy(test.input)
			if err == nil || got != nil {
				t.Fatalf("invalid settings accepted: %#v, %v", got, err)
			}
			if strings.Contains(err.Error(), "secret") || strings.Contains(err.Error(), "password") {
				t.Fatalf("configuration leaked in error: %v", err)
			}
		})
	}
}

func TestMacOSProxyBypassEntry(t *testing.T) {
	for _, test := range []struct{ input, want string }{
		{"169.254/16", "169.254.0.0/16"}, {"10/8", "10.0.0.0/8"},
		{"192.168.1.3/24", "192.168.1.0/24"}, {"2001:db8::/32", "2001:db8::/32"},
		{"10.*", "10.0.0.0/8"}, {"192.168.*.*", "192.168.0.0/16"},
		{"*.local", "*.local"}, {".example.com", ".example.com"},
		{"private.example", "private.example"}, {"127.0.0.1", "127.0.0.1"}, {"::1", "::1"},
		{"*", "*"}, {"", ""},
	} {
		got, err := macOSProxyBypassEntry(test.input)
		if err != nil || got != test.want {
			t.Errorf("bypass %q = %q, %v, want %q", test.input, got, err, test.want)
		}
	}
	for _, input := range []string{"10.999.*", "host.*", "*example.com", "10.*.1", "one,two", "host:80", "host/path", "10/99", "<local>", "host name", "host\x00", "*.*.local"} {
		if _, err := macOSProxyBypassEntry(input); err == nil {
			t.Errorf("unsupported bypass %q accepted", input)
		}
	}
}

func TestMacOSProxyRouting(t *testing.T) {
	proxy, err := parseMacOSNetworkProxy(macOSManualProxyFixture)
	if err != nil {
		t.Fatal(err)
	}
	resolve := (&httpproxy.Config{HTTPProxy: proxy.HTTPProxy, HTTPSProxy: proxy.HTTPSProxy, NoProxy: proxy.NoProxy}).ProxyFunc()
	for _, test := range []struct{ target, want string }{
		{"http://public.example", "http://127.0.0.1:7890"},
		{"https://public.example", "http://127.0.0.1:7891"},
		{"https://printer.local", ""}, {"https://169.254.3.4", ""},
		{"https://10.2.3.4", ""}, {"http://[::1]", ""}, {"https://private.example", ""},
	} {
		target, err := url.Parse(test.target)
		if err != nil {
			t.Fatal(err)
		}
		got, err := resolve(target)
		actual := ""
		if got != nil {
			actual = got.String()
		}
		if err != nil || actual != test.want {
			t.Errorf("route %s = %q, %v, want %q", test.target, actual, err, test.want)
		}
	}
}

func clearMacOSProxyTestEnvironment(t *testing.T) {
	t.Helper()
	for _, name := range []string{"HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy"} {
		t.Setenv(name, "")
	}
}

func TestReadMacOSNetworkProxy(t *testing.T) {
	t.Run("explicit environment takes priority as a group", func(t *testing.T) {
		for _, name := range []string{"HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"} {
			t.Run(name, func(t *testing.T) {
				clearMacOSProxyTestEnvironment(t)
				t.Setenv(name, "http://environment.example:8080")
				got, err := readMacOSNetworkProxy(context.Background(), func(context.Context) (string, error) {
					t.Fatal("explicit environment should skip scutil")
					return "", nil
				})
				if got != nil || err != nil {
					t.Fatalf("environment override = %#v, %v", got, err)
				}
			})
		}
	})
	t.Run("NO_PROXY does not prevent system reading", func(t *testing.T) {
		clearMacOSProxyTestEnvironment(t)
		t.Setenv("NO_PROXY", "environment.example")
		if runtime.GOOS != "windows" {
			t.Setenv("no_proxy", "lower.example")
		}
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		got, err := readMacOSNetworkProxy(ctx, func(actual context.Context) (string, error) {
			if actual != ctx {
				t.Fatal("reader did not receive command context")
			}
			return macOSManualProxyFixture, nil
		})
		if err != nil || got == nil || !strings.HasSuffix(got.NoProxy, ",environment.example") || strings.Contains(got.NoProxy, "lower.example") {
			t.Fatalf("bypass merge = %#v, %v", got, err)
		}
	})
	t.Run("lowercase bypass fallback", func(t *testing.T) {
		clearMacOSProxyTestEnvironment(t)
		t.Setenv("no_proxy", "lower.example")
		got, err := readMacOSNetworkProxy(context.Background(), func(context.Context) (string, error) {
			return macOSManualProxyFixture, nil
		})
		if err != nil || got == nil || !strings.HasSuffix(got.NoProxy, ",lower.example") {
			t.Fatalf("lowercase bypass merge = %#v, %v", got, err)
		}
	})
	t.Run("command failure and cancellation are redacted", func(t *testing.T) {
		clearMacOSProxyTestEnvironment(t)
		for _, failure := range []error{errors.New("secret proxy credentials"), context.DeadlineExceeded} {
			got, err := readMacOSNetworkProxy(context.Background(), func(context.Context) (string, error) {
				return macOSManualProxyFixture, failure
			})
			if got != nil || err == nil || strings.Contains(err.Error(), "secret") {
				t.Fatalf("command failure = %#v, %v", got, err)
			}
		}
	})
}
