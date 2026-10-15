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
	request := httptest.NewRequest(http.MethodGet, "/", nil)
	request.RemoteAddr = "127.0.0.1:54321"
	request.Header.Set(ClientTLSHeader, ClientTLSHeaderValue)
	if !IsTLSRequest(request) {
		t.Fatal("local proxy marked connection should be treated as TLS")
	}

	// 远端调用方伪造同名头部不得被采信
	request.RemoteAddr = "192.0.2.10:54321"
	if IsTLSRequest(request) {
		t.Fatal("forged client TLS header from a remote peer must be ignored")
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
