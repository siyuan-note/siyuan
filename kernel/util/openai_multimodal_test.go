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
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestKeylessModelFallsBackToChatCompletion(t *testing.T) {
	var chatRequests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if authorization := r.Header.Get("Authorization"); authorization != "" {
			t.Errorf("unexpected Authorization header: %q", authorization)
		}
		switch r.URL.Path {
		case "/v1/models":
			http.Error(w, "unsupported", http.StatusNotFound)
		case "/v1/chat/completions":
			chatRequests.Add(1)
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if body["model"] != "test-model" {
				t.Errorf("unexpected model test request: %#v", body)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"1"}}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	_, matched, err := TestModel("", server.URL+"/v1", "test-model", 5)
	if err != nil || !matched || chatRequests.Load() != 1 {
		t.Fatalf("unexpected model test result: matched=%v requests=%d err=%v", matched, chatRequests.Load(), err)
	}
}

func TestPrepareForVisionPreservesAndLimitsImage(t *testing.T) {
	var source bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, 4, 2))
	img.Set(0, 0, color.RGBA{R: 255, A: 255})
	if err := png.Encode(&source, img); err != nil {
		t.Fatal(err)
	}
	original, err := PrepareForVision(source.Bytes(), 1024*1024, 8, 4)
	if err != nil {
		t.Fatal(err)
	}
	if original.MIMEType != "image/png" || !bytes.Equal(original.Data, source.Bytes()) {
		t.Fatalf("supported image should be preserved: %#v", original)
	}
	prepared, err := PrepareForVision(source.Bytes(), 1024*1024, 8, 2)
	if err != nil {
		t.Fatal(err)
	}
	if prepared.MIMEType != "image/png" || prepared.Width != 2 || prepared.Height != 1 {
		t.Fatalf("unexpected prepared image: %#v", prepared)
	}
	if _, err = PrepareForVision(source.Bytes(), 1024*1024, 7, 2); err == nil {
		t.Fatal("pixel limit was not enforced before decoding")
	}
	if _, err = PrepareForVision([]byte(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`), 1024, 100, 100); err == nil {
		t.Fatal("SVG input must be rejected")
	}
}

func TestOpenAIImageAdapterAnalyzeAndGenerate(t *testing.T) {
	generatedBytes := testGeneratedPNG(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/chat/completions":
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if body["max_completion_tokens"] != float64(imageAnalysisMaxTokens) {
				t.Errorf("unexpected vision max completion tokens: %v", body["max_completion_tokens"])
			}
			encoded, _ := json.Marshal(body)
			if !strings.Contains(string(encoded), "data:image/jpeg;base64,") {
				t.Errorf("vision request does not contain an image data URL: %s", encoded)
			}
			if strings.Contains(string(encoded), "document task") || !strings.Contains(string(encoded), "user's task") {
				t.Errorf("vision request is not task-generic: %s", encoded)
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

	adapter := NewOpenAIImageAdapter("test", server.URL+"/v1", "test-model", 5)
	analysis, err := adapter.Analyze(context.Background(), PreparedImage{Data: []byte("jpeg"), MIMEType: "image/jpeg"}, "What is shown?", "high")
	if err != nil || analysis != "a diagram" {
		t.Fatalf("unexpected analysis %q: %v", analysis, err)
	}
	generated, err := adapter.Generate(context.Background(), GenerateImageRequest{Prompt: "A header", Size: "1024x1024", OutputFormat: "png"})
	if err != nil {
		t.Fatal(err)
	}
	if generated.MIMEType != "image/png" || generated.Extension != ".png" || generated.RevisedPrompt != "refined" {
		t.Fatalf("unexpected generated image metadata: %#v", generated)
	}
}

func TestOpenAIImageAdapterRejectsTruncatedAnalysis(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"partial"},"finish_reason":"length"}]}`))
	}))
	defer server.Close()

	adapter := NewOpenAIImageAdapter("test", server.URL+"/v1", "test-model", 5)
	_, err := adapter.Analyze(context.Background(), PreparedImage{Data: []byte("jpeg"), MIMEType: "image/jpeg"}, "Describe", "low")
	if err == nil || !strings.Contains(err.Error(), "truncated") {
		t.Fatalf("unexpected truncated analysis error: %v", err)
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
	if timeout := generatedImageHTTPClient().Timeout; timeout != 0 {
		t.Fatalf("generated image download must use the request context timeout, got %s", timeout)
	}
}

func testGeneratedPNG(t *testing.T) []byte {
	t.Helper()
	var output bytes.Buffer
	if err := png.Encode(&output, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}
