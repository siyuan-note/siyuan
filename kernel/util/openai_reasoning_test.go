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
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/sashabaranov/go-openai"
)

func TestOpenAIReasoningResponseNormalizesAliases(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprint(w, `{"choices":[{"message":{"role":"assistant","content":"answer","reasoning":"thought"}}]}`)
	}))
	defer server.Close()

	client := newReasoningTestClient(server)
	response, err := client.CreateChatCompletion(t.Context(), openai.ChatCompletionRequest{Model: "test-model"})
	if err != nil {
		t.Fatal(err)
	}
	if len(response.Choices) != 1 || response.Choices[0].Message.ReasoningContent != "thought" {
		t.Fatalf("reasoning alias was not normalized: %#v", response)
	}
}

func TestOpenAIReasoningStreamNormalizesAlias(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = fmt.Fprint(w,
			"data: {\"choices\":[{\"delta\":{\"reasoning\":\"thought\"}}]}\n\n"+
				"data: {\"choices\":[{\"delta\":{\"content\":\"answer\"}}]}\n\n"+
				"data: [DONE]\n\n")
	}))
	defer server.Close()

	client := newReasoningTestClient(server)
	stream, err := client.CreateChatCompletionStream(t.Context(), openai.ChatCompletionRequest{Model: "test-model"})
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()

	var reasoning, content string
	for {
		response, receiveErr := stream.Recv()
		if receiveErr != nil {
			if receiveErr == io.EOF {
				break
			}
			t.Fatal(receiveErr)
		}
		for _, choice := range response.Choices {
			reasoning += choice.Delta.ReasoningContent
			content += choice.Delta.Content
		}
	}
	if reasoning != "thought" || content != "answer" {
		t.Fatalf("normalized stream = reasoning %q, content %q", reasoning, content)
	}
}

func TestNormalizeReasoningFieldsPreservesCanonicalValueAndDetails(t *testing.T) {
	data := []byte(`{"choices":[{"message":{"reasoning":"alias","reasoning_content":"canonical","reasoning_details":[{"type":"summary"}]}}]}`)
	normalized, changed := normalizeReasoningJSON(data)
	if changed {
		t.Fatal("canonical reasoning_content should not be rewritten")
	}
	if !bytes.Equal(normalized, data) {
		t.Fatalf("normalization changed the response: %s", normalized)
	}

	data = []byte(`{"choices":[{"message":{"reasoning":"alias","reasoning_content":""}}]}`)
	normalized, changed = normalizeReasoningJSON(data)
	if changed || !bytes.Equal(normalized, data) {
		t.Fatalf("empty canonical reasoning_content was overwritten: %s", normalized)
	}

	data = []byte(`{"created":9007199254740993,"choices":[{"message":{"reasoning":"alias","reasoning_details":[{"type":"summary"}]}}]}`)
	normalized, changed = normalizeReasoningJSON(data)
	if !changed || !strings.Contains(string(normalized), `"reasoning_details":[{"type":"summary"}]`) ||
		!strings.Contains(string(normalized), `"reasoning_content":"alias"`) ||
		!strings.Contains(string(normalized), `"created":9007199254740993`) {
		t.Fatalf("reasoning alias was not normalized without losing details: %s", normalized)
	}
}

func TestNormalizeReasoningJSONRejectsTrailingData(t *testing.T) {
	data := []byte(`{"choices":[{"message":{"reasoning":"alias"}}]} trailing`)
	normalized, changed := normalizeReasoningJSON(data)
	if changed || normalized != nil {
		t.Fatalf("invalid response was normalized: %s", normalized)
	}
}

func TestReasoningSSEBodyHandlesReadBoundaries(t *testing.T) {
	source := &chunkedReadCloser{data: []byte(
		"data: {\"choices\":[{\"delta\":{\"reasoning\":\"thought\"}}]}\r\n\r\n" +
			"data: [DONE]\r\n\r\n"), chunkSize: 1}
	body := newReasoningResponseBody(source, true)
	data, err := io.ReadAll(body)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"reasoning_content":"thought"`) {
		t.Fatalf("SSE normalization failed across reads: %s", data)
	}
}

func TestReasoningSSEBodyNormalizesFinalLineWithoutNewline(t *testing.T) {
	body := newReasoningResponseBody(io.NopCloser(strings.NewReader(
		`data: {"choices":[{"delta":{"reasoning":"thought"}}]}`)), true)
	data, err := io.ReadAll(body)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"reasoning_content":"thought"`) || strings.HasSuffix(string(data), "\n") {
		t.Fatalf("final SSE line was not preserved and normalized: %q", data)
	}
}

func TestReasoningResponseTransportPassesNonChatRequestsThrough(t *testing.T) {
	const body = `{"reasoning":"keep"}`
	transport := &reasoningResponseTransport{base: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(body)),
			Request:    req,
		}, nil
	})}
	req, err := http.NewRequest(http.MethodPost, "https://example.com/v1/embeddings", nil)
	if err != nil {
		t.Fatal(err)
	}
	response, err := transport.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != body {
		t.Fatalf("non-chat response was changed: %s", data)
	}
}

type chunkedReadCloser struct {
	data      []byte
	chunkSize int
}

func (r *chunkedReadCloser) Read(p []byte) (int, error) {
	if len(r.data) == 0 {
		return 0, io.EOF
	}
	n := min(len(p), r.chunkSize, len(r.data))
	copy(p, r.data[:n])
	r.data = r.data[n:]
	return n, nil
}

func (r *chunkedReadCloser) Close() error {
	return nil
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) Do(req *http.Request) (*http.Response, error) {
	return f(req)
}

func newReasoningTestClient(server *httptest.Server) *openai.Client {
	config := openai.DefaultConfig("test")
	config.BaseURL = server.URL + "/v1"
	config.HTTPClient = &reasoningResponseTransport{base: server.Client()}
	return openai.NewClientWithConfig(config)
}
