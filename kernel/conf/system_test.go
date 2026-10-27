// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
