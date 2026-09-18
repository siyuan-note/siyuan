package util

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/siyuan-note/httpclient"
)

type anthropicProviderRoundTrip func(*http.Request) (*http.Response, error)

func (f anthropicProviderRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func TestAnthropicProviderAuthentication(t *testing.T) {
	for _, test := range []struct {
		baseURL string
		headers map[string]string
		auth    string
		key     string
	}{
		{"https://openrouter.ai/api/v1", nil, "Bearer key", ""},
		{"https://openrouter.ai/api", map[string]string{"authorization": "Bearer custom"}, "Bearer custom", ""},
		{"https://api.anthropic.com/v1", nil, "", "key"},
		{"https://openrouter.ai.example.com/api/v1", nil, "", "key"},
	} {
		t.Run(test.baseURL+test.auth, func(t *testing.T) {
			client := newAnthropicHTTPClient("key", test.baseURL, test.headers)
			transport := client.Transport.(*httpclient.UserAgentTransport).Base.(*aiProviderHeaderTransport)
			calls := 0
			transport.base = anthropicProviderRoundTrip(func(r *http.Request) (*http.Response, error) {
				calls++
				if calls == 1 {
					if r.Header.Get("Authorization") != test.auth || r.Header.Get("x-api-key") != test.key {
						t.Error("unexpected provider credentials")
					}
					return &http.Response{StatusCode: http.StatusTemporaryRedirect,
						Header: http.Header{"Location": {"https://other.example.com/messages"}},
						Body:   io.NopCloser(strings.NewReader("")), Request: r}, nil
				}
				if r.Header.Get("Authorization") != "" || r.Header.Get("x-api-key") != "" {
					t.Error("credentials sent to redirect destination")
				}
				return &http.Response{StatusCode: http.StatusOK, Header: http.Header{},
					Body: io.NopCloser(strings.NewReader("{}")), Request: r}, nil
			})
			response, err := client.Get(test.baseURL + "/messages")
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			if calls != 2 {
				t.Fatalf("expected request and redirect, got %d", calls)
			}
		})
	}
}

func TestAnthropicProviderModelsEndpoint(t *testing.T) {
	for _, host := range []string{"dashscope.aliyuncs.com", "dashscope-intl.aliyuncs.com"} {
		for _, suffix := range []string{"", "/", "/v1", "/v1/"} {
			input := "https://" + host + "/apps/anthropic" + suffix
			want := "https://" + host + "/compatible-mode/v1"
			if got := anthropicModelsBaseURL(input); got != want {
				t.Errorf("models endpoint for %s: got %s, want %s", input, got, want)
			}
		}
	}
	for _, input := range []string{
		"https://api.anthropic.com/v1", "https://gateway.example.com/apps/anthropic",
		"https://dashscope.aliyuncs.com.example.com/apps/anthropic",
		"https://dashscope.aliyuncs.com/apps/anthropic?route=custom",
		"https://dashscope.aliyuncs.com/custom/apps/anthropic",
		"https://coding.dashscope.aliyuncs.com/apps/anthropic",
		"https://dashscope.aliyuncs.com:8443/apps/anthropic",
	} {
		if got := anthropicModelsBaseURL(input); got != "" {
			t.Errorf("custom endpoint must be preserved: %s became %s", input, got)
		}
	}
}
