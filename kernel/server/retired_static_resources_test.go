// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package server

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestRetiredMapResourcesUnavailableWithOldFilesOnDisk(t *testing.T) {
	root := t.TempDir()
	for _, name := range []string{"map/index.html", "map/wrapper.html", "map/host.css",
		"build/map/host.js", "build/map/wrapper.js", "build/map/maplibre-gl.js",
		"build/map/maplibre-gl.css", "build/map/maplibre-gl-csp-worker.js",
		"build/desktop/index.js", "map-icons/pin.svg", "build/mapping.js", "plugins/example/asset.js"} {
		full := filepath.Join(root, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(full), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte("fixture:"+name), 0600); err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	router.Use(retiredStaticResourcesMiddleware())
	router.Static("/stage", root)
	router.Static("/plugins", filepath.Join(root, "plugins"))
	router.GET("/api/conf", func(c *gin.Context) { c.String(http.StatusOK, "ordinary route") })
	for _, target := range []string{"/stage/map", "/stage/map/", "/stage/build/map", "/stage/build/map/",
		"/stage/map/index.html", "/stage/map/index.html?provider=openfreemap", "/stage/map/wrapper.html",
		"/stage/map/host.css", "/stage/build/map/host.js", "/stage/build/map/wrapper.js",
		"/stage/build/map/maplibre-gl.js", "/stage/build/map/maplibre-gl.css",
		"/stage/build/map/maplibre-gl-csp-worker.js", "/stage/map/private.json",
		"/stage/map%2findex.html", "/stage/Map/wrapper.html", "/stage/.%2fmap/index.html",
		"/stage/%2fmap/index.html", "/stage/anything/..%2fmap/index.html", "/stage/build/.%2fmap/host.js",
		"/stage/%5cmap%5cindex.html", "/stage/build/MAP/host.js", "/stage/map./index.html",
		"/stage/map%20/index.html", "/stage/build/map.%20/host.js", "/stage/%6dap/index.html"} {
		for _, method := range []string{http.MethodGet, http.MethodHead, http.MethodPost} {
			t.Run(method+" "+target, func(t *testing.T) {
				response := httptest.NewRecorder()
				router.ServeHTTP(response, httptest.NewRequest(method, target, nil))
				if response.Code != http.StatusNotFound || response.Body.Len() != 0 {
					t.Fatalf("retired resource served: status=%d body=%q", response.Code, response.Body.String())
				}
			})
		}
	}
	for _, target := range []string{"build/desktop/index.js", "map-icons/pin.svg", "build/mapping.js"} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/stage/"+target, nil))
		if response.Code != http.StatusOK || response.Body.String() != "fixture:"+target {
			t.Fatalf("ordinary static resource changed: %s status=%d", target, response.Code)
		}
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/plugins/example/asset.js", nil))
	if response.Code != http.StatusOK || response.Body.String() != "fixture:plugins/example/asset.js" {
		t.Fatal("ordinary plugin resource changed")
	}
	response = httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/conf", nil))
	if response.Code != http.StatusOK || response.Body.String() != "ordinary route" {
		t.Fatal("ordinary API route changed")
	}
}
