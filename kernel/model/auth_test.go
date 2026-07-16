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

package model

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestPluginJWTLifecycle(t *testing.T) {
	previousLifetime := pluginJWTLifetime
	previousRefreshAhead := pluginJWTRefreshAhead
	t.Cleanup(func() {
		pluginJWTLifetime = previousLifetime
		pluginJWTRefreshAhead = previousRefreshAhead
		_ = InitJwtKey()
	})
	pluginJWTLifetime = time.Hour
	pluginJWTRefreshAhead = 10 * time.Minute
	if err := InitJwtKey(); err != nil {
		t.Fatal(err)
	}

	tokenString, err := CreatePluginJWT("test-plugin")
	if err != nil {
		t.Fatal(err)
	}
	token, err := ParseJWT(tokenString)
	if err != nil {
		t.Fatalf("expected active plugin JWT to parse, got %v", err)
	}
	if subject := GetPluginJWTSubject(token); subject != "test-plugin" {
		t.Fatalf("expected plugin subject, got %q", subject)
	}
	claims := GetTokenClaims(token)
	if role := GetClaimRole(claims); role != RoleKernelPlugin {
		t.Fatalf("expected kernel plugin role, got %v", role)
	}
	if _, err = claims.GetExpirationTime(); err != nil {
		t.Fatalf("expected plugin JWT expiration, got %v", err)
	}
	if jti, ok := claims["jti"].(string); !ok || jti == "" {
		t.Fatalf("expected plugin JWT identifier, got %v", claims["jti"])
	}
	if PluginJWTNeedsRefresh(tokenString) {
		t.Fatal("expected fresh plugin JWT not to require rotation")
	}

	RevokePluginJWT(tokenString)
	if _, err = ParseJWT(tokenString); err == nil {
		t.Fatal("expected revoked plugin JWT to be rejected")
	}
}

func TestPluginJWTRefreshAndExpiration(t *testing.T) {
	previousLifetime := pluginJWTLifetime
	previousRefreshAhead := pluginJWTRefreshAhead
	t.Cleanup(func() {
		pluginJWTLifetime = previousLifetime
		pluginJWTRefreshAhead = previousRefreshAhead
		_ = InitJwtKey()
	})
	if err := InitJwtKey(); err != nil {
		t.Fatal(err)
	}

	pluginJWTLifetime = 5 * time.Minute
	pluginJWTRefreshAhead = 10 * time.Minute
	tokenString, err := CreatePluginJWT("refresh-plugin")
	if err != nil {
		t.Fatal(err)
	}
	if !PluginJWTNeedsRefresh(tokenString) {
		t.Fatal("expected near-expiry plugin JWT to require rotation")
	}

	pluginJWTLifetime = -time.Minute
	expiredToken, err := CreatePluginJWT("expired-plugin")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ParseJWT(expiredToken); err == nil {
		t.Fatal("expected expired plugin JWT to be rejected")
	}
}

func TestKernelPluginRoleIsRestrictedToRequiredEndpoints(t *testing.T) {
	gin.SetMode(gin.TestMode)
	invoke := func(path string, middleware gin.HandlerFunc) (int, bool) {
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest(http.MethodPost, path, nil)
		context.Set(RoleContextKey, RoleKernelPlugin)
		middleware(context)
		return recorder.Code, context.IsAborted()
	}
	for _, path := range []string{
		"/api/sync/kernel/begin",
		"/api/notebook/lsNotebooks",
		"/ws/network/proxy",
	} {
		if status, aborted := invoke(path, CheckAuth); aborted || status != http.StatusOK {
			t.Fatalf("kernel plugin access to %s was rejected: status=%d aborted=%v", path, status, aborted)
		}
	}
	if status, aborted := invoke("/api/file/getFile", CheckAuth); !aborted || status != http.StatusForbidden {
		t.Fatalf("kernel plugin accessed an unrelated API: status=%d aborted=%v", status, aborted)
	}
	if status, aborted := invoke("/ws/network/proxy", CheckAdminRole); aborted || status != http.StatusOK {
		t.Fatalf("kernel plugin WebSocket proxy access was rejected: status=%d aborted=%v", status, aborted)
	}
	if status, aborted := invoke("/api/system/exit", CheckAdminRole); !aborted || status != http.StatusForbidden {
		t.Fatalf("kernel plugin received administrator access: status=%d aborted=%v", status, aborted)
	}
}
