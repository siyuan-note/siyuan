package api

import (
	"bytes"
	"compress/gzip"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"

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
