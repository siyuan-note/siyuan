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

import "testing"

func TestParseSystemNetworkProxy(t *testing.T) {
	tests := []struct {
		name          string
		proxyServer   string
		proxyOverride string
		wantHTTP      string
		wantHTTPS     string
		wantNoProxy   string
	}{
		{
			name:          "shared HTTP proxy",
			proxyServer:   "127.0.0.1:10808",
			proxyOverride: "<local>;localhost;127.*;10.*;172.16.*;192.168.*",
			wantHTTP:      "http://127.0.0.1:10808",
			wantHTTPS:     "http://127.0.0.1:10808",
			wantNoProxy:   "localhost,127.0.0.1,::1,127.0.0.0/8,10.0.0.0/8,172.16.0.0/16,192.168.0.0/16",
		},
		{
			name:        "protocol-specific proxies",
			proxyServer: "http=proxy.example.com:80;https=secure.example.com:81",
			wantHTTP:    "http://proxy.example.com:80",
			wantHTTPS:   "http://secure.example.com:81",
		},
		{
			name:        "SOCKS proxy fallback",
			proxyServer: "socks=127.0.0.1:1080",
			wantHTTP:    "socks5://127.0.0.1:1080",
			wantHTTPS:   "socks5://127.0.0.1:1080",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := parseSystemNetworkProxy(test.proxyServer, test.proxyOverride)
			if err != nil {
				t.Fatalf("parse system proxy failed: %v", err)
			}
			if got.HTTPProxy != test.wantHTTP || got.HTTPSProxy != test.wantHTTPS || got.NoProxy != test.wantNoProxy {
				t.Fatalf("parse system proxy = %#v, want HTTP %q, HTTPS %q, no proxy %q", got, test.wantHTTP, test.wantHTTPS, test.wantNoProxy)
			}
		})
	}
}

func TestParseSystemNetworkProxyRejectsUnsupportedProxy(t *testing.T) {
	if _, err := parseSystemNetworkProxy("ftp=proxy.example.com:21", ""); nil == err {
		t.Fatal("unsupported system proxy should fail")
	}
	if _, err := parseSystemNetworkProxy("http://", ""); nil == err {
		t.Fatal("invalid system proxy should fail")
	}
}
