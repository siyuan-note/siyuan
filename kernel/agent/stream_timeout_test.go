// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package agent

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	openai "github.com/sashabaranov/go-openai"
	kernelConf "github.com/siyuan-note/siyuan/kernel/conf"
	kernelModel "github.com/siyuan-note/siyuan/kernel/model"
)

func TestStreamIdleTimeoutResetsAfterEachChunk(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		flusher := prepareTestStream(t, w)
		for i := 0; i < 6; i++ {
			writeTestStreamChunk(t, w, flusher, fmt.Sprintf("%d", i))
			if i < 5 {
				time.Sleep(60 * time.Millisecond)
			}
		}
		writeTestStreamDone(t, w, flusher)
	}))
	defer server.Close()

	client := newTestOpenAIClient(server.URL)
	stream, _, cancel, err := createStreamWithRetry(context.Background(), client, testChatRequest(), 0, time.Second, 250*time.Millisecond, noRetryDelay, make(chan AgentEvent, 1))
	if err != nil {
		t.Fatalf("create stream failed: %v", err)
	}
	defer cancel()
	defer stream.Close()

	chunks := 1
	for {
		_, recvErr := recvStreamWithIdleTimeout(stream, 250*time.Millisecond, cancel)
		if errors.Is(recvErr, io.EOF) {
			break
		}
		if recvErr != nil {
			t.Fatalf("receive stream failed after %d chunks: %v", chunks, recvErr)
		}
		chunks++
	}
	if chunks != 6 {
		t.Fatalf("received %d chunks, want 6", chunks)
	}
}

func TestStreamIdleTimeoutAfterPartialResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		flusher := prepareTestStream(t, w)
		writeTestStreamChunk(t, w, flusher, "partial")
		<-r.Context().Done()
	}))
	defer server.Close()

	client := newTestOpenAIClient(server.URL)
	stream, _, cancel, err := createStreamWithRetry(context.Background(), client, testChatRequest(), 0, time.Second, 50*time.Millisecond, noRetryDelay, make(chan AgentEvent, 1))
	if err != nil {
		t.Fatalf("create stream failed: %v", err)
	}
	defer cancel()
	defer stream.Close()

	_, recvErr := recvStreamWithIdleTimeout(stream, 50*time.Millisecond, cancel)
	if !errors.Is(recvErr, errModelStreamIdleTimeout) {
		t.Fatalf("receive error = %v, want stream idle timeout", recvErr)
	}
}

func TestCreateStreamRetriesFirstResponseTimeoutWithFreshContext(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempt := requests.Add(1)
		flusher := prepareTestStream(t, w)
		if attempt == 1 {
			<-r.Context().Done()
			return
		}
		writeTestStreamChunk(t, w, flusher, "success")
		writeTestStreamDone(t, w, flusher)
	}))
	defer server.Close()

	events := make(chan AgentEvent, 2)
	client := newTestOpenAIClient(server.URL)
	stream, first, cancel, err := createStreamWithRetry(context.Background(), client, testChatRequest(), 1, time.Second, 50*time.Millisecond, noRetryDelay, events)
	if err != nil {
		t.Fatalf("create stream failed: %v", err)
	}
	defer cancel()
	defer stream.Close()

	if requests.Load() != 2 {
		t.Fatalf("request count = %d, want 2", requests.Load())
	}
	if len(first.Choices) != 1 || first.Choices[0].Delta.Content != "success" {
		t.Fatalf("unexpected first response: %#v", first)
	}
	select {
	case event := <-events:
		if event.Type != "retry" || event.RetryAttempt != 1 || event.RetryMax != 1 {
			t.Fatalf("unexpected retry event: %#v", event)
		}
	default:
		t.Fatal("missing retry event")
	}
}

func TestCreateStreamRequestTimeoutAndZeroRetries(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		select {
		case <-r.Context().Done():
		case <-time.After(200 * time.Millisecond):
		}
	}))
	defer server.Close()

	client := newTestOpenAIClient(server.URL)
	_, _, cancel, err := createStreamWithRetry(context.Background(), client, testChatRequest(), 0, 50*time.Millisecond, time.Second, noRetryDelay, make(chan AgentEvent, 1))
	if cancel != nil {
		cancel()
	}
	if !errors.Is(err, errModelRequestTimeout) {
		t.Fatalf("create error = %v, want request timeout", err)
	}
	if requests.Load() != 1 {
		t.Fatalf("request count = %d, want 1", requests.Load())
	}
}

func TestCreateStreamRetriesRequestTimeoutWithFreshContext(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempt := requests.Add(1)
		if attempt == 1 {
			select {
			case <-r.Context().Done():
			case <-time.After(200 * time.Millisecond):
			}
			return
		}
		flusher := prepareTestStream(t, w)
		writeTestStreamChunk(t, w, flusher, "success")
		writeTestStreamDone(t, w, flusher)
	}))
	defer server.Close()

	client := newTestOpenAIClient(server.URL)
	stream, first, cancel, err := createStreamWithRetry(context.Background(), client, testChatRequest(), 1, 50*time.Millisecond, time.Second, noRetryDelay, make(chan AgentEvent, 2))
	if err != nil {
		t.Fatalf("create stream failed: %v", err)
	}
	defer cancel()
	defer stream.Close()
	if requests.Load() != 2 {
		t.Fatalf("request count = %d, want 2", requests.Load())
	}
	if len(first.Choices) != 1 || first.Choices[0].Delta.Content != "success" {
		t.Fatalf("unexpected first response: %#v", first)
	}
}

func TestAgentChatPartialStreamTimeoutSavesInterruptedWithoutRetry(t *testing.T) {
	useTestDataDir(t)
	originalConf := kernelModel.Conf
	kernelModel.Conf = kernelModel.NewAppConf()
	kernelModel.Conf.AI = kernelConf.NewAI()
	kernelModel.Conf.AI.MCP = nil
	kernelModel.Conf.AI.Agent.MaxToolCallRounds = 1
	kernelModel.Conf.Variables = kernelConf.NewVariables()
	t.Cleanup(func() {
		kernelModel.Conf = originalConf
	})

	session := map[string]any{
		"id":        testSessionID,
		"title":     "timeout test",
		"createdAt": int64(1),
		"updatedAt": int64(1),
		"entries":   []any{map[string]any{"id": "user-1", "type": "user", "content": "hello"}},
	}
	if revision, err := SaveSession(marshalSession(t, session)); err != nil || revision != 1 {
		t.Fatalf("save initial session failed: revision=%d, err=%v", revision, err)
	}

	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		flusher := prepareTestStream(t, w)
		writeTestStreamChunk(t, w, flusher, "partial")
		<-r.Context().Done()
	}))
	defer server.Close()

	events := AgentChat(context.Background(), newTestOpenAIClient(server.URL), "test-model", testSessionID, "user-1", 1, "hello", "English", nil, EditorContext{}, nil, false, time.Second, 3, "", time.Second, 50*time.Millisecond)
	contentSeen := false
	errorSeen := false
	for event := range events {
		if event.Type == "content" && event.Token == "partial" {
			contentSeen = true
		}
		if event.Type == "error" {
			errorSeen = true
		}
	}
	if !contentSeen || !errorSeen {
		t.Fatalf("unexpected events: contentSeen=%v, errorSeen=%v", contentSeen, errorSeen)
	}
	if requests.Load() != 1 {
		t.Fatalf("request count = %d, want 1", requests.Load())
	}

	runtime, err := loadRuntimeState(testSessionID)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.ActiveTurn == nil || runtime.ActiveTurn.State != "interrupted" {
		t.Fatalf("runtime turn was not interrupted: %#v", runtime.ActiveTurn)
	}
	if len(runtime.ActiveTurn.Delta) != 1 || runtime.ActiveTurn.Delta[0].Role != "assistant" || runtime.ActiveTurn.Delta[0].Content != "partial" {
		t.Fatalf("partial response was not checkpointed: %#v", runtime.ActiveTurn.Delta)
	}
}

func TestCreateStreamAcceptsEmptySuccessfulResponse(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		flusher := prepareTestStream(t, w)
		writeTestStreamDone(t, w, flusher)
	}))
	defer server.Close()

	client := newTestOpenAIClient(server.URL)
	stream, _, cancel, err := createStreamWithRetry(context.Background(), client, testChatRequest(), 1, time.Second, time.Second, noRetryDelay, make(chan AgentEvent, 1))
	if err != nil {
		t.Fatalf("create stream failed: %v", err)
	}
	defer cancel()
	defer stream.Close()
	if requests.Load() != 1 {
		t.Fatalf("request count = %d, want 1", requests.Load())
	}
	if _, recvErr := stream.Recv(); !errors.Is(recvErr, io.EOF) {
		t.Fatalf("receive error = %v, want EOF", recvErr)
	}
}

func newTestOpenAIClient(serverURL string) *openai.Client {
	config := openai.DefaultConfig("test-key")
	config.BaseURL = serverURL + "/v1"
	return openai.NewClientWithConfig(config)
}

func testChatRequest() openai.ChatCompletionRequest {
	return openai.ChatCompletionRequest{
		Model:    "test-model",
		Messages: []openai.ChatCompletionMessage{{Role: openai.ChatMessageRoleUser, Content: "test"}},
		Stream:   true,
	}
}

func noRetryDelay(string, int) time.Duration {
	return 0
}

func prepareTestStream(t *testing.T, w http.ResponseWriter) http.Flusher {
	t.Helper()
	flusher, ok := w.(http.Flusher)
	if !ok {
		t.Fatal("response writer does not support streaming")
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()
	return flusher
}

func writeTestStreamChunk(t *testing.T, w http.ResponseWriter, flusher http.Flusher, content string) {
	t.Helper()
	if _, err := fmt.Fprintf(w, "data: {\"id\":\"chatcmpl-test\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"test-model\",\"choices\":[{\"index\":0,\"delta\":{\"content\":%q}}]}\n\n", content); err != nil {
		t.Fatalf("write stream chunk failed: %v", err)
	}
	flusher.Flush()
}

func writeTestStreamDone(t *testing.T, w http.ResponseWriter, flusher http.Flusher) {
	t.Helper()
	if _, err := io.WriteString(w, "data: [DONE]\n\n"); err != nil {
		t.Fatalf("write stream terminator failed: %v", err)
	}
	flusher.Flush()
}
