// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type changelogRoundTrip func(*http.Request) (*http.Response, error)

func (trip changelogRoundTrip) RoundTrip(request *http.Request) (*http.Response, error) {
	return trip(request)
}

func changelogResponse(status int, body string) *http.Response {
	return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}
}

func releaseChangelogJSON(tag, body string) string {
	data, _ := json.Marshal(map[string]any{"tag_name": tag, "body": body, "draft": false})
	return string(data)
}

func TestReleaseChangelogExactVersionAndCache(t *testing.T) {
	var calls atomic.Int32
	source := &releaseChangelogSource{client: &http.Client{Transport: changelogRoundTrip(func(request *http.Request) (*http.Response, error) {
		calls.Add(1)
		if request.Method != http.MethodGet || request.URL.Host != "api.github.com" ||
			request.Header.Get("Accept") != "application/vnd.github+json" || request.Header.Get("Authorization") != "" {
			t.Errorf("unexpected request: %s %s", request.Method, request.URL)
		}
		tag := strings.TrimPrefix(request.URL.Path, "/repos/siyuan-note/siyuan/releases/tags/")
		if tag != "v1.0.0-alpha.1" && tag != "v3.8.10-alpha.5" {
			t.Errorf("unexpected release tag: %s", tag)
		}
		return changelogResponse(200, releaseChangelogJSON(tag, "## Changes\n\n- **"+tag+"**\n\n[Issue](https://github.com/siyuan-note/siyuan/issues/21189)")), nil
	})}}
	for _, version := range []string{"1.0.0-alpha.1", "3.8.10-alpha.5", "1.0.0-alpha.1"} {
		content, err := source.get(context.Background(), version)
		if err != nil || !strings.Contains(content, "<strong>v"+version+"</strong>") || !strings.Contains(content, `target="_blank"`) {
			t.Fatalf("version %s: %s, %v", version, content, err)
		}
	}
	if calls.Load() != 2 {
		t.Fatalf("cache did not keep exact versions: %d requests", calls.Load())
	}
	source.cache.Store("v1.0.0-alpha.1", cachedReleaseChangelog{html: "expired", expiresAt: time.Now().Add(-time.Second)})
	if _, err := source.get(context.Background(), "1.0.0-alpha.1"); err != nil || calls.Load() != 3 {
		t.Fatalf("expired cache was not refreshed: %d, %v", calls.Load(), err)
	}
}

func TestReleaseChangelogFailuresCanRetry(t *testing.T) {
	for name, response := range map[string]*http.Response{
		"missing": changelogResponse(404, ""), "limited": changelogResponse(403, ""), "too many": changelogResponse(429, ""),
		"server": changelogResponse(503, ""), "malformed": changelogResponse(200, "not json"),
		"wrong tag": changelogResponse(200, releaseChangelogJSON("v3.8.10-alpha.4", "old")),
		"empty":     changelogResponse(200, releaseChangelogJSON("v3.8.10-alpha.5", " \n\t")),
		"draft":     changelogResponse(200, `{"tag_name":"v3.8.10-alpha.5","draft":true,"body":"private"}`),
		"large":     changelogResponse(200, strings.Repeat("x", maxReleaseChangelogSize+1)),
	} {
		t.Run(name, func(t *testing.T) {
			calls := 0
			source := &releaseChangelogSource{client: &http.Client{Transport: changelogRoundTrip(func(*http.Request) (*http.Response, error) {
				calls++
				if calls == 1 {
					return response, nil
				}
				return changelogResponse(200, releaseChangelogJSON("v3.8.10-alpha.5", "retry succeeded")), nil
			})}}
			if _, err := source.get(context.Background(), "3.8.10-alpha.5"); err == nil {
				t.Fatal("invalid response was accepted")
			}
			if content, err := source.get(context.Background(), "3.8.10-alpha.5"); err != nil || !strings.Contains(content, "retry succeeded") || calls != 2 {
				t.Fatalf("failed result blocked retry: %s, %v, %d", content, err, calls)
			}
		})
	}
}

func TestReleaseChangelogRejectsInvalidVersions(t *testing.T) {
	source := &releaseChangelogSource{client: &http.Client{Transport: changelogRoundTrip(func(*http.Request) (*http.Response, error) {
		t.Error("invalid version made a network request")
		return nil, errors.New("unexpected request")
	})}}
	for _, version := range []string{"", "3.8.10", "v3.8.10-alpha.5", "../../latest", "3.8.10-alpha.5?url=http://localhost"} {
		if _, err := source.get(context.Background(), version); err == nil {
			t.Errorf("accepted version %q", version)
		}
	}
}

func TestReleaseChangelogConcurrentRequestsAndCancellation(t *testing.T) {
	started, finish := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	source := &releaseChangelogSource{client: &http.Client{Transport: changelogRoundTrip(func(request *http.Request) (*http.Response, error) {
		if calls.Add(1) == 1 {
			close(started)
		}
		if deadline, ok := request.Context().Deadline(); !ok || time.Until(deadline) > releaseChangelogTimeout {
			t.Error("shared request has no bounded deadline")
		}
		<-finish
		return changelogResponse(200, releaseChangelogJSON("v3.8.10-alpha.5", "shared")), nil
	})}}
	ctx, cancel := context.WithCancel(context.Background())
	first := make(chan error, 1)
	go func() { _, err := source.get(ctx, "3.8.10-alpha.5"); first <- err }()
	<-started
	second := make(chan error, 1)
	go func() { _, err := source.get(context.Background(), "3.8.10-alpha.5"); second <- err }()
	cancel()
	if err := <-first; !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled caller kept waiting: %v", err)
	}
	close(finish)
	if err := <-second; err != nil || calls.Load() != 1 {
		t.Fatalf("shared request was duplicated or cancelled: %v, %d", err, calls.Load())
	}
}

func TestReleaseChangelogNetworkFailureAndDeadline(t *testing.T) {
	for _, networkError := range []error{errors.New("offline"), context.DeadlineExceeded} {
		source := &releaseChangelogSource{client: &http.Client{Transport: changelogRoundTrip(func(*http.Request) (*http.Response, error) {
			return nil, networkError
		})}}
		if _, err := source.get(context.Background(), "3.8.10-alpha.5"); !errors.Is(err, networkError) {
			t.Fatalf("network error was lost: %v", err)
		}
	}
}

func TestReleaseChangelogClientRejectsRedirects(t *testing.T) {
	var redirected atomic.Bool
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { redirected.Store(true) }))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Redirect(writer, request, target.URL, http.StatusFound)
	}))
	defer server.Close()
	client := newReleaseChangelogClient()
	if client.Timeout != releaseChangelogTimeout {
		t.Fatalf("unexpected timeout: %s", client.Timeout)
	}
	response, err := client.Get(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusFound || redirected.Load() {
		t.Fatal("redirect left the approved endpoint")
	}
}

func TestReleaseChangelogSanitizesMarkdown(t *testing.T) {
	body := "## Changes\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))\n\n<strong onclick=\"alert(1)\">safe</strong>"
	source := &releaseChangelogSource{client: &http.Client{Transport: changelogRoundTrip(func(*http.Request) (*http.Response, error) {
		return changelogResponse(200, releaseChangelogJSON("v3.8.10-alpha.5", body)), nil
	})}}
	content, err := source.get(context.Background(), "3.8.10-alpha.5")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(content, "<script") || strings.Contains(content, "onclick=") || strings.Contains(content, `href="javascript:`) || !strings.Contains(content, "<strong>safe</strong>") {
		t.Fatalf("unsafe rendered changelog: %s", content)
	}
}
