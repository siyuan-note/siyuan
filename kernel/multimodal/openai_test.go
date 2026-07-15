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

package multimodal

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestOpenAIAdapterAnalyzeAndGenerate(t *testing.T) {
	generatedBytes := testPNG(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/chat/completions":
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			encoded, _ := json.Marshal(body)
			if !strings.Contains(string(encoded), "data:image/jpeg;base64,") {
				t.Errorf("vision request does not contain an image data URL: %s", encoded)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"a diagram"}}]}`))
		case "/v1/images/generations":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"data":[{"b64_json":"` + base64.StdEncoding.EncodeToString(generatedBytes) + `","revised_prompt":"refined"}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := &conf.Provider{APIKey: "test", BaseURL: server.URL + "/v1", RequestTimeout: 5, Protocol: "openai"}
	adapter := NewOpenAIAdapter(provider, &conf.Model{Name: "test-model"})
	analysis, err := adapter.Analyze(context.Background(), PreparedImage{Data: []byte("jpeg"), MIMEType: "image/jpeg"}, "What is shown?", "high")
	if err != nil || analysis != "a diagram" {
		t.Fatalf("unexpected analysis %q: %v", analysis, err)
	}
	generated, err := adapter.Generate(context.Background(), GenerateRequest{Prompt: "A header", Size: "1024x1024", OutputFormat: "png"})
	if err != nil {
		t.Fatal(err)
	}
	if generated.MIMEType != "image/png" || generated.Extension != ".png" || generated.RevisedPrompt != "refined" {
		t.Fatalf("unexpected generated image metadata: %#v", generated)
	}
}

func TestGeneratedImageDownloadSSRFGuards(t *testing.T) {
	if _, err := downloadGeneratedImage(context.Background(), "http://example.com/image.png"); err == nil {
		t.Fatal("non-HTTPS generated image URL must be rejected")
	}
	dialer := generatedImageDialer()
	if err := dialer.Control("tcp", "127.0.0.1:443", nil); err == nil {
		t.Fatal("private generated image address must be rejected")
	}
	if err := dialer.Control("tcp", "100.64.0.1:443", nil); err == nil {
		t.Fatal("shared address space must be rejected")
	}
	if err := dialer.Control("tcp", "1.1.1.1:443", nil); err != nil {
		t.Fatalf("public generated image address was rejected: %v", err)
	}
}

func testPNG(t *testing.T) []byte {
	t.Helper()
	var output bytes.Buffer
	if err := png.Encode(&output, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}
