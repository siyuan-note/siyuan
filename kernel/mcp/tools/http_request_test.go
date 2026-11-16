// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package tools

import (
	"strconv"
	"testing"
)

func TestHTTPResponseResult(t *testing.T) {
	tests := []struct {
		statusCode  int
		contentType string
		body        string
		wantError   bool
	}{
		{200, "application/json; charset=utf-8", `{"ok":true}`, false},
		{204, "", "", false},
		{301, "text/html", "<a href=\"/new\">Moved</a>", false},
		{302, "text/plain", "Found", false},
		{304, "", "", false},
		{399, "text/plain", "Redirect boundary", false},
		{400, "application/json", `{"error":"bad request"}`, true},
		{404, "text/html; charset=utf-8", "<h1>Not found</h1>\n", true},
		{429, "application/json", `{"error":"rate limit","retry_after":60}`, true},
		{500, "text/plain", " upstream failure\n\n", true},
	}
	for _, test := range tests {
		t.Run(strconv.Itoa(test.statusCode), func(t *testing.T) {
			result := httpResponseResult(test.statusCode, test.contentType, test.body)
			if result.IsError != test.wantError {
				t.Errorf("IsError = %v, want %v", result.IsError, test.wantError)
			}
			if len(result.Content) != 1 {
				t.Fatalf("content items = %d, want 1", len(result.Content))
			}
			if result.Content[0].Type != "text" {
				t.Errorf("content type = %q, want text", result.Content[0].Type)
			}
			want := "HTTP " + strconv.Itoa(test.statusCode) + " " + test.contentType + "\n\n" + test.body
			if result.Content[0].Text != want {
				t.Errorf("response = %q, want %q", result.Content[0].Text, want)
			}
		})
	}
}
