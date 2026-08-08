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
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestPreserveMCPServerIDsForOlderFrontend(t *testing.T) {
	oldServers := []conf.MCPServer{
		{ID: "first-id", Name: "first"},
		{ID: "second-id", Name: "second"},
	}
	newServers := []conf.MCPServer{
		{Name: "first"},
		{Name: "second"},
		{ID: "new-id", Name: "new"},
	}
	preserveMCPServerIDs(oldServers, newServers)
	if newServers[0].ID != "first-id" || newServers[1].ID != "second-id" || newServers[2].ID != "new-id" {
		t.Fatalf("unexpected MCP server IDs: %#v", newServers)
	}
}

func TestMCPOAuthCallbackRejectsRemoteClientThroughLocalProxy(t *testing.T) {
	engine := gin.New()
	if err := engine.SetTrustedProxies([]string{"127.0.0.1", "::1"}); err != nil {
		t.Fatal(err)
	}
	engine.RemoteIPHeaders = []string{"X-Forwarded-For"}
	engine.GET("/api/ai/mcp/oauth/callback/:flowID", mcpOAuthCallback)

	request := httptest.NewRequest(http.MethodGet, "/api/ai/mcp/oauth/callback/test-flow", nil)
	request.RemoteAddr = "127.0.0.1:1234"
	request.Header.Set("X-Forwarded-For", "192.0.2.10")
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusForbidden)
	}
}
