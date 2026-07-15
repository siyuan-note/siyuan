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
	"sync/atomic"
	"testing"
)

func TestModelWithImageInputCapability(t *testing.T) {
	var chatRequests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/models":
			http.Error(w, "unsupported", http.StatusNotFound)
		case "/v1/chat/completions":
			chatRequests.Add(1)
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			encoded, _ := json.Marshal(body)
			if !strings.Contains(string(encoded), "data:image/png;base64,") {
				t.Errorf("vision capability test did not include an image: %s", encoded)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"1"}}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	_, matched, err := TestModelWithCapabilities("test", server.URL+"/v1", "vision-model", []string{"image-input"}, 5)
	if err != nil || !matched || chatRequests.Load() != 1 {
		t.Fatalf("unexpected vision model test result: matched=%v requests=%d err=%v", matched, chatRequests.Load(), err)
	}
}

func TestModelWithImageOutputDoesNotGenerateBillableImage(t *testing.T) {
	var nonListRequests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/models" {
			http.Error(w, "unsupported", http.StatusNotFound)
			return
		}
		nonListRequests.Add(1)
		http.NotFound(w, r)
	}))
	defer server.Close()

	_, matched, err := TestModelWithCapabilities("test", server.URL+"/v1", "image-model", []string{"image-output"}, 5)
	if err == nil || matched || nonListRequests.Load() != 0 {
		t.Fatalf("image generation test must stop after model listing: matched=%v requests=%d err=%v", matched, nonListRequests.Load(), err)
	}
	if !strings.Contains(err.Error(), "potentially billed image") {
		t.Fatalf("unexpected image generation test error: %v", err)
	}
}
