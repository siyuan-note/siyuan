package api

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/imroc/req/v3"
)

func TestConfigureForwardProxyResponseEncoding(t *testing.T) {
	rawBody := append([]byte("<html><head><title>"), 0xd6, 0xd0, 0xb9, 0xfa)
	rawBody = append(rawBody, []byte("</title></head></html>")...)
	textBody := []byte("<html><head><title>中国</title></head></html>")

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/html; charset=gbk")
		_, _ = writer.Write(rawBody)
	}))
	defer server.Close()

	tests := []struct {
		name         string
		value        any
		wantEncoding string
		wantBody     []byte
	}{
		{name: "default", value: nil, wantEncoding: "text", wantBody: textBody},
		{name: "text", value: "text", wantEncoding: "text", wantBody: textBody},
		{name: "unknown", value: "unknown", wantEncoding: "text", wantBody: textBody},
		{name: "invalid type", value: 1, wantEncoding: "text", wantBody: textBody},
		{name: "base64", value: "base64", wantEncoding: "base64", wantBody: rawBody},
		{name: "base64 std", value: "base64-std", wantEncoding: "base64-std", wantBody: rawBody},
		{name: "base64 url", value: "base64-url", wantEncoding: "base64-url", wantBody: rawBody},
		{name: "base32", value: "base32", wantEncoding: "base32", wantBody: rawBody},
		{name: "base32 std", value: "base32-std", wantEncoding: "base32-std", wantBody: rawBody},
		{name: "base32 hex", value: "base32-hex", wantEncoding: "base32-hex", wantBody: rawBody},
		{name: "hex", value: "hex", wantEncoding: "hex", wantBody: rawBody},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			client := req.C()
			if encoding := configureForwardProxyClient(client, maxForwardProxyResponseSize, test.value); encoding != test.wantEncoding {
				t.Fatalf("encoding = %q, want %q", encoding, test.wantEncoding)
			}

			response, err := client.R().Get(server.URL)
			if err != nil {
				t.Fatalf("get response failed: %s", err)
			}
			body, err := io.ReadAll(response.Body)
			if err != nil {
				t.Fatalf("read response failed: %s", err)
			}
			if !bytes.Equal(body, test.wantBody) {
				t.Fatalf("body = %x, want %x", body, test.wantBody)
			}
		})
	}
}

// TestHTTPProxyResponseSecurityHeaders 验证 /api/network/proxy 响应禁用内容嗅探并强制不可执行类型，
// 防止上游可控内容被浏览器渲染为 HTML 造成同源脚本执行
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-2w6q-wgc8-q743
func TestHTTPProxyResponseSecurityHeaders(t *testing.T) {
	upstreamBody := []byte("<html><body>SNIFFED-AS-HTML<script>alert(1)</script></body></html>")

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = writer.Write(upstreamBody)
	}))
	defer server.Close()

	engine := gin.New()
	engine.Any("/api/network/proxy", httpProxy)

	request := httptest.NewRequest(http.MethodGet,
		"/api/network/proxy?u="+base64.RawURLEncoding.EncodeToString([]byte(server.URL)), nil)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if recorder.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q, want nosniff", recorder.Header().Get("X-Content-Type-Options"))
	}
	if recorder.Header().Get("Content-Type") != "application/octet-stream" {
		t.Fatalf("Content-Type = %q, want application/octet-stream", recorder.Header().Get("Content-Type"))
	}
	if recorder.Header().Get("Content-Disposition") != "attachment" {
		t.Fatalf("Content-Disposition = %q, want attachment", recorder.Header().Get("Content-Disposition"))
	}
	if recorder.Header().Get("Siyuan-Proxy-Content-Type") != "text/html; charset=utf-8" {
		t.Fatalf("Siyuan-Proxy-Content-Type = %q, want upstream content type", recorder.Header().Get("Siyuan-Proxy-Content-Type"))
	}
	if !bytes.Equal(recorder.Body.Bytes(), upstreamBody) {
		t.Fatalf("body = %q, want %q", recorder.Body.String(), upstreamBody)
	}
}

// TestEventSourceProxyResponseSecurityHeaders 验证 /es/network/proxy 保留 EventSource 内容类型并禁用内容嗅探
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-2w6q-wgc8-q743
func TestEventSourceProxyResponseSecurityHeaders(t *testing.T) {
	upstreamBody := []byte("data: test\n\n")

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/event-stream")
		_, _ = writer.Write(upstreamBody)
	}))
	defer server.Close()

	engine := gin.New()
	engine.GET("/es/network/proxy", esProxy)

	request := httptest.NewRequest(http.MethodGet,
		"/es/network/proxy?u="+base64.RawURLEncoding.EncodeToString([]byte(server.URL)), nil)
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if recorder.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatalf("X-Content-Type-Options = %q, want nosniff", recorder.Header().Get("X-Content-Type-Options"))
	}
	if recorder.Header().Get("Content-Type") != "text/event-stream; charset=utf-8" {
		t.Fatalf("Content-Type = %q, want text/event-stream; charset=utf-8", recorder.Header().Get("Content-Type"))
	}
	if recorder.Header().Get("Content-Disposition") != "" {
		t.Fatalf("Content-Disposition = %q, want empty", recorder.Header().Get("Content-Disposition"))
	}
	if recorder.Header().Get("Siyuan-Proxy-Content-Type") != "text/event-stream" {
		t.Fatalf("Siyuan-Proxy-Content-Type = %q, want upstream content type", recorder.Header().Get("Siyuan-Proxy-Content-Type"))
	}
	if !bytes.Equal(recorder.Body.Bytes(), upstreamBody) {
		t.Fatalf("body = %q, want %q", recorder.Body.String(), upstreamBody)
	}
}

func TestForwardProxyResponseSizeLimit(t *testing.T) {
	const limit int64 = 64
	body := bytes.Repeat([]byte("a"), int(limit)+1)
	var compressed bytes.Buffer
	gzipWriter := gzip.NewWriter(&compressed)
	if _, err := gzipWriter.Write(body); err != nil {
		t.Fatalf("compress response body failed: %s", err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatalf("close gzip writer failed: %s", err)
	}
	if int64(compressed.Len()) >= limit {
		t.Fatalf("compressed response body size = %d, want less than %d", compressed.Len(), limit)
	}

	tests := []struct {
		name             string
		responseEncoding any
		handler          http.HandlerFunc
	}{
		{
			name:             "content length",
			responseEncoding: "text",
			handler: func(writer http.ResponseWriter, _ *http.Request) {
				writer.Header().Set("Content-Length", strconv.Itoa(len(body)))
				_, _ = writer.Write(body)
			},
		},
		{
			name:             "chunked",
			responseEncoding: "base64",
			handler: func(writer http.ResponseWriter, _ *http.Request) {
				writer.WriteHeader(http.StatusOK)
				writer.(http.Flusher).Flush()
				_, _ = writer.Write(body)
			},
		},
		{
			name:             "compressed",
			responseEncoding: "hex",
			handler: func(writer http.ResponseWriter, _ *http.Request) {
				writer.Header().Set("Content-Encoding", "gzip")
				writer.Header().Set("Content-Length", strconv.Itoa(compressed.Len()))
				_, _ = writer.Write(compressed.Bytes())
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(test.handler)
			defer server.Close()

			client := req.C()
			configureForwardProxyClient(client, limit, test.responseEncoding)
			response, responseBody, err := sendForwardProxyRequest(client.R(), http.MethodGet, server.URL)
			if !errors.Is(err, req.ErrResponseBodyTooLarge) {
				t.Fatalf("error = %v, want ErrResponseBodyTooLarge", err)
			}
			if response == nil {
				t.Fatal("response is nil")
			}
			if responseBody != nil {
				t.Fatalf("response body = %x, want nil", responseBody)
			}
		})
	}
}
