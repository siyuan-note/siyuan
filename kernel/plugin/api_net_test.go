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

package plugin

import "testing"

func TestNormalizePeerHost(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "host with port", in: "Example.COM:6806", want: "example.com:6806"},
		{name: "ws default port", in: "ws://Example.COM/path", want: "example.com:80"},
		{name: "wss default port", in: "wss://Example.COM/path", want: "example.com:443"},
		{name: "ipv4 default port", in: "127.0.0.1", want: "127.0.0.1:80"},
		{name: "ipv6 default port", in: "::1", want: "[::1]:80"},
		{name: "bracketed ipv6 with port", in: "ws://[::1]:6806/path", want: "[::1]:6806"},
		{name: "blank", in: "  ", want: ""},
		{name: "invalid", in: "://bad", want: ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := normalizePeerHost(tt.in); got != tt.want {
				t.Fatalf("normalizePeerHost(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}
