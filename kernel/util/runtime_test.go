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
	"os"
	"testing"
)

func TestSetNetworkProxy(t *testing.T) {
	for _, name := range networkProxyEnvironmentNames {
		t.Setenv(name, os.Getenv(name))
	}
	original := systemNetworkProxyEnvironment
	systemNetworkProxyEnvironment = map[string]networkProxyEnvironmentValue{
		"HTTP_PROXY":  {value: "http://environment-http", set: true},
		"HTTPS_PROXY": {value: "http://environment-https", set: true},
		"http_proxy":  {value: "http://environment-http", set: true},
		"https_proxy": {value: "http://environment-https", set: true},
		"NO_PROXY":    {value: "environment.local", set: true},
		"no_proxy":    {value: "environment.local", set: true},
	}
	originalLoader := loadSystemNetworkProxy
	loadSystemNetworkProxy = func() (*systemNetworkProxyConfig, error) {
		return &systemNetworkProxyConfig{
			HTTPProxy:  "http://system-http",
			HTTPSProxy: "http://system-https",
			NoProxy:    "localhost,10.0.0.0/8",
		}, nil
	}
	t.Cleanup(func() {
		systemNetworkProxyEnvironment = original
		loadSystemNetworkProxy = originalLoader
	})

	SetNetworkProxy("http://configured", false)
	for _, name := range append(networkProxyHTTPEnvironmentNames, networkProxyHTTPSEnvironmentNames...) {
		if got := os.Getenv(name); got != "http://configured" {
			t.Fatalf("%s = %q, want configured proxy", name, got)
		}
	}
	for _, name := range networkProxyBypassEnvironmentNames {
		if got := os.Getenv(name); got != "environment.local" {
			t.Fatalf("%s = %q, want original bypass", name, got)
		}
	}

	SetNetworkProxy("", false)
	for _, name := range append(networkProxyHTTPEnvironmentNames, networkProxyHTTPSEnvironmentNames...) {
		if got := os.Getenv(name); got != "" {
			t.Fatalf("%s = %q, want direct connection", name, got)
		}
	}

	SetNetworkProxy("", true)
	if got := os.Getenv("HTTP_PROXY"); got != "http://system-http" {
		t.Fatalf("HTTP_PROXY = %q, want system proxy", got)
	}
	if got := os.Getenv("HTTPS_PROXY"); got != "http://system-https" {
		t.Fatalf("HTTPS_PROXY = %q, want system proxy", got)
	}
	if got := os.Getenv("NO_PROXY"); got != "localhost,10.0.0.0/8" {
		t.Fatalf("NO_PROXY = %q, want system bypass", got)
	}
}
