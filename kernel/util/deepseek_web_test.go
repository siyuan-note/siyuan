// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"unicode/utf8"
)

type deepSeekWebTestTransport func(*http.Request) (*http.Response, error)

func (transport deepSeekWebTestTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func mockDeepSeekWeb(t *testing.T, status int, body string, inspect func(*http.Request)) {
	t.Helper()
	previous := deepSeekWebHTTPClient
	t.Cleanup(func() { deepSeekWebHTTPClient = previous })
	deepSeekWebHTTPClient = &http.Client{Transport: deepSeekWebTestTransport(func(request *http.Request) (*http.Response, error) {
		if request.Method != http.MethodPost || request.Header.Get("Authorization") != "Bearer test-key" ||
			request.Header.Get("Content-Type") != "application/json" || !strings.HasPrefix(request.URL.String(), deepSeekWebURL) {
			t.Fatal("invalid authenticated request")
		}
		if inspect != nil {
			inspect(request)
		}
		return &http.Response{StatusCode: status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}, nil
	})}
}

func TestDeepSeekWebSearchBudgetAndRequest(t *testing.T) {
	rows := make([]map[string]string, 8)
	for index := range rows {
		rows[index] = map[string]string{"title": "标题", "url": "https://example.com/page", "date": "2026-10-18",
			"summary": strings.Repeat("摘要", 1000), "snippet": "short", "content": "must not reach the model"}
	}
	rows[0]["summary"], rows[0]["snippet"] = " ", "fallback snippet"
	rows[1]["url"] = "https://example.com/" + strings.Repeat("a", deepSeekSearchChars)
	body, _ := json.Marshal(map[string]any{"results": rows})
	mockDeepSeekWeb(t, 200, string(body), func(request *http.Request) {
		var payload map[string]any
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if request.URL.Path != "/v1/tools/search" || len(payload) != 3 || payload["query"] != "关键词" ||
			payload["count"] != float64(5) || payload["need_content"] != false {
			t.Fatal("search sent unexpected fields or fetched full content")
		}
	})
	text, err := DeepSeekWebSearch(context.Background(), DeepSeekWebOptions{APIKey: "test-key"}, "关键词")
	if err != nil || !utf8.ValidString(text) || utf8.RuneCountInString(text) > deepSeekSearchChars ||
		!strings.Contains(text, "fallback snippet") || strings.Contains(text, strings.Repeat("摘要", 401)) ||
		strings.Contains(text, "must not reach the model") || strings.Count(text, "URL:") != 4 {
		t.Fatalf("search result normalization failed: length=%d err=%v", utf8.RuneCountInString(text), err)
	}
}

func TestDeepSeekWebSearchResponses(t *testing.T) {
	for _, entry := range []struct {
		body string
		ok   bool
	}{
		{`{"results":[]}`, true},
		{`{}`, false},
		{`{"results":null}`, false},
		{`{"results":"invalid"}`, false},
		{`{"results":[{"url":"javascript:alert(1)"}]}`, false},
		{`{"results":[{"url":"https://user:password@example.com"}]}`, false},
		{`{"results":[{"title":"page","url":"https://example.com","snippet":"summary"}]}`, true},
		{`{"error":{"message":"secret provider details"}}`, false},
		{`invalid JSON`, false},
	} {
		t.Run(entry.body, func(t *testing.T) {
			mockDeepSeekWeb(t, 200, entry.body, nil)
			_, err := DeepSeekWebSearch(context.Background(), DeepSeekWebOptions{APIKey: "test-key"}, "test")
			if (err == nil) != entry.ok {
				t.Fatalf("unexpected response handling: %v", err)
			}
		})
	}
	for _, query := range []string{"", " \t", strings.Repeat("字", 129)} {
		if _, err := DeepSeekWebSearch(context.Background(), DeepSeekWebOptions{}, query); err == nil {
			t.Fatal("invalid query accepted")
		}
	}
	if _, err := DeepSeekWebSearch(context.Background(), DeepSeekWebOptions{}, "test"); err == nil {
		t.Fatal("missing key accepted")
	}
}

func TestDeepSeekWebFetchFormatsAndBoundaries(t *testing.T) {
	for _, format := range []string{"markdown", "text"} {
		t.Run(format, func(t *testing.T) {
			mockDeepSeekWeb(t, 200, `{"title":"Title","content":"# Heading\n\n**正文** [link](https://example.com)"}`, func(request *http.Request) {
				var payload map[string]string
				if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
					t.Fatal(err)
				}
				if request.URL.Path != "/v1/tools/fetch" || len(payload) != 1 || payload["url"] != "https://8.8.8.8/page" {
					t.Fatal("fetch sent unexpected fields")
				}
			})
			text, err := DeepSeekWebFetch(context.Background(), DeepSeekWebOptions{APIKey: "test-key"}, "https://8.8.8.8/page", format)
			if err != nil || !strings.Contains(text, "正文") || !strings.Contains(text, "Heading") ||
				(format == "text" && strings.Contains(text, "**")) || (format == "markdown" && !strings.Contains(text, "**正文**")) {
				t.Fatalf("fetch conversion failed: %q %v", text, err)
			}
		})
	}
	for _, rawURL := range []string{"file:///tmp/page", "https://user:password@example.com", "http://127.0.0.1", "http://[::1]", "https://", "https://example.com/" + strings.Repeat("x", 8192)} {
		if _, err := DeepSeekWebFetch(context.Background(), DeepSeekWebOptions{APIKey: "test-key"}, rawURL, "markdown"); err == nil {
			t.Fatal("invalid or private URL accepted")
		}
	}
	for _, body := range []string{`{}`, `{"content":null}`, `{"content":" "}`} {
		t.Run(body, func(t *testing.T) {
			mockDeepSeekWeb(t, 200, body, nil)
			if _, err := DeepSeekWebFetch(context.Background(), DeepSeekWebOptions{APIKey: "test-key"}, "https://8.8.8.8", "markdown"); err == nil {
				t.Fatal("empty fetch result accepted")
			}
		})
	}
}

func TestDeepSeekWebFailureCancellationAndSize(t *testing.T) {
	if deepSeekWebHTTPClient.CheckRedirect(nil, nil) != http.ErrUseLastResponse {
		t.Fatal("authenticated redirects must be rejected")
	}
	for _, status := range []int{301, 400, 401, 402, 403, 404, 429, 500, 504} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			calls := 0
			mockDeepSeekWeb(t, status, `{"error":{"message":"test-key"}}`, func(*http.Request) { calls++ })
			_, err := DeepSeekWebSearch(context.Background(), DeepSeekWebOptions{APIKey: "test-key"}, "test")
			if err == nil || !strings.Contains(err.Error(), "HTTP "+strconv.Itoa(status)) || strings.Contains(err.Error(), "test-key") || calls != 1 {
				t.Fatalf("provider failure retried, hidden or leaked: %v calls=%d", err, calls)
			}
		})
	}
	t.Run("oversize", func(t *testing.T) {
		mockDeepSeekWeb(t, 200, strings.Repeat("x", maxWebFetchBytes+1), nil)
		if _, err := DeepSeekWebSearch(context.Background(), DeepSeekWebOptions{APIKey: "test-key"}, "test"); err == nil || !strings.Contains(err.Error(), "5 MiB") {
			t.Fatal("oversize response accepted")
		}
	})
	t.Run("cancel", func(t *testing.T) {
		previous := deepSeekWebHTTPClient
		t.Cleanup(func() { deepSeekWebHTTPClient = previous })
		deepSeekWebHTTPClient = &http.Client{Transport: deepSeekWebTestTransport(func(request *http.Request) (*http.Response, error) {
			<-request.Context().Done()
			return nil, request.Context().Err()
		})}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		_, err := DeepSeekWebSearch(ctx, DeepSeekWebOptions{APIKey: "test-key"}, "test")
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("request did not propagate cancellation: %v", err)
		}
	})
}

func TestDeepSeekWebFetchPreservesTextStructureAndMarkdownEscapes(t *testing.T) {
	content := "# Heading\n\nFirst **paragraph**.\n\nSecond paragraph with [link](https://example.com).\n\n" +
		"- First item\n- Second item\n\n```html\n<button>I'm a button</button>\n<div>another line</div>\n```\n\n" +
		"| Column one | Column two |\n| --- | --- |\n| Cell one | Cell two |\n\n" +
		"\\# literal heading\n\n\\*literal asterisks\\*\n\nShort last paragraph."
	body, _ := json.Marshal(map[string]string{"content": content})
	mockDeepSeekWeb(t, 200, string(body), nil)
	markdown, err := DeepSeekWebFetch(context.Background(), DeepSeekWebOptions{APIKey: "test-key"}, "https://8.8.8.8", "markdown")
	if err != nil || markdown != content {
		t.Fatalf("provider Markdown was rewritten: %q %v", markdown, err)
	}
	text, err := DeepSeekWebFetch(context.Background(), DeepSeekWebOptions{APIKey: "test-key"}, "https://8.8.8.8", "text")
	if err != nil {
		t.Fatal(err)
	}
	for _, fragment := range []string{"Heading\n", "First paragraph.\n", "Second paragraph with link.\n",
		"First item\n", "Second item\n", "<button>I'm a button</button>\n<div>another line</div>",
		"Column one\tColumn two", "Cell one\tCell two", "# literal heading", "*literal asterisks*"} {
		if !strings.Contains(text, fragment) {
			t.Fatalf("text lost a block boundary or literal content %q: %q", fragment, text)
		}
	}
	if strings.Contains(text, "**") || strings.Contains(text, "```") {
		t.Fatalf("Markdown formatting leaked into plain text: %q", text)
	}
	for _, content := range []string{"Short content.", "<script>hidden()</script>"} {
		body, _ := json.Marshal(map[string]string{"content": content})
		mockDeepSeekWeb(t, 200, string(body), nil)
		text, err := DeepSeekWebFetch(context.Background(), DeepSeekWebOptions{APIKey: "test-key"}, "https://8.8.8.8", "text")
		if content == "Short content." && (err != nil || text != content) {
			t.Fatalf("short content was rejected or changed: %q %v", text, err)
		}
		if content != "Short content." && (err == nil || text != "") {
			t.Fatalf("empty sanitized content was accepted: %q %v", text, err)
		}
	}
}
