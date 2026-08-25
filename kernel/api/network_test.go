package api

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
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
			if encoding := configureForwardProxyResponseEncoding(client, test.value); encoding != test.wantEncoding {
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
