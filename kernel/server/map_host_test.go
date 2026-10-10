// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestMapHostPolicy(t *testing.T) {
	for _, provider := range []string{"openfreemap"} {
		policy, ok := mapHostPolicy("localhost:6806", provider)
		if !ok || !strings.Contains(policy, "sandbox allow-scripts;") ||
			strings.Contains(policy, "allow-same-origin") || strings.Contains(policy, "'unsafe-eval'") ||
			strings.Contains(policy, "connect-src 'self'") || !strings.Contains(policy, "form-action 'none'") {
			t.Fatalf("unsafe policy for %s: %s", provider, policy)
		}
		wrapper, valid := mapWrapperPolicy("localhost:6806", provider)
		if !valid || !strings.Contains(wrapper, "frame-src localhost:6806/stage/map/index.html;") ||
			!strings.Contains(wrapper, "script-src localhost:6806/stage/build/map/wrapper.js;") ||
			!strings.Contains(wrapper, "style-src 'unsafe-inline' localhost:6806/stage/map/host.css;") ||
			!strings.Contains(wrapper, "connect-src 'none'") || strings.Contains(wrapper, "https://") ||
			strings.Contains(wrapper, "script-src 'self'") {
			t.Fatalf("unsafe wrapper policy for %s: %s", provider, wrapper)
		}
	}
	for _, host := range []string{"", "localhost; script-src *", "a.example/path", "user@host", "host\nvalue", "host?x=1", "host'"} {
		if _, ok := mapHostPolicy(host, "openfreemap"); ok {
			t.Fatalf("accepted host %q", host)
		}
		if _, ok := mapWrapperPolicy(host, "openfreemap"); ok {
			t.Fatalf("accepted wrapper host %q", host)
		}
	}
	if _, ok := mapHostPolicy("localhost:6806", "custom"); ok {
		t.Fatal("accepted arbitrary provider")
	}
	if _, ok := mapWrapperPolicy("localhost:6806", "custom"); ok {
		t.Fatal("accepted arbitrary wrapper provider")
	}
}

func TestMapHostRejectsRemovedProviders(t *testing.T) {
	for _, provider := range []string{"amap", "tencent", "baidu", "custom", ""} {
		if _, ok := mapHostPolicy("localhost:6806", provider); ok {
			t.Fatalf("accepted provider %q", provider)
		}
		if _, ok := mapWrapperPolicy("localhost:6806", provider); ok {
			t.Fatalf("accepted wrapper provider %q", provider)
		}
	}
	policy, ok := mapHostPolicy("localhost:6806", "openfreemap")
	if !ok || !strings.Contains(policy, "https://tiles.openfreemap.org") {
		t.Fatal("missing built-in tile source")
	}
	for _, host := range []string{"amap.com", "autonavi.com", "qq.com", "baidu.com", "bdimg.com"} {
		if strings.Contains(policy, host) {
			t.Fatalf("retained removed host %s", host)
		}
	}
}

func TestMapHostStaticIsolationHeaders(t *testing.T) {
	old := util.WorkingDir
	oldBypass := util.SiYuanAccessAuthCodeBypass
	util.SiYuanAccessAuthCodeBypass = false
	util.WorkingDir = t.TempDir()
	t.Cleanup(func() { util.WorkingDir = old; util.SiYuanAccessAuthCodeBypass = oldBypass })
	for _, file := range mapHostFiles {
		full := filepath.Join(util.WorkingDir, file)
		if err := os.MkdirAll(filepath.Dir(full), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte("fixture"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	router.Use(mapHostMiddleware())
	router.Static("/stage", filepath.Join(util.WorkingDir, "stage"))
	router.GET("/api/conf", func(c *gin.Context) { c.String(200, "ordinary route") })
	for _, path := range []string{"/stage/map/index.html?provider=openfreemap", "/stage/build/map/host.js",
		"/stage/map/wrapper.html?provider=openfreemap", "/stage/build/map/wrapper.js"} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != 200 || response.Body.String() != "fixture" ||
			response.Header().Get("Cache-Control") != "no-store" ||
			response.Header().Get("Access-Control-Allow-Origin") != "*" ||
			response.Header().Get("Access-Control-Allow-Credentials") != "" ||
			response.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Fatalf("unexpected resource response %s: %d %v", path, response.Code, response.Header())
		}
		if strings.Contains(path, "index.html") && !strings.Contains(response.Header().Get("Content-Security-Policy"), "sandbox allow-scripts") {
			t.Fatal("missing enforced sandbox")
		}
		if strings.Contains(path, "wrapper.html") && !strings.Contains(response.Header().Get("Content-Security-Policy"), "frame-src example.com/stage/map/index.html;") {
			t.Fatal("missing wrapper navigation boundary")
		}
	}
	for _, path := range []string{"/stage/map/index.html", "/stage/map/index.html?provider=custom", "/stage/map/index.html?provider=amap", "/stage/map/wrapper.html?provider=tencent", "/stage/map/index.html?provider=baidu", "/stage/map/wrapper.html", "/stage/map/wrapper.html?provider=custom",
		"/stage/map/private.json", "/stage/build/map/host.js.map", "/stage/map%2findex.html?provider=openfreemap", "/stage/Map/wrapper.html?provider=openfreemap",
		"/stage/.%2fmap/index.html?provider=openfreemap", "/stage/%2fmap/index.html?provider=openfreemap",
		"/stage/anything/..%2fmap/index.html?provider=openfreemap", "/stage/build/.%2fmap/host.js",
		"/stage/%5cmap%5cindex.html?provider=openfreemap", "/stage/Map/index.html?provider=openfreemap",
		"/stage/build/MAP/host.js", "/stage/map./index.html?provider=openfreemap", "/stage/map%20/index.html?provider=openfreemap"} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code == http.StatusOK {
			t.Fatalf("unexpected allowed resource %s", path)
		}
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/conf", nil))
	if response.Code != 200 || response.Body.String() != "ordinary route" || response.Header().Get("Content-Security-Policy") != "" {
		t.Fatal("map middleware changed unrelated route")
	}
	util.SiYuanAccessAuthCodeBypass = true
	for _, page := range []string{"index.html", "wrapper.html"} {
		response = httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/stage/map/"+page+"?provider=openfreemap", nil))
		if response.Code != http.StatusForbidden || strings.Contains(response.Body.String(), "fixture") {
			t.Fatal("map host available in authentication bypass mode")
		}
	}
}
