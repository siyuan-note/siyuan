// SiYuan - Refactor your thinking
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
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/model"
)

func TestServeSVGSanitizesAndSetsSecurityHeaders(t *testing.T) {
	oldConf := model.Conf
	model.Conf = model.NewAppConf()
	model.Conf.Editor = conf.NewEditor()
	t.Cleanup(func() {
		model.Conf = oldConf
	})

	assetPath := filepath.Join(t.TempDir(), "test.svg")
	input := `<svg xmlns="http://www.w3.org/2000/svg"><desc><style><script>alert(1)</script></style></desc></svg>`
	if err := os.WriteFile(assetPath, []byte(input), 0644); err != nil {
		t.Fatalf("write test SVG failed: %v", err)
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/assets/test.svg", nil)
	if !serveSVG(context, assetPath) {
		t.Fatal("SVG asset was not handled")
	}

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status code %d", recorder.Code)
	}
	if strings.Contains(recorder.Body.String(), `<script>`) {
		t.Fatalf("SVG response contains injected script: %s", recorder.Body.String())
	}
	if recorder.Header().Get("Content-Security-Policy") != "script-src 'none'; object-src 'none'; base-uri 'none'" {
		t.Fatalf("unexpected CSP header %q", recorder.Header().Get("Content-Security-Policy"))
	}
	if recorder.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("unexpected X-Content-Type-Options header %q", recorder.Header().Get("X-Content-Type-Options"))
	}
}

func TestServeSVGPreservesAllowSVGScriptBehavior(t *testing.T) {
	oldConf := model.Conf
	model.Conf = model.NewAppConf()
	model.Conf.Editor = conf.NewEditor()
	model.Conf.Editor.AllowSVGScript = true
	t.Cleanup(func() {
		model.Conf = oldConf
	})

	assetPath := filepath.Join(t.TempDir(), "test.svg")
	input := `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`
	if err := os.WriteFile(assetPath, []byte(input), 0644); err != nil {
		t.Fatalf("write test SVG failed: %v", err)
	}

	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/assets/test.svg", nil)
	if !serveSVG(context, assetPath) {
		t.Fatal("SVG asset was not handled")
	}

	if !strings.Contains(recorder.Body.String(), `<script>`) {
		t.Fatalf("enabled SVG script was unexpectedly removed: %s", recorder.Body.String())
	}
	if recorder.Header().Get("Content-Security-Policy") != "" {
		t.Fatalf("enabled SVG script received an unexpected CSP header %q", recorder.Header().Get("Content-Security-Policy"))
	}
	if recorder.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("unexpected X-Content-Type-Options header %q", recorder.Header().Get("X-Content-Type-Options"))
	}
}
