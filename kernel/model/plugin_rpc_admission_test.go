// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestPluginRPCHandshakeReleasesWriteAdmission(t *testing.T) {
	for _, entry := range []struct {
		route, path string
		idle        bool
	}{
		{"/ws/plugin/rpc", "/ws/plugin/rpc?name=test", true},
		{"/ws/plugin/rpc/:name", "/ws/plugin/rpc/test", true},
		{"/api/test/write", "/api/test/write", false},
	} {
		t.Run(entry.path, func(t *testing.T) {
			task := prepareSyncCheckoutStateTest(t)
			entered, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
			engine := gin.New()
			engine.GET(entry.route, func(c *gin.Context) { c.Set(RoleContextKey, RoleAdministrator) }, CheckReadonly, func(c *gin.Context) {
				close(entered)
				<-release
			})
			go func() {
				defer close(done)
				engine.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, entry.path, nil))
			}()
			defer func() { close(release); <-done }()
			<-entered
			err := task.prepareApply()
			if entry.idle {
				if err != nil || !IsSyncCheckoutApplying() {
					t.Fatalf("idle RPC connection blocked sync: %v", err)
				}
				task.completeApply()
			} else if !errors.Is(err, dejavu.ErrIndexFileChanged) {
				t.Fatalf("ordinary write lost its admission lease: %v", err)
			}
		})
	}
}

func TestPluginRPCWriteAdmission(t *testing.T) {
	task := prepareSyncCheckoutStateTest(t)
	previousReadonly := util.ReadOnly
	previousRecovery := dataImportRecoveryRequired.Load()
	t.Cleanup(func() { util.ReadOnly = previousReadonly; dataImportRecoveryRequired.Store(previousRecovery) })
	util.Langs["en"][34] = "Read only"
	util.Langs["en"][239] = "Busy"
	util.Langs["en"][424] = "Recovery required"
	release, err := AcquirePluginRPCWrite()
	if err != nil {
		t.Fatal(err)
	}
	if dataImportAccess.TryLock() {
		dataImportAccess.Unlock()
		release()
		t.Fatal("active RPC did not exclude sync/import")
	}
	release()
	if err = task.prepareApply(); err != nil {
		t.Fatal(err)
	}
	if release, err = AcquirePluginRPCWrite(); err == nil {
		release()
		t.Fatal("RPC admitted during sync application")
	}
	for _, path := range []string{"/ws/plugin/rpc", "/ws/plugin/rpc/:name"} {
		engine := gin.New()
		called := false
		engine.GET(path, func(c *gin.Context) { c.Set(RoleContextKey, RoleAdministrator) }, CheckReadonly, func(c *gin.Context) { called = true })
		engine.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, path, nil))
		if called {
			t.Fatal("handshake admitted during sync application")
		}
	}
	task.completeApply()
	for _, state := range []string{"readonly", "recovery", "import"} {
		t.Run(state, func(t *testing.T) {
			util.ReadOnly = state == "readonly"
			dataImportRecoveryRequired.Store(state == "recovery")
			if state == "import" {
				dataImportAccess.Lock()
				defer dataImportAccess.Unlock()
			}
			release, err := AcquirePluginRPCWrite()
			if err == nil {
				release()
				t.Fatal("RPC admitted while workspace was unavailable")
			}
			if state != "import" {
				for _, route := range []string{"/ws/plugin/rpc", "/ws/plugin/rpc/:name"} {
					engine := gin.New()
					called := false
					engine.GET(route, func(c *gin.Context) { c.Set(RoleContextKey, RoleAdministrator) }, CheckReadonly,
						func(c *gin.Context) { called = true })
					engine.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, route, nil))
					if called {
						t.Fatalf("%s handshake was admitted during %s", route, state)
					}
				}
			}
		})
	}
	util.ReadOnly = false
	dataImportRecoveryRequired.Store(false)
	if !dataImportAccess.TryLock() {
		t.Fatal("rejected RPC leaked a read lease")
	}
	dataImportAccess.Unlock()
}
