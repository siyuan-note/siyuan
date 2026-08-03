// SiYuan - Refactor your thinking
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

// TestIsSessionOriginAllowed 验证会话 Cookie 认证的 Origin 校验逻辑
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-hhm2-g993-p656
func TestIsSessionOriginAllowed(t *testing.T) {
	tests := []struct {
		name   string
		origin string
		host   string
		want   bool
	}{
		{name: "no origin header", origin: "", host: "127.0.0.1:6806", want: true},
		{name: "local loopback origin", origin: "http://127.0.0.1:6806", host: "127.0.0.1:6806", want: true},
		{name: "localhost origin", origin: "http://localhost:6806", host: "localhost:6806", want: true},
		{name: "cross-site origin", origin: "https://evil.example", host: "127.0.0.1:6806", want: false},
		{name: "remote access with matching host", origin: "http://192.168.1.5:6806", host: "192.168.1.5:6806", want: true},
		{name: "remote access with same host different port", origin: "http://192.168.1.5:8080", host: "192.168.1.5:6806", want: false},
		{name: "default port normalized", origin: "http://192.168.1.5:80", host: "192.168.1.5", want: true},
		{name: "https default port normalized", origin: "https://192.168.1.5:443", host: "192.168.1.5", want: true},
		{name: "null origin", origin: "null", host: "127.0.0.1:6806", want: false},
		{name: "malformed origin", origin: "://bad", host: "127.0.0.1:6806", want: false},
		{name: "origin without host header", origin: "http://192.168.1.5:6806", host: "", want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := IsSessionOriginAllowed(test.origin, test.host); got != test.want {
				t.Fatalf("IsSessionOriginAllowed(%q, %q) = %v, want %v", test.origin, test.host, got, test.want)
			}
		})
	}
}
