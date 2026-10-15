package util

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWebSearchResponseErrors(t *testing.T) {
	for _, tc := range []struct {
		name      string
		status    int
		body      string
		errorText string
	}{
		{"unauthorized", 401, `{}`, "HTTP 401"},
		{"limited", 429, `{}`, "HTTP 429"},
		{"server error", 500, `<html>failed</html>`, "HTTP 500"},
		{"redirect", 302, `{}`, "HTTP 302"},
		{"RPC error", 200, `{"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"upstream failed"}}`, "RPC error -32603: upstream failed"},
		{"SSE RPC error", 200, "event: message\ndata: {\"error\":{\"code\":-32000,\"message\":\"invalid key\"}}\n\n", "RPC error -32000: invalid key"},
		{"tool error", 200, `{"result":{"isError":true,"content":[{"type":"text","text":"rate limited"}]}}`, "tool failed: rate limited"},
		{"invalid JSON", 200, `{"result":`, "invalid response"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			response.WriteHeader(tc.status)
			response.WriteString(tc.body)
			text, err := parseWebSearchResponse(response.Result())
			if err == nil || !strings.Contains(err.Error(), tc.errorText) || text != "" {
				t.Fatalf("upstream failure was not preserved: text=%q err=%v", text, err)
			}
		})
	}
}

func TestWebSearchResponseResults(t *testing.T) {
	for _, tc := range []struct{ body, expected string }{
		{`{"result":{"content":[{"type":"text","text":"search results"}]}}`, "search results"},
		{"event: message\ndata: {\"result\":{\"content\":[{\"type\":\"text\",\"text\":\"SSE results\"}]}}\n\n", "SSE results"},
		{`{"result":{"content":[]}}`, "No search results found. Please try a different query."},
	} {
		response := httptest.NewRecorder()
		response.WriteString(tc.body)
		text, err := parseWebSearchResponse(response.Result())
		if err != nil || text != tc.expected {
			t.Fatalf("successful response changed: text=%q err=%v", text, err)
		}
	}
}
