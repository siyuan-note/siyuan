// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"context"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestWebProvidersUseConfiguredTimeout(t *testing.T) {
	for _, input := range []int{-1, 0, 1, 60, 600, 999} {
		t.Run(strconv.Itoa(input), func(t *testing.T) {
			expected := input
			if expected < 1 {
				expected = 30
			} else if expected > 600 {
				expected = 600
			}
			calls := 0
			transport := webFetchRoundTripper(func(request *http.Request) (*http.Response, error) {
				deadline, ok := request.Context().Deadline()
				remaining := time.Until(deadline)
				if !ok || remaining > time.Duration(expected)*time.Second || remaining < time.Duration(expected)*time.Second-time.Second/2 {
					t.Fatalf("timeout %d was not applied: %v", input, remaining)
				}
				calls++
				body := "# Direct page"
				switch request.URL.Host {
				case "api.deepseek.com":
					if request.URL.Path == "/v1/tools/search" {
						body = `{"results":[]}`
					} else {
						body = `{"content":"# DeepSeek page"}`
					}
				case "mcp.exa.ai":
					body = `{"result":{"content":[{"type":"text","text":"Search result"}]}}`
				}
				return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"text/markdown"}},
					Body: io.NopCloser(strings.NewReader(body))}, nil
			})
			previousDirect, previousDeepSeek := ssrfSafeClient, deepSeekWebHTTPClient
			previousSearch := webSearchHTTPClient.GetClient().Transport
			t.Cleanup(func() {
				ssrfSafeClient, deepSeekWebHTTPClient = previousDirect, previousDeepSeek
				webSearchHTTPClient.GetClient().Transport = previousSearch
			})
			ssrfSafeClient = &http.Client{Timeout: time.Nanosecond, Transport: transport}
			deepSeekWebHTTPClient = &http.Client{Transport: transport}
			webSearchHTTPClient.GetClient().Transport = transport
			ctx := context.Background()
			options := DeepSeekWebOptions{APIKey: "test-key", Timeout: input}
			if _, err := WebFetchContext(ctx, "https://8.8.8.8", "markdown", input); err != nil {
				t.Fatal(err)
			}
			if _, err := WebSearchContext(ctx, "test", "", input); err != nil {
				t.Fatal(err)
			}
			if _, err := DeepSeekWebSearch(ctx, options, "test"); err != nil {
				t.Fatal(err)
			}
			if _, err := DeepSeekWebFetch(ctx, options, "https://8.8.8.8", "markdown"); err != nil {
				t.Fatal(err)
			}
			if calls != 4 {
				t.Fatalf("expected all four provider paths, got %d", calls)
			}
		})
	}
}

func TestWebFetchAndSearchHonorEarlierCancellation(t *testing.T) {
	previousDirect := ssrfSafeClient
	previousSearch := webSearchHTTPClient.GetClient().Transport
	t.Cleanup(func() {
		ssrfSafeClient = previousDirect
		webSearchHTTPClient.GetClient().Transport = previousSearch
	})
	transport := webFetchRoundTripper(func(request *http.Request) (*http.Response, error) {
		<-request.Context().Done()
		return nil, request.Context().Err()
	})
	ssrfSafeClient = &http.Client{Transport: transport}
	webSearchHTTPClient.GetClient().Transport = transport
	for _, search := range []bool{false, true} {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
		var err error
		if search {
			_, err = WebSearchContext(ctx, "test", "", 600)
		} else {
			_, err = WebFetchContext(ctx, "https://8.8.8.8", "markdown", 600)
		}
		cancel()
		if err == nil || !strings.Contains(err.Error(), "context deadline exceeded") {
			t.Fatalf("caller cancellation lost: %v", err)
		}
	}
}
