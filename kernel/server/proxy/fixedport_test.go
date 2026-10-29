// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package proxy

import (
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestFixedPortReverseProxyRebuildsForwardedHeaders(t *testing.T) {
	requestInfo := make(chan http.Header, 1)
	hostInfo := make(chan string, 1)
	backend := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestInfo <- request.Header.Clone()
		hostInfo <- request.Host
		writer.WriteHeader(http.StatusNoContent)
	}))
	defer backend.Close()

	proxy := httptest.NewServer(newFixedPortReverseProxy(mustParseURL(t, backend.URL)))
	defer proxy.Close()

	request, err := http.NewRequest(http.MethodGet, proxy.URL+"/api/system/getWorkspaceInfo", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Host = "192.0.2.1:6806"
	request.Header.Set("Forwarded", "for=127.0.0.1")
	request.Header.Set("X-Forwarded-For", "127.0.0.1")
	request.Header.Set("X-Forwarded-Host", "127.0.0.1:6806")
	request.Header.Set("X-Forwarded-Proto", "https")

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("proxy returned %d, want %d", response.StatusCode, http.StatusNoContent)
	}

	headers := <-requestInfo
	forwardedFor := headers.Get("X-Forwarded-For")
	if ip := net.ParseIP(forwardedFor); ip == nil || !ip.IsLoopback() {
		t.Fatalf("X-Forwarded-For = %q, want proxy client loopback address", forwardedFor)
	}
	if actual := headers.Get("X-Forwarded-Host"); actual != request.Host {
		t.Fatalf("X-Forwarded-Host = %q, want %q", actual, request.Host)
	}
	if actual := headers.Get("X-Forwarded-Proto"); actual != "http" {
		t.Fatalf("X-Forwarded-Proto = %q, want http", actual)
	}
	if actual := headers.Get("Forwarded"); actual != "" {
		t.Fatalf("Forwarded = %q, want empty", actual)
	}
	if actual := <-hostInfo; actual != request.Host {
		t.Fatalf("Host = %q, want %q", actual, request.Host)
	}
}

func mustParseURL(t *testing.T, rawURL string) *url.URL {
	t.Helper()
	parsed, err := url.Parse(rawURL)
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}
