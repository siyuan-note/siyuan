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
	for _, provider := range []string{"openfreemap", "amap", "tencent", "baidu"} {
		policy, ok := mapHostPolicy("localhost:6806", provider)
		if !ok || !strings.Contains(policy, "sandbox allow-scripts;") ||
			strings.Contains(policy, "allow-same-origin") || strings.Contains(policy, "'unsafe-eval'") ||
			strings.Contains(policy, "connect-src 'self'") || !strings.Contains(policy, "form-action 'none'") {
			t.Fatalf("unsafe policy for %s: %s", provider, policy)
		}
		if provider != "openfreemap" && strings.Contains(policy, "tiles.openfreemap.org") {
			t.Fatalf("provider sources leaked into %s", provider)
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

func TestMapHostAMapRestrictedWorkersAndScripts(t *testing.T) {
	policy, ok := mapHostPolicy("localhost:6806", "amap")
	if !ok {
		t.Fatal("AMap policy unavailable")
	}
	directives := map[string]string{}
	for _, part := range strings.Split(policy, ";") {
		fields := strings.Fields(part)
		if len(fields) > 0 {
			directives[fields[0]] = strings.Join(fields[1:], " ")
		}
	}
	for name, want := range map[string]string{
		"script-src":  "localhost:6806/stage/build/map/host.js https://webapi.amap.com https://restapi.amap.com https://jsapi-service.amap.com",
		"worker-src":  "blob:",
		"connect-src": "https://webapi.amap.com https://restapi.amap.com https://vdata.amap.com https://jsapi.amap.com",
		"frame-src":   "'none'",
		"sandbox":     "allow-scripts",
	} {
		if directives[name] != want {
			t.Fatalf("unexpected %s: %s", name, directives[name])
		}
	}
	for _, provider := range []string{"tencent", "baidu"} {
		other, _ := mapHostPolicy("localhost:6806", provider)
		if !strings.Contains(other, "worker-src 'none'") || strings.Contains(other, "restapi.amap.com") {
			t.Fatalf("AMap permissions leaked into %s", provider)
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
		"/stage/map/wrapper.html?provider=amap", "/stage/build/map/wrapper.js"} {
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
	for _, path := range []string{"/stage/map/index.html", "/stage/map/index.html?provider=custom", "/stage/map/wrapper.html", "/stage/map/wrapper.html?provider=custom",
		"/stage/map/private.json", "/stage/build/map/host.js.map", "/stage/map%2findex.html?provider=amap", "/stage/Map/wrapper.html?provider=amap",
		"/stage/.%2fmap/index.html?provider=amap", "/stage/%2fmap/index.html?provider=amap",
		"/stage/anything/..%2fmap/index.html?provider=amap", "/stage/build/.%2fmap/host.js",
		"/stage/%5cmap%5cindex.html?provider=amap", "/stage/Map/index.html?provider=amap",
		"/stage/build/MAP/host.js", "/stage/map./index.html?provider=amap", "/stage/map%20/index.html?provider=amap"} {
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
