// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package server

import (
	"mime"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type assetRequestPathTest struct {
	name        string
	requestPath string
	want        bool
}

func TestIsValidAssetRequestPath(t *testing.T) {
	tests := []assetRequestPathTest{
		{name: "regular", requestPath: "/image.png", want: true},
		{name: "Chinese ellipsis", requestPath: "/何照人-东方女性不只...-20260721.mp4", want: true},
		{name: "double dots in filename", requestPath: "/foo..bar.mp4", want: true},
		{name: "nested", requestPath: "/images/cover.png", want: true},
		{name: "empty", requestPath: "", want: false},
		{name: "root", requestPath: "/", want: false},
		{name: "current directory", requestPath: "/.", want: false},
		{name: "parent directory", requestPath: "/../secret", want: false},
		{name: "nested parent directory", requestPath: "/images/../secret", want: false},
		{name: "nested current directory", requestPath: "/images/./cover.png", want: false},
		{name: "empty segment", requestPath: "/images//cover.png", want: false},
	}

	if runtime.GOOS == "windows" {
		tests = append(tests,
			assetRequestPathTest{name: "Windows parent directory", requestPath: `/images\..\secret`, want: false},
			assetRequestPathTest{name: "Windows drive", requestPath: `/C:\secret`, want: false},
		)
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isValidAssetRequestPath(test.requestPath); got != test.want {
				t.Fatalf("isValidAssetRequestPath(%q) = %v, want %v", test.requestPath, got, test.want)
			}
		})
	}
}

func TestAssetRequestPathURLDecoding(t *testing.T) {
	engine := gin.New()
	engine.GET("/assets/*path", func(context *gin.Context) {
		if !isValidAssetRequestPath(context.Param("path")) {
			context.Status(http.StatusForbidden)
			return
		}
		context.Status(http.StatusNoContent)
	})

	tests := []struct {
		name       string
		requestURL string
		wantStatus int
	}{
		{name: "encoded Chinese filename", requestURL: "/assets/%E4%BD%95%E7%85%A7%E4%BA%BA...mp4", wantStatus: http.StatusNoContent},
		{name: "encoded parent directory", requestURL: "/assets/%2e%2e/secret", wantStatus: http.StatusForbidden},
		{name: "encoded separators", requestURL: "/assets/images%2f..%2fsecret", wantStatus: http.StatusForbidden},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, test.requestURL, nil)
			engine.ServeHTTP(recorder, request)
			if recorder.Code != test.wantStatus {
				t.Fatalf("GET %q returned %d, want %d", test.requestURL, recorder.Code, test.wantStatus)
			}
		})
	}
}

func TestIsValidResolvedAssetPath(t *testing.T) {
	originalDataDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() {
		util.DataDir = originalDataDir
	})

	const (
		boxID          = "20260806000000-box0001"
		otherBoxID     = "20260806000001-box0002"
		encryptedBoxID = "20260806000002-box0003"
		docID          = "20260806000003-doc0001"
	)
	writeFile := func(filePath, content string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}
	}

	writeFile(filepath.Join(util.DataDir, boxID, ".siyuan", "conf.json"), `{}`)
	writeFile(filepath.Join(util.DataDir, encryptedBoxID, ".siyuan", "conf.json"), `{"encrypted":true}`)
	globalAssetPath := filepath.Join(util.DataDir, "assets", "global.png")
	boxAssetPath := filepath.Join(util.DataDir, boxID, "assets", "box.png")
	documentAssetPath := filepath.Join(util.DataDir, boxID, docID, "assets", "document.png")
	encryptedAssetPath := filepath.Join(util.DataDir, encryptedBoxID, "assets", "encrypted.png")
	nonAssetPath := filepath.Join(util.DataDir, boxID, docID, "document.png")
	for _, assetPath := range []string{globalAssetPath, boxAssetPath, documentAssetPath, encryptedAssetPath, nonAssetPath} {
		writeFile(assetPath, "image")
	}

	tests := []struct {
		name         string
		assetPath    string
		requestBoxID string
		want         bool
	}{
		{name: "global asset", assetPath: globalAssetPath, want: true},
		{name: "notebook asset", assetPath: boxAssetPath, want: true},
		{name: "document asset", assetPath: documentAssetPath, want: true},
		{name: "explicit notebook", assetPath: boxAssetPath, requestBoxID: boxID, want: true},
		{name: "explicit notebook rejects document asset", assetPath: documentAssetPath, requestBoxID: boxID},
		{name: "mismatched notebook", assetPath: boxAssetPath, requestBoxID: otherBoxID},
		{name: "encrypted asset requires notebook", assetPath: encryptedAssetPath},
		{name: "encrypted asset with notebook", assetPath: encryptedAssetPath, requestBoxID: encryptedBoxID, want: true},
		{name: "non-asset file", assetPath: nonAssetPath},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isValidResolvedAssetPath(test.assetPath, test.requestBoxID); got != test.want {
				t.Fatalf("isValidResolvedAssetPath(%q, %q) = %v, want %v", test.assetPath, test.requestBoxID, got, test.want)
			}
		})
	}
}

func TestSecureAssetContentHeadersForcesAttachmentOnScriptCapableAssets(t *testing.T) {
	// 可执行脚本的资产必须强制附件下载，禁止浏览器同源内联渲染
	// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-mjf3-jwmf-r6wf
	cases := map[string]string{
		"test.html":  "<script>fetch('/api/system/getConf')</script>",
		"test.xhtml": "<script>fetch('/api/system/getConf')</script>",
		"test.js":    "fetch('/api/system/getConf')",
		"test.svg":   "<svg xmlns='http://www.w3.org/2000/svg'><script>fetch('/api/system/getConf')</script></svg>",
	}
	for name, content := range cases {
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest(http.MethodGet, "/assets/"+name, nil)
		assetPath := filepath.Join(t.TempDir(), name)
		if err := os.WriteFile(assetPath, []byte(content), 0644); err != nil {
			t.Fatalf("write test asset failed: %v", err)
		}
		secureAssetContentHeaders(context, assetPath, assetPath)
		if !strings.HasPrefix(recorder.Header().Get("Content-Disposition"), "attachment") {
			t.Fatalf("asset [%s] must be forced to download, got Content-Disposition %q", name, recorder.Header().Get("Content-Disposition"))
		}
		if recorder.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Fatalf("asset [%s] missing X-Content-Type-Options header", name)
		}
	}
}

func TestSecureAssetContentHeadersAllowsInlineSafeAssets(t *testing.T) {
	// 图片、音视频、PDF 等安全类型保持内联渲染，但仍需 nosniff
	cases := []string{"test.png", "test.jpg", "test.webp", "test.mp4", "test.mp3", "test.pdf", "test.txt"}
	for _, name := range cases {
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest(http.MethodGet, "/assets/"+name, nil)
		assetPath := filepath.Join(t.TempDir(), name)
		if err := os.WriteFile(assetPath, []byte("test"), 0644); err != nil {
			t.Fatalf("write test asset failed: %v", err)
		}
		secureAssetContentHeaders(context, assetPath, assetPath)
		if cd := recorder.Header().Get("Content-Disposition"); strings.HasPrefix(cd, "attachment") {
			t.Fatalf("safe asset [%s] must stay inline, got Content-Disposition %q", name, cd)
		}
		if recorder.Header().Get("X-Content-Type-Options") != "nosniff" {
			t.Fatalf("safe asset [%s] missing X-Content-Type-Options header", name)
		}
	}
}

func TestSecureAssetContentHeadersForcesAttachmentOnUnknownExtension(t *testing.T) {
	// 无法识别 Content-Type 的扩展名会触发内容嗅探，可能被识别为 text/html，因此必须强制附件下载
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/assets/payload.xyz", nil)
	assetPath := filepath.Join(t.TempDir(), "payload.xyz")
	if err := os.WriteFile(assetPath, []byte("<script>alert(1)</script>"), 0644); err != nil {
		t.Fatalf("write test asset failed: %v", err)
	}
	if mime.TypeByExtension(".xyz") != "" {
		t.Fatalf("test precondition failed: .xyz unexpectedly has a MIME type")
	}
	secureAssetContentHeaders(context, assetPath, assetPath)
	if !strings.HasPrefix(recorder.Header().Get("Content-Disposition"), "attachment") {
		t.Fatalf("unknown-extension asset must be forced to download, got Content-Disposition %q", recorder.Header().Get("Content-Disposition"))
	}
	if recorder.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("unknown-extension asset missing X-Content-Type-Options header")
	}
}

func TestSecureAssetContentHeadersKeepsExplicitDownload(t *testing.T) {
	// 显式携带 download=true 时安全类型也应返回 attachment
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodGet, "/assets/test.png?download=true", nil)
	assetPath := filepath.Join(t.TempDir(), "test.png")
	if err := os.WriteFile(assetPath, []byte("png"), 0644); err != nil {
		t.Fatalf("write test asset failed: %v", err)
	}
	secureAssetContentHeaders(context, assetPath, assetPath)
	if !strings.HasPrefix(recorder.Header().Get("Content-Disposition"), "attachment") {
		t.Fatalf("explicit download=true must return attachment, got Content-Disposition %q", recorder.Header().Get("Content-Disposition"))
	}
}
