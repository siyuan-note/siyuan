// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"github.com/siyuan-note/siyuan/kernel/templatehttp"
)

func templateHTTPPermissionExecution(t *testing.T, suffix string) (*TemplateHTTPExecution, *websocket.Conn, string) {
	t.Helper()
	connection, app := templateHTTPTestWindow(t)
	execution, err := StartTemplateHTTPExecution(context.Background(), "permission-execution-"+suffix, app, "main", "document")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(execution.Close)
	return execution, connection, app
}

func templateHTTPPermissionTestStorage(t *testing.T) {
	t.Helper()
	setupTemplateHTTPPermissionTest(t)
	t.Cleanup(cancelTemplateHTTPExecutions)
}

func templateHTTPConfirmAnswer(t *testing.T, connection *websocket.Conn, execution *TemplateHTTPExecution, app, scope, choice string) bool {
	t.Helper()
	result := make(chan bool, 1)
	go func() {
		result <- execution.confirm(execution.ctx, templatehttp.Request{Method: "GET", URL: "https://example.com/first", Scope: scope})
	}()
	var event struct {
		Cmd  string
		Data struct {
			ConfirmID  string
			CanPersist bool
		}
	}
	connection.SetReadDeadline(time.Now().Add(time.Second))
	for event.Cmd != "templateHTTPConfirm" {
		if err := connection.ReadJSON(&event); err != nil {
			t.Fatal(err)
		}
	}
	if !event.Data.CanPersist {
		t.Fatal("trusted database source cannot persist")
	}
	if !RespondTemplateHTTP(execution.id, event.Data.ConfirmID, app, "main", true, choice) {
		t.Fatal("valid answer rejected")
	}
	select {
	case value := <-result:
		return value
	case <-time.After(time.Second):
		t.Fatal("confirmation did not resume")
	}
	return false
}

func TestTemplateHTTPSourceOnceCoversTargetsButNotNextExecution(t *testing.T) {
	templateHTTPPermissionTestStorage(t)
	execution, connection, app := templateHTTPPermissionExecution(t, "once")
	writeTemplateHTTPPermissionTestAV(t, permissionTestAVID, "field", "template", "httpGet")
	source, err := ResolveTemplateHTTPDBSource("global", permissionTestAVID, "field", "template", "httpGet")
	if err != nil {
		t.Fatal(err)
	}
	scope := registerTemplateHTTPSource(execution.Runtime, "", source)
	if !templateHTTPConfirmAnswer(t, connection, execution, app, scope, "once") {
		t.Fatal("once denied")
	}
	result := make(chan bool, 1)
	go func() {
		result <- execution.confirm(execution.ctx, templatehttp.Request{URL: "https://other.example/dynamic", Scope: scope})
	}()
	select {
	case value := <-result:
		if !value {
			t.Fatal("same source did not reuse once")
		}
	case <-time.After(time.Second):
		t.Fatal("same source prompted again")
	}
	allowed, err := CheckTemplateHTTPSource(source)
	if err != nil || allowed {
		t.Fatalf("once persisted: %v %v", allowed, err)
	}
	fresh, err := StartTemplateHTTPExecution(context.Background(), "permission-execution-fresh", app, "main", "document")
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.Close()
	freshScope := registerTemplateHTTPSource(fresh.Runtime, "", source)
	allowed, err = fresh.sourceAllowed(freshScope, source)
	if err != nil || allowed {
		t.Fatalf("once escaped execution: %v %v", allowed, err)
	}
}

func TestTemplateHTTPSourceAlwaysAndRevocationCancelPending(t *testing.T) {
	templateHTTPPermissionTestStorage(t)
	execution, connection, app := templateHTTPPermissionExecution(t, "always")
	writeTemplateHTTPPermissionTestAV(t, permissionTestAVID, "field", "template", "httpGet")
	source, err := ResolveTemplateHTTPDBSource("global", permissionTestAVID, "field", "template", "httpGet")
	if err != nil {
		t.Fatal(err)
	}
	scope := registerTemplateHTTPSource(execution.Runtime, "", source)
	if !templateHTTPConfirmAnswer(t, connection, execution, app, scope, "template") {
		t.Fatal("always denied")
	}
	allowed, err := CheckTemplateHTTPSource(source)
	if err != nil || !allowed {
		t.Fatalf("always not stored: %v %v", allowed, err)
	}
	fresh, err := StartTemplateHTTPExecution(context.Background(), "permission-execution-always-fresh", app, "main", "document")
	if err != nil {
		t.Fatal(err)
	}
	defer fresh.Close()
	freshScope := registerTemplateHTTPSource(fresh.Runtime, "", source)
	allowed, err = fresh.sourceAllowed(freshScope, source)
	if err != nil || !allowed {
		t.Fatalf("persistent source missing: %v %v", allowed, err)
	}
	if err = RevokeTemplateHTTPSource(source.ID); err != nil {
		t.Fatal(err)
	}
	if fresh.Runtime.Err() == nil || execution.Runtime.Err() == nil {
		t.Fatal("revocation left associated execution active")
	}
	if fresh.sourceGuard(context.Background(), freshScope) {
		t.Fatal("revoked source passed guard")
	}
	if err = GrantTemplateHTTPSource(source); err == nil {
		t.Fatal("stale in-flight source restored permission")
	}
}

func TestTemplateHTTPSourceVersionAndFieldAreIndependent(t *testing.T) {
	templateHTTPPermissionTestStorage(t)
	writeTemplateHTTPPermissionTestAV(t, permissionTestAVID, "first", "template", "httpGet")
	first, err := ResolveTemplateHTTPDBSource("global", permissionTestAVID, "first", "template", "httpGet")
	if err != nil {
		t.Fatal(err)
	}
	if err = GrantTemplateHTTPSource(first); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"second", "first"} {
		slot := "template"
		if field == "first" {
			slot = "renderTemplate"
		}
		writeTemplateHTTPPermissionTestAV(t, permissionTestAVID, field, slot, "httpGet")
		other, resolveErr := ResolveTemplateHTTPDBSource("global", permissionTestAVID, field, slot, "httpGet")
		if resolveErr != nil {
			t.Fatal(resolveErr)
		}
		allowed, checkErr := CheckTemplateHTTPSource(other)
		if checkErr != nil || allowed {
			t.Fatal("another field or slot inherited permission")
		}
	}
	writeTemplateHTTPPermissionTestAV(t, permissionTestAVID, "first", "template", "changed httpGet")
	if _, err = ResolveTemplateHTTPDBSource("global", permissionTestAVID, "first", "template", "changed httpGet"); err != nil {
		t.Fatal(err)
	}
	writeTemplateHTTPPermissionTestAV(t, permissionTestAVID, "first", "template", "httpGet")
	restored, err := ResolveTemplateHTTPDBSource("global", permissionTestAVID, "first", "template", "httpGet")
	if err != nil {
		t.Fatal(err)
	}
	allowed, err := CheckTemplateHTTPSource(restored)
	if err != nil || allowed || restored.ID == first.ID {
		t.Fatalf("restoring old text revived permission: %v %v", allowed, err)
	}
}
