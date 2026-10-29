// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
