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
