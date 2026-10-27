// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestShouldRedirectToTLS(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		remoteAddr string
		requestURI string
		tls        bool
		want       bool
	}{
		{name: "plaintext from other host", method: http.MethodPost, remoteAddr: "192.0.2.10:54321", requestURI: "/api/system/loginAuth", want: true},
		{name: "plaintext loopback", method: http.MethodPost, remoteAddr: "127.0.0.1:54321", requestURI: "/api/system/loginAuth", want: false},
		{name: "plaintext ipv6 loopback", method: http.MethodGet, remoteAddr: "[::1]:54321", requestURI: "/api/system/version", want: false},
		{name: "cors preflight from other host", method: http.MethodOptions, remoteAddr: "192.0.2.10:54321", requestURI: "/api/system/getConf", want: false},
		{name: "already tls", method: http.MethodGet, remoteAddr: "192.0.2.10:54321", requestURI: "/api/system/version", tls: true, want: false},
		{name: "absolute request target", method: http.MethodGet, remoteAddr: "192.0.2.10:54321", requestURI: "https://evil.example/", want: false},
		{name: "protocol relative request target", method: http.MethodGet, remoteAddr: "192.0.2.10:54321", requestURI: "//evil.example/", want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(test.method, "/", nil)
			request.RemoteAddr = test.remoteAddr
			request.RequestURI = test.requestURI
			if test.tls {
				request.TLS = &tls.ConnectionState{}
			}
			if actual := ShouldRedirectToTLS(request); actual != test.want {
				t.Fatalf("ShouldRedirectToTLS = %v, want %v", actual, test.want)
			}
		})
	}
}

func TestIsTLSRequestHonorsClientTLSHeaderOnlyForLocalPeers(t *testing.T) {
	if IsTLSRequest(nil) {
		t.Fatal("nil request must not be treated as TLS")
	}

	tests := []struct {
		name       string
		remoteAddr string
		header     string
		tls        bool
		want       bool
	}{
		{name: "local HTTPS client over HTTP backend", remoteAddr: "127.0.0.1:54321", header: ClientTLSHeaderValue, want: true},
		{name: "local HTTP client over HTTPS backend", remoteAddr: "127.0.0.1:54321", header: ClientTLSHeaderPlaintextValue, tls: true},
		{name: "IPv6 local HTTP client over HTTPS backend", remoteAddr: "[::1]:54321", header: ClientTLSHeaderPlaintextValue, tls: true},
		{name: "local HTTPS client over HTTPS backend", remoteAddr: "127.0.0.1:54321", header: ClientTLSHeaderValue, tls: true, want: true},
		{name: "local direct TLS without marker", remoteAddr: "127.0.0.1:54321", tls: true, want: true},
		{name: "local direct HTTP without marker", remoteAddr: "127.0.0.1:54321"},
		{name: "local invalid marker over TLS", remoteAddr: "127.0.0.1:54321", header: "invalid", tls: true, want: true},
		{name: "local invalid marker over HTTP", remoteAddr: "127.0.0.1:54321", header: "invalid"},
		{name: "remote forged HTTPS marker", remoteAddr: "192.0.2.10:54321", header: ClientTLSHeaderValue},
		{name: "remote forged HTTP marker over TLS", remoteAddr: "192.0.2.10:54321", header: ClientTLSHeaderPlaintextValue, tls: true, want: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/", nil)
			request.RemoteAddr = test.remoteAddr
			if test.header != "" {
				request.Header.Set(ClientTLSHeader, test.header)
			}
			if test.tls {
				request.TLS = &tls.ConnectionState{}
			}
			if actual := IsTLSRequest(request); actual != test.want {
				t.Fatalf("IsTLSRequest = %v, want %v", actual, test.want)
			}
		})
	}
}

func TestIsSecureRequest(t *testing.T) {
	tests := []struct {
		name       string
		remoteAddr string
		tls        bool
		want       bool
	}{
		{name: "tls connection", remoteAddr: "192.0.2.10:54321", tls: true, want: true},
		{name: "plaintext loopback", remoteAddr: "127.0.0.1:54321", want: true},
		{name: "plaintext from other host", remoteAddr: "192.0.2.10:54321", want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/", nil)
			request.RemoteAddr = test.remoteAddr
			if test.tls {
				request.TLS = &tls.ConnectionState{}
			}
			if actual := IsSecureRequest(request); actual != test.want {
				t.Fatalf("IsSecureRequest = %v, want %v", actual, test.want)
			}
		})
	}
}

func TestIsValidRedirectHost(t *testing.T) {
	valid := []string{"notes.example.com", "notes.example.com:6806", "127.0.0.1:6806", "[::1]:6806", "localhost"}
	for _, host := range valid {
		if !IsValidRedirectHost(host) {
			t.Fatalf("IsValidRedirectHost(%q) = false, want true", host)
		}
	}

	invalid := []string{"", " notes.example.com", "notes.example.com/evil", "notes.example.com:evil",
		"notes.example.com:0", "notes.example.com:70000", "user@notes.example.com", "notes.example.com#x", "notes.example.com:"}
	for _, host := range invalid {
		if IsValidRedirectHost(host) {
			t.Fatalf("IsValidRedirectHost(%q) = true, want false", host)
		}
	}
}
