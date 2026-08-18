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

package conf

import "testing"

func TestNetworkProxyString(t *testing.T) {
	tests := []struct {
		name  string
		proxy NetworkProxy
		want  string
	}{
		{name: "direct", proxy: NetworkProxy{}, want: ""},
		{name: "system", proxy: NetworkProxy{Scheme: "system"}, want: ""},
		{name: "configured", proxy: NetworkProxy{Scheme: "socks5", Host: "127.0.0.1", Port: "1080"}, want: "socks5://127.0.0.1:1080"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := test.proxy.String(); got != test.want {
				t.Fatalf("NetworkProxy.String() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestNetworkProxyIsSystem(t *testing.T) {
	if !(&NetworkProxy{Scheme: "system"}).IsSystem() {
		t.Fatal("system proxy should be detected")
	}
	if (&NetworkProxy{}).IsSystem() {
		t.Fatal("direct connection should not be detected as system proxy")
	}
}
