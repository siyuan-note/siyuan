// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWebFetchHTML(t *testing.T) {
	for _, format := range []string{"markdown", "text"} {
		for _, prefix := range []string{"", "<!DOCTYPE html>", "<!-- comment --><!doctype html>"} {
			t.Run(format+prefix, func(t *testing.T) {
				response := httptest.NewRecorder()
				response.Header().Set("Content-Type", "text/html; charset=utf-8")
				response.WriteString(prefix + `<html><head><title>Not body</title></head><body><h1>Page title</h1><p>Page content</p><script>secretScript()</script><style>.secretStyle{}</style></body></html>`)
				text, err := readWebFetchResponse(response.Result(), "https://example.com/", format)
				if err != nil || !strings.Contains(text, "Page title") || !strings.Contains(text, "Page content") ||
					strings.Contains(text, "Not body") || strings.Contains(text, "secretScript") || strings.Contains(text, "secretStyle") || strings.Contains(text, "<html") {
					t.Fatalf("unexpected converted content: %q, %v", text, err)
				}
				if format == "markdown" && !strings.Contains(text, "# Page title") {
					t.Fatalf("heading lost: %q", text)
				}
			})
		}
		for _, body := range []string{"", `<!DOCTYPE html><div id="app"></div><script src="/main.js"></script>`} {
			response := httptest.NewRecorder()
			response.Header().Set("Content-Type", "text/html")
			response.WriteString(body)
			text, err := readWebFetchResponse(response.Result(), "https://example.com/", format)
			if text != "" || err == nil || !strings.Contains(err.Error(), "may require JavaScript") {
				t.Fatalf("empty HTML must return an error: %q, %v", text, err)
			}
		}
	}
}

func TestWebFetchTextAndMarkdown(t *testing.T) {
	for _, contentType := range []string{"text/plain; charset=utf-8", "text/markdown; charset=utf-8"} {
		for _, format := range []string{"markdown", "text"} {
			response := httptest.NewRecorder()
			response.Header().Set("Content-Type", contentType)
			body := "# Original\n\n<literal> & content"
			response.WriteString(body)
			text, err := readWebFetchResponse(response.Result(), "https://example.com/", format)
			if err != nil || text != body {
				t.Fatalf("text must be preserved: %q, %v", text, err)
			}
		}
	}
}

func TestWebFetchResponseLimitsAndErrors(t *testing.T) {
	for _, contentType := range []string{"text/html", "text/plain", "text/markdown", "application/octet-stream"} {
		limit := maxWebFetchBytes
		if contentType == "application/octet-stream" {
			limit = maxWebFetchFileBytes
		}
		for _, declaredLength := range []int64{-1, int64(limit + 1)} {
			response := &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {contentType}},
				ContentLength: declaredLength, Body: io.NopCloser(strings.NewReader(strings.Repeat("a", limit+1)))}
			text, err := readWebFetchResponse(response, "https://example.com/", "markdown")
			if text != "" || err == nil || !strings.Contains(err.Error(), "response too large") {
				t.Fatalf("oversized response accepted: %q, %v", text, err)
			}
		}
	}
	response := httptest.NewRecorder()
	response.WriteHeader(http.StatusNotFound)
	if _, err := readWebFetchResponse(response.Result(), "https://example.com/", "text"); err == nil || err.Error() != "HTTP 404" {
		t.Fatalf("HTTP status lost: %v", err)
	}
	broken := &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"text/html"}}, Body: io.NopCloser(webFetchErrorReader{})}
	if _, err := readWebFetchResponse(broken, "https://example.com/", "text"); err == nil || !strings.Contains(err.Error(), "read body failed") {
		t.Fatalf("read error lost: %v", err)
	}
	if text, err := safeHTML2Markdown(nil, "<p>body</p>"); err == nil || text != "" {
		t.Fatalf("Markdown panic must be recovered: %q, %v", text, err)
	}
	if text, err := safeHTML2Text(nil, "<p>body</p>"); err == nil || text != "" {
		t.Fatalf("text panic must be recovered: %q, %v", text, err)
	}
}

type webFetchErrorReader struct{}

func (webFetchErrorReader) Read([]byte) (int, error) { return 0, errors.New("broken body") }

func TestWebFetchDownloadAndTruncation(t *testing.T) {
	previousTempDir := TempDir
	TempDir = t.TempDir()
	t.Cleanup(func() { TempDir = previousTempDir })
	response := httptest.NewRecorder()
	response.Header().Set("Content-Type", "application/pdf")
	response.WriteString("test PDF")
	text, err := readWebFetchResponse(response.Result(), "https://example.com/test.pdf", "markdown")
	filename := filepath.Join(TempDir, "import", "test.pdf")
	if err != nil || !strings.Contains(text, filename) {
		t.Fatalf("download failed: %q, %v", text, err)
	}
	data, err := os.ReadFile(filename)
	if err != nil || string(data) != "test PDF" {
		t.Fatalf("download content changed: %q, %v", data, err)
	}
	response = httptest.NewRecorder()
	response.Header().Set("Content-Type", "text/plain")
	response.WriteString(strings.Repeat("\u4e2d", maxWebFetchChars+1))
	text, err = readWebFetchResponse(response.Result(), "https://example.com/", "text")
	if err != nil || !strings.HasPrefix(text, strings.Repeat("\u4e2d", maxWebFetchChars)+"\n\n...content truncated") {
		t.Fatalf("Unicode truncation failed: %v", err)
	}
}

type webFetchRoundTripper func(*http.Request) (*http.Response, error)

func (f webFetchRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) { return f(req) }

func TestWebFetchRequest(t *testing.T) {
	previousClient := ssrfSafeClient
	t.Cleanup(func() { ssrfSafeClient = previousClient })
	ssrfSafeClient = &http.Client{Transport: webFetchRoundTripper(func(req *http.Request) (*http.Response, error) {
		if req.Method != http.MethodGet || !strings.HasPrefix(req.Header.Get("Accept"), "text/markdown,") {
			t.Fatalf("missing content negotiation: %v", req)
		}
		return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"text/markdown"}},
			Body: io.NopCloser(strings.NewReader("# Negotiated Markdown"))}, nil
	})}
	text, err := WebFetch("https://203.0.113.10/", "markdown")
	if err != nil || text != "# Negotiated Markdown" {
		t.Fatalf("fetch failed: %q, %v", text, err)
	}
	for _, rawURL := range []string{"file:///test", "https:///test", "http://127.0.0.1/"} {
		if _, err := WebFetch(rawURL, "text"); err == nil {
			t.Fatalf("unsafe URL accepted: %s", rawURL)
		}
	}
}
