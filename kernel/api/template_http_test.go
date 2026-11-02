// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAPIContractTemplateHTTPControls(t *testing.T) {
	engine := gin.New()
	engine.POST("/api/template/respondHTTP", respondTemplateHTTP)
	engine.POST("/api/template/cancelHTTP", cancelTemplateHTTP)
	for _, entry := range []struct {
		path, body string
		code       int
	}{
		{"respondHTTP", `{"executionID":"ended","confirmID":"old","approved":true,"app":"app","session":"main"}`, 0},
		{"respondHTTP", `{"executionID":"ended","confirmID":"old","approved":"yes","app":"app","session":"main"}`, -1},
		{"cancelHTTP", `{"executionID":"ended","app":"app","session":"main"}`, 0},
		{"cancelHTTP", `{"executionID":"","app":"app","session":"main","httpConfirmToken":"expired"}`, 0},
		{"cancelHTTP", `{"executionID":"","app":"app","session":"main","httpConfirmToken":false}`, -1},
		{"cancelHTTP", `{"executionID":false,"app":"app","session":"main"}`, -1},
	} {
		path := "/api/template/" + entry.path
		response := httptest.NewRecorder()
		engine.ServeHTTP(response, httptest.NewRequest("POST", path, strings.NewReader(entry.body)))
		requireAPIContract(t, "POST", path, response)
		var envelope struct{ Code int }
		if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil || envelope.Code != entry.code {
			t.Fatalf("control contract mismatch: %s %v", response.Body.String(), err)
		}
	}
}

func TestAPIContractTemplateHTTPBackgroundDoesNotPrompt(t *testing.T) {
	engine := gin.New()
	engine.POST("/api/template/renderSprig", renderSprig)
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, httptest.NewRequest("POST", "/api/template/renderSprig", strings.NewReader(`{"template":"{{(httpGet \"https://example.com\").error}}"}`)))
	requireAPIContract(t, "POST", "/api/template/renderSprig", response)
	var envelope struct {
		Code int
		Data string
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil || envelope.Code != 0 || envelope.Data != "interaction_required" {
		t.Fatalf("background execution mismatch: %s %v", response.Body.String(), err)
	}
}

func TestAPIContractTemplateHTTPPermissionDoesNotGrant(t *testing.T) {
	previousConf := model.Conf
	model.Conf = &model.AppConf{Lang: "en"}
	t.Cleanup(func() { model.Conf = previousConf })
	oldConfDir := util.ConfDir
	util.ConfDir = t.TempDir()
	t.Cleanup(func() { util.ConfDir = oldConfDir })
	engine := gin.New()
	engine.POST("/api/template/httpPermission", templateHTTPPermission)
	for _, entry := range []struct {
		body string
		code int
	}{
		{`{"action":"grant","kind":"file","path":"example.md"}`, -1},
		{`{"action":"get","kind":"file","path":"../conf.json"}`, -1},
		{`{"action":"get","kind":"other"}`, -1},
		{`{"action":"get","kind":true}`, -1},
		{`{"action":"revokeAll"}`, 0},
	} {
		result := httptest.NewRecorder()
		engine.ServeHTTP(result, httptest.NewRequest("POST", "/api/template/httpPermission", strings.NewReader(entry.body)))
		requireAPIContract(t, "POST", "/api/template/httpPermission", result)
		var response struct{ Code int }
		if err := json.Unmarshal(result.Body.Bytes(), &response); err != nil || response.Code != entry.code {
			t.Fatalf("permission contract: %s %v", result.Body.String(), err)
		}
	}
}
