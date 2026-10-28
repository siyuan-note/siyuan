package util

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestWebSearchResponseErrors(t *testing.T) {
	for _, tc := range []struct {
		name      string
		status    int
		body      string
		errorText string
	}{
		{"unauthorized", 401, `{}`, "HTTP 401"},
		{"forbidden", 403, `{}`, "access denied"},
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

type exaTestTransport func(*http.Request) (*http.Response, error)

func (transport exaTestTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func mockExaSearch(t *testing.T, transport exaTestTransport) {
	t.Helper()
	previous := webSearchHTTPClient
	t.Cleanup(func() { webSearchHTTPClient = previous })
	webSearchHTTPClient = previous.Clone()
	webSearchHTTPClient.GetClient().Transport = transport
}

func TestWebSearchCredentialsAndRequest(t *testing.T) {
	for _, key := range []string{"", "  exa-test-key  ", ""} {
		t.Run(key, func(t *testing.T) {
			calls := 0
			mockExaSearch(t, func(request *http.Request) (*http.Response, error) {
				calls++
				if request.URL.String() != defaultExaURL || request.Method != http.MethodPost ||
					request.Header.Get("x-api-key") != strings.TrimSpace(key) || request.Header.Get("Authorization") != "" ||
					request.Header.Get("Accept") != "application/json, text/event-stream" {
					t.Fatal("credential or transport contract changed")
				}
				var body mcpRequest
				if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
					t.Fatal(err)
				}
				if body.Method != "tools/call" || body.Params.Name != "web_search_exa" ||
					body.Params.Arguments["query"] != "test query" || body.Params.Arguments["numResults"] != float64(8) ||
					len(body.Params.Arguments) != 4 {
					t.Fatal("search payload changed or included credentials")
				}
				deadline, ok := request.Context().Deadline()
				if !ok || time.Until(deadline) > 2*time.Second {
					t.Fatal("configured timeout was lost")
				}
				return &http.Response{StatusCode: 200, Header: make(http.Header),
					Body: io.NopCloser(strings.NewReader(`{"result":{"content":[{"type":"text","text":"results"}]}}`))}, nil
			})
			text, err := WebSearchContext(context.Background(), "test query", key, 2)
			if err != nil || text != "results" || calls != 1 {
				t.Fatalf("search failed: text=%q err=%v calls=%d", text, err, calls)
			}
		})
	}
}

func TestWebSearchAuthenticatedFailures(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
		want   string
	}{
		{"authentication", 401, "exa-private-key", "authentication failed"},
		{"permission", 403, "exa-private-key", "access denied"},
		{"rate limit", 429, "exa-private-key", "rate limit exceeded"},
		{"redirect", 302, "", "HTTP 302"},
		{"server failure", 500, "exa-private-key", "HTTP 500"},
		{"RPC authentication", 200, `{"error":{"code":-32000,"message":"invalid key exa-private-key"}}`, "invalid key [redacted]"},
		{"SSE limit", 200, "data: {\"result\":{\"isError\":true,\"content\":[{\"type\":\"text\",\"text\":\"rate limited exa-private-key\"}]}}\n\n", "rate limited [redacted]"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			mockExaSearch(t, func(request *http.Request) (*http.Response, error) {
				calls++
				if request.URL.String() != defaultExaURL || request.Header.Get("x-api-key") != "exa-private-key" {
					t.Fatal("credentials were forwarded or search fell back to anonymous mode")
				}
				return &http.Response{StatusCode: tc.status, Header: http.Header{"Location": {"https://example.com/redirect"}},
					Body: io.NopCloser(strings.NewReader(tc.body))}, nil
			})
			text, err := WebSearchContext(context.Background(), "test", "exa-private-key", 2)
			if err == nil || !strings.Contains(err.Error(), tc.want) || strings.Contains(err.Error(), "exa-private-key") || text != "" || calls != 1 {
				t.Fatalf("failure leaked, retried or hidden: text=%q err=%v calls=%d", text, err, calls)
			}
		})
	}
	t.Run("transport error", func(t *testing.T) {
		calls := 0
		mockExaSearch(t, func(*http.Request) (*http.Response, error) {
			calls++
			return nil, errors.New("upstream exa-private-key")
		})
		_, err := WebSearchContext(context.Background(), "test", "exa-private-key", 2)
		if err == nil || strings.Contains(err.Error(), "exa-private-key") || calls != 1 {
			t.Fatalf("transport failure leaked or retried: %v calls=%d", err, calls)
		}
	})
	t.Run("cancel", func(t *testing.T) {
		mockExaSearch(t, func(request *http.Request) (*http.Response, error) {
			<-request.Context().Done()
			return nil, request.Context().Err()
		})
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		_, err := WebSearchContext(ctx, "test", "exa-private-key", 2)
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancellation lost: %v", err)
		}
	})
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
