// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestStdioMCPServerIDsWithEnvironment(t *testing.T) {
	servers := []conf.MCPServer{
		{ID: "enabled", Enabled: true, Type: "stdio", Env: map[string]string{"KEY": "value"}},
		{ID: "inherited-only", Enabled: true, Type: "stdio", InheritEnv: []string{"PATH"}},
		{ID: "disabled", Type: "stdio", Env: map[string]string{"KEY": "value"}},
		{ID: "http", Enabled: true, Type: "http", Env: map[string]string{"KEY": "value"}},
	}
	if got, want := stdioMCPServerIDsWithEnvironment(servers), []string{"enabled"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("unexpected server IDs: got %#v, want %#v", got, want)
	}
}
