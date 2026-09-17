// SiYuan - From thought to insight, with agents
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
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/sashabaranov/go-openai"
)

func TestMiniMaxImageEndpoints(t *testing.T) {
	for endpoint, want := range map[string]bool{
		"https://api.minimax.io/v1":             true,
		"https://api.minimax.cn/v1":             true,
		"https://api.minimax.cn/v1/":            true,
		"https://api.minimaxi.com/v1/":          true,
		"https://api.minimax.io.example.com/v1": false,
		"https://api.minimax.cn.example.com/v1": false,
		"https://example.com/v1":                false,
		"http://api.minimax.io/v1":              false,
		"https://api.minimax.io/anthropic":      false,
	} {
		if got := isMiniMaxImageEndpoint(endpoint); got != want {
			t.Errorf("endpoint %q: got %v, want %v", endpoint, got, want)
		}
	}
}

func TestMiniMaxImageAdapterProviderHeaders(t *testing.T) {
	for _, endpoint := range []string{"https://api.minimax.io/v1", "https://api.minimax.cn/v1"} {
		t.Run(endpoint, func(t *testing.T) {
			adapter := NewOpenAIImageAdapter("test", endpoint, "image-01", 1, map[string]string{
				"X-Test": "invalid\nvalue",
			})
			_, err := adapter.Generate(context.Background(), GenerateImageRequest{Prompt: "A header", Size: "auto"})
			if err == nil || !strings.Contains(err.Error(), "invalid AI provider HTTP headers") {
				t.Fatalf("expected provider header validation before sending the image request, got %v", err)
			}
		})
	}
}

func TestMiniMaxImageRequestAndResponse(t *testing.T) {
	for _, size := range []string{"auto", "1024x1536"} {
		t.Run(size, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/v1/image_generation" || r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer test" {
					t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
				}
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				if body["model"] != "image-01" || body["prompt"] != "A header" || body["n"] != float64(1) || body["response_format"] != "url" || body["prompt_optimizer"] != true {
					t.Errorf("unexpected payload: %#v", body)
				}
				if size == "auto" && body["aspect_ratio"] != "1:1" {
					t.Errorf("missing default aspect ratio: %#v", body)
				}
				if size != "auto" && (body["width"] != float64(1024) || body["height"] != float64(1536)) {
					t.Errorf("incorrect dimensions: %#v", body)
				}
				for _, key := range []string{"size", "quality", "output_format"} {
					if _, present := body[key]; present {
						t.Errorf("unsupported field %s was sent", key)
					}
				}
				w.Header().Set("Content-Type", "application/json")
				fmt.Fprint(w, `{"base_resp":{"status_code":0},"data":{"image_urls":["https://example.com/generated.png"]}}`)
			}))
			defer server.Close()
			config := openai.DefaultConfig("test")
			config.BaseURL = server.URL + "/v1"
			config.HTTPClient = &miniMaxImageTransport{base: server.Client()}
			client := openai.NewClientWithConfig(config)
			response, err := client.CreateImage(context.Background(), openai.ImageRequest{Model: "image-01", Prompt: "A header", N: 1, Size: size, Quality: "auto", OutputFormat: "png"})
			if err != nil {
				t.Fatal(err)
			}
			if len(response.Data) != 1 || response.Data[0].URL != "https://example.com/generated.png" {
				t.Fatalf("unexpected image response: %#v", response)
			}
		})
	}
}

func TestMiniMaxImageFailures(t *testing.T) {
	for _, body := range []string{
		`{"base_resp":{"status_code":1004},"data":{"image_urls":["https://example.com/image.png"]}}`,
		`{"base_resp":{"status_code":0},"data":{"image_urls":[]}}`,
		`{"data":{"image_urls":["https://example.com/image.png"]}}`,
		`invalid`,
	} {
		t.Run(body, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				fmt.Fprint(w, body)
			}))
			defer server.Close()
			config := openai.DefaultConfig("test")
			config.BaseURL = server.URL + "/v1"
			config.HTTPClient = &miniMaxImageTransport{base: server.Client()}
			_, err := openai.NewClientWithConfig(config).CreateImage(context.Background(), openai.ImageRequest{Model: "image-01", Prompt: "A header", N: 1})
			if err == nil {
				t.Fatal("expected image generation to fail")
			}
		})
	}
}
