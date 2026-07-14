// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package util

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestTestRerankModelValidatesResults(t *testing.T) {
	tests := []struct {
		name    string
		body    string
		matched bool
	}{
		{name: "valid", body: `{"results":[{"index":1,"relevance_score":0.9},{"index":0,"relevance_score":0.8}]}`, matched: true},
		{name: "empty", body: `{"results":[]}`},
		{name: "nested", body: `{"output":{"results":[{"index":1,"relevance_score":0.9},{"index":0,"relevance_score":0.8}]}}`},
		{name: "duplicate", body: `{"results":[{"index":0,"relevance_score":0.9},{"index":0,"relevance_score":0.8}]}`},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(test.body))
			}))
			defer server.Close()

			matched, err := TestRerankModel("key", server.URL, "model", 5)
			if matched != test.matched {
				t.Fatalf("matched = %v, want %v", matched, test.matched)
			}
			if test.matched && nil != err {
				t.Fatalf("unexpected error: %v", err)
			}
			if !test.matched && nil == err {
				t.Fatal("expected validation error")
			}
		})
	}
}

func TestRerankTruncatesDocumentsByRunes(t *testing.T) {
	var received rerankRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&received); nil != err {
			t.Fatalf("decode request failed: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"results":[{"index":0,"relevance_score":1}]}`))
	}))
	defer server.Close()

	document := strings.Repeat("中", rerankDocTextMaxRunes+1)
	indices, _, err := Rerank("query", []string{document}, "key", server.URL, "model", 1, 5)
	if nil != err {
		t.Fatalf("Rerank failed: %v", err)
	}
	if len(indices) != 1 || indices[0] != 0 {
		t.Fatalf("unexpected indices: %v", indices)
	}
	if len(received.Documents) != 1 {
		t.Fatalf("unexpected documents: %v", received.Documents)
	}
	if !utf8.ValidString(received.Documents[0]) {
		t.Fatal("truncated document is not valid UTF-8")
	}
	if got := utf8.RuneCountInString(received.Documents[0]); got != rerankDocTextMaxRunes {
		t.Fatalf("rune count = %d, want %d", got, rerankDocTextMaxRunes)
	}
}
