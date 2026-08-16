// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// TestHistoryRouteBlocksSensitiveSnapshots 验证 /history 路由拒绝历史快照中的敏感文件副本
// （data/.siyuan/publishAccess.json、data/templates、data/snippets/conf.json），
// 且不影响普通历史文件访问。
func TestHistoryRouteBlocksSensitiveSnapshots(t *testing.T) {
	gin.SetMode(gin.TestMode)
	originalHistoryDir := util.HistoryDir
	util.HistoryDir = t.TempDir()
	t.Cleanup(func() {
		util.HistoryDir = originalHistoryDir
	})

	snapshot := filepath.Join(util.HistoryDir, "2026-08-15-120000-sync")
	writeFile := func(rel string, content string) string {
		p := filepath.Join(snapshot, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
		return p
	}
	writeFile(filepath.Join(".siyuan", "publishAccess.json"), `{"id":"","password":"secret"}`)
	writeFile(filepath.Join("templates", "private.md"), "template")
	writeFile(filepath.Join("snippets", "conf.json"), `{"enabled":true}`)
	writeFile(filepath.Join("assets", "image.png"), "asset")

	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(model.RoleContextKey, model.RoleAdministrator)
		c.Next()
	})
	serveAssets(engine)

	for _, test := range []struct {
		requestPath string
		wantStatus  int
	}{
		{"/history/2026-08-15-120000-sync/.siyuan/publishAccess.json", http.StatusForbidden},
		{"/history/2026-08-15-120000-sync/templates/private.md", http.StatusForbidden},
		{"/history/2026-08-15-120000-sync/snippets/conf.json", http.StatusForbidden},
		{"/history/2026-08-15-120000-sync/assets/image.png", http.StatusOK},
	} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, test.requestPath, nil))
		if recorder.Code != test.wantStatus {
			t.Fatalf("GET %s returned %d, want %d", test.requestPath, recorder.Code, test.wantStatus)
		}
	}
}

// TestRepoDiffRouteBlocksSensitivePaths 验证 /repo/diff 路由按数据相对路径拒绝敏感文件（纵深防御），
// 且不影响正常资源文件访问。
func TestRepoDiffRouteBlocksSensitivePaths(t *testing.T) {
	gin.SetMode(gin.TestMode)
	originalTempDir, originalConf := util.TempDir, model.Conf
	util.TempDir = t.TempDir()
	model.Conf = model.NewAppConf()
	t.Cleanup(func() {
		util.TempDir = originalTempDir
		model.Conf = originalConf
	})

	diffDir := filepath.Join(util.TempDir, "repo", "diff")
	allowedPath := filepath.Join(diffDir, "assets", "image.png")
	if err := os.MkdirAll(filepath.Dir(allowedPath), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(allowedPath, []byte("asset"), 0644); err != nil {
		t.Fatal(err)
	}

	engine := gin.New()
	engine.Use(func(c *gin.Context) {
		c.Set(model.RoleContextKey, model.RoleAdministrator)
		c.Next()
	})
	serveRepoDiff(engine)

	for _, test := range []struct {
		requestPath string
		wantStatus  int
	}{
		{"/repo/diff/.siyuan/publishAccess.json", http.StatusForbidden},
		{"/repo/diff/templates/private.md", http.StatusForbidden},
		{"/repo/diff/snippets/conf.json", http.StatusForbidden},
		{"/repo/diff/assets/image.png", http.StatusOK},
	} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, test.requestPath, nil))
		if recorder.Code != test.wantStatus {
			t.Fatalf("GET %s returned %d, want %d", test.requestPath, recorder.Code, test.wantStatus)
		}
	}
}
