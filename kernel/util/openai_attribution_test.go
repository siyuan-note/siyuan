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
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

// aimlapiPartnerIDPattern 是 AI/ML API 对 X-AIMLAPI-Partner-ID 的取值约束：
// part_ 前缀加 1 到 64 位字母数字，不允许连字符或下划线。
// 取值不合法时服务端不会报错，只是把请求算作无来源，因此必须由测试兜住。
var aimlapiPartnerIDPattern = regexp.MustCompile(`^part_[A-Za-z0-9]{1,64}$`)

// aimlapiSourcePattern 是 X-AIMLAPI-Source 的取值约束：<channel>/<client>，
// channel 为 web、agent、mcp 三选一，client 为小写字母数字与连字符。
var aimlapiSourcePattern = regexp.MustCompile(`^(web|agent|mcp)/[a-z0-9-]{1,32}$`)

func TestProviderAttributionHeadersWellFormed(t *testing.T) {
	// 内置清单里的每一项都必须是可用的取值，取值写错在运行时没有任何报错信号。
	for host, headers := range providerAttributionHeaders {
		if host != strings.ToLower(host) {
			t.Errorf("attribution host [%s] must be lower case for case-insensitive lookup", host)
		}
		if "" == headers["HTTP-Referer"] || "" == headers["X-Title"] {
			t.Errorf("attribution headers for [%s] must identify the calling application", host)
		}
		if !strings.Contains(headers["HTTP-Referer"], "siyuan") {
			t.Errorf("HTTP-Referer for [%s] must point at SiYuan, got %q", host, headers["HTTP-Referer"])
		}
		if "api.aimlapi.com" != host {
			continue
		}
		if partnerID := headers["X-AIMLAPI-Partner-ID"]; !aimlapiPartnerIDPattern.MatchString(partnerID) {
			t.Errorf("X-AIMLAPI-Partner-ID %q does not match %s", partnerID, aimlapiPartnerIDPattern)
		}
		if source := headers["X-AIMLAPI-Source"]; !aimlapiSourcePattern.MatchString(source) {
			t.Errorf("X-AIMLAPI-Source %q does not match %s", source, aimlapiSourcePattern)
		}
	}
}

func TestAttributionHeadersForHost(t *testing.T) {
	cases := []struct {
		host string
		want bool
	}{
		{"api.aimlapi.com", true},
		{"API.AIMLAPI.COM", true}, // 大小写不敏感
		{" api.aimlapi.com ", true},
		{"api.openai.com", false},
		{"api.aimlapi.com.evil.example", false}, // 后缀伪装的域名不得命中
		{"aimlapi.com", false},
		{"localhost", false},
		{"", false},
	}
	for _, tc := range cases {
		got := AttributionHeadersForHost(tc.host)
		if (0 < len(got)) != tc.want {
			t.Errorf("AttributionHeadersForHost(%q) matched = %v, want %v", tc.host, 0 < len(got), tc.want)
		}
	}
}

func TestAttributionHeadersForHostReturnsCopy(t *testing.T) {
	// 返回值必须是副本，调用方改动不得污染内置清单，否则一次改动会影响此后所有请求。
	first := AttributionHeadersForHost("api.aimlapi.com")
	first["X-AIMLAPI-Partner-ID"] = "tampered"
	delete(first, "X-Title")

	second := AttributionHeadersForHost("api.aimlapi.com")
	if "part_7cceWAMI91xwz7G6FrcOEUwN" != second["X-AIMLAPI-Partner-ID"] {
		t.Fatalf("shared attribution map was mutated, got %q", second["X-AIMLAPI-Partner-ID"])
	}
	if "" == second["X-Title"] {
		t.Fatal("shared attribution map lost a key after the caller deleted it")
	}
}

func TestAttributionTransportInjectsForKnownHost(t *testing.T) {
	// 目标主机命中清单时，四个请求头都应出现在实际发出的请求上。
	var captured http.Header
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured = r.Header.Clone()
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{}`))
	}))
	defer server.Close()

	// 请求写成真实的 AI/ML API 地址以命中清单，再由 redirectDoer 改投到本地测试服务器。
	transport := &attributionTransport{base: &redirectDoer{base: server.Client(), addr: server.Listener.Addr().String()}}
	req, _ := http.NewRequest(http.MethodPost, "https://api.aimlapi.com/v1/chat/completions", strings.NewReader("{}"))
	resp, err := transport.Do(req)
	if nil != err {
		t.Fatalf("Do failed: %v", err)
	}
	defer resp.Body.Close()

	want := map[string]string{
		"Http-Referer":         "https://github.com/siyuan-note/siyuan",
		"X-Title":              "SiYuan",
		"X-Aimlapi-Source":     "agent/siyuan",
		"X-Aimlapi-Partner-Id": "part_7cceWAMI91xwz7G6FrcOEUwN",
	}
	for name, value := range want {
		if got := captured.Get(name); got != value {
			t.Errorf("header %s = %q, want %q", name, got, value)
		}
	}
}

func TestAttributionTransportSkipsOtherHost(t *testing.T) {
	// 目标主机不在清单中时（含仅仅转发同一 API 的第三方代理），一个请求头都不能带上。
	var captured http.Header
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured = r.Header.Clone()
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{}`))
	}))
	defer server.Close()

	transport := &attributionTransport{base: server.Client()}
	req, _ := http.NewRequest(http.MethodPost, server.URL+"/v1/chat/completions", strings.NewReader("{}"))
	resp, err := transport.Do(req)
	if nil != err {
		t.Fatalf("Do failed: %v", err)
	}
	defer resp.Body.Close()

	for _, name := range []string{"X-Aimlapi-Partner-Id", "X-Aimlapi-Source", "Http-Referer", "X-Title"} {
		if got := captured.Get(name); "" != got {
			t.Errorf("header %s leaked to a non-matching host: %q", name, got)
		}
	}
}

func TestAttributionTransportKeepsExistingHeader(t *testing.T) {
	// 上层已经设置过的同名请求头必须原样保留，注入只补空缺、不覆盖。
	req, _ := http.NewRequest(http.MethodPost, "https://api.aimlapi.com/v1/chat/completions", strings.NewReader("{}"))
	req.Header.Set("X-Title", "Custom")

	var captured http.Header
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured = r.Header.Clone()
		w.Write([]byte(`{}`))
	}))
	defer server.Close()

	transport := &attributionTransport{base: &redirectDoer{base: server.Client(), addr: server.Listener.Addr().String()}}
	resp, err := transport.Do(req)
	if nil != err {
		t.Fatalf("Do failed: %v", err)
	}
	defer resp.Body.Close()

	if "Custom" != captured.Get("X-Title") {
		t.Errorf("existing X-Title was overwritten, got %q", captured.Get("X-Title"))
	}
	if "part_7cceWAMI91xwz7G6FrcOEUwN" != captured.Get("X-Aimlapi-Partner-Id") {
		t.Errorf("missing header was not filled in, got %q", captured.Get("X-Aimlapi-Partner-Id"))
	}
}

// redirectDoer 把请求改投到本地测试服务器，用于在不联网的前提下断言真实发出的请求头。
type redirectDoer struct {
	base *http.Client
	addr string
}

func (d *redirectDoer) Do(req *http.Request) (*http.Response, error) {
	req.URL.Scheme = "http"
	req.URL.Host = d.addr
	return d.base.Do(req)
}
