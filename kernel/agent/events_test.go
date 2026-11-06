// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package agent

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
)

func TestAgentEventsDeliverEveryTokenAndUsageInOrder(t *testing.T) {
	ctx, cancel := context.WithCancelCause(context.Background())
	defer cancel(nil)
	input := make(chan AgentEvent, 4)
	output := relayAgentEvents(ctx, cancel, input, time.Second, func(error) string { return "interrupted" })
	go func() {
		defer close(input)
		for i := range 600 {
			typ := "content"
			if i%2 != 0 {
				typ = "reasoning"
			}
			sendEvent(ctx, input, AgentEvent{Type: typ, Token: fmt.Sprint(i)})
		}
		sendEvent(ctx, input, AgentEvent{Type: "usage", PromptTokens: 123})
		sendEvent(ctx, input, AgentEvent{Type: "done"})
	}()
	count := 0
	for event := range output {
		switch {
		case count < 600:
			if event.Token != fmt.Sprint(count) {
				t.Fatalf("event %d = %#v", count, event)
			}
		case count == 600:
			if event.Type != "usage" || event.PromptTokens != 123 {
				t.Fatalf("usage = %#v", event)
			}
		case count == 601:
			if event.Type != "done" {
				t.Fatalf("terminal = %#v", event)
			}
		default:
			t.Fatalf("unexpected extra event: %#v", event)
		}
		count++
	}
	if count != 602 {
		t.Fatalf("received %d events", count)
	}
}

func TestAgentEventsSlowConsumerCancelsBeforeFinalizationAndDrains(t *testing.T) {
	ctx, cancel := context.WithCancelCause(context.Background())
	defer cancel(nil)
	input := make(chan AgentEvent, 2)
	output := relayAgentEvents(ctx, cancel, input, 20*time.Millisecond, func(cause error) string {
		if !errors.Is(cause, errSlowConsumer) {
			t.Errorf("cancellation cause = %v", cause)
		}
		return "slow consumer"
	})
	input <- AgentEvent{Type: "turn", TurnID: "turn"}
	input <- AgentEvent{Type: "content", Token: "accepted"}
	select {
	case <-ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("stalled consumer did not cancel generation")
	}
	// 生产者仍可完成工具结果持久化；取消后的发送不会阻塞收尾。
	sendEvent(ctx, input, AgentEvent{Type: "tool_result", Result: "persisted separately"})
	if event := <-output; event.Type != "turn" || event.TurnID != "turn" {
		t.Fatalf("turn identity lost: %#v", event)
	}
	if event := <-output; event.Token != "accepted" {
		t.Fatalf("accepted token lost: %#v", event)
	}
	select {
	case event := <-output:
		t.Fatalf("terminal before producer finalization: %#v", event)
	case <-time.After(40 * time.Millisecond):
	}
	close(input)
	if event := <-output; event.Type != "interrupted" || event.Error != "slow consumer" {
		t.Fatalf("terminal = %#v", event)
	}
	if _, open := <-output; open {
		t.Fatal("more than one terminal event")
	}
}

func TestAgentEventsIdleInputDoesNotTimeOut(t *testing.T) {
	ctx, cancel := context.WithCancelCause(context.Background())
	defer cancel(nil)
	input := make(chan AgentEvent)
	output := relayAgentEvents(ctx, cancel, input, 10*time.Millisecond, func(error) string { return "interrupted" })
	time.Sleep(40 * time.Millisecond)
	if ctx.Err() != nil {
		t.Fatal("idle tool or question wait cancelled the session")
	}
	go func() {
		sendEvent(ctx, input, AgentEvent{Type: "error", Error: "complete"})
		close(input)
	}()
	if event := <-output; event.Type != "error" {
		t.Fatalf("terminal = %#v", event)
	}
	if _, open := <-output; open {
		t.Fatal("duplicate terminal event")
	}
}

func TestAgentEventsSessionTimeoutWaitsForProducerClose(t *testing.T) {
	ctx, cancel := context.WithCancelCause(context.Background())
	input := make(chan AgentEvent)
	output := relayAgentEvents(ctx, cancel, input, time.Second, func(cause error) string {
		if !errors.Is(cause, ErrSessionTimeout) {
			t.Errorf("timeout cause = %v", cause)
		}
		return "session timeout"
	})
	cancel(ErrSessionTimeout)
	select {
	case event := <-output:
		t.Fatalf("terminal before checkpoint completion: %#v", event)
	case <-time.After(20 * time.Millisecond):
	}
	close(input)
	if event := <-output; event.Type != "interrupted" || event.Error != "session timeout" {
		t.Fatalf("terminal = %#v", event)
	}
	if _, open := <-output; open {
		t.Fatal("output was not closed")
	}
}

func TestAgentCancelledToolPersistsUnknownResultBeforeTerminal(t *testing.T) {
	setupToolRoundLimitAgentTest(t, 0)
	const name = "test_cancelled_result"
	started := make(chan struct{})
	finalize := make(chan struct{})
	defer close(finalize)
	if err := tools.SetTool(name, &tools.Tool{
		Name: name, Source: "native", ReadOnlyHint: true,
		InputSchema:   tools.ToolSchema{Type: "object"},
		ActionEffects: map[string]tools.ToolEffects{"": {LocalRead: true}},
		ContextHandler: func(ctx context.Context, _ map[string]any) (tools.CallToolResult, error) {
			close(started)
			<-ctx.Done()
			<-finalize
			return tools.CallToolResult{IsError: true, ExecutionUnknown: true,
				Content: []tools.ContentItem{{Type: "text", Text: "result unknown after cancellation"}}}, nil
		},
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { tools.RemoveTool(name) })
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		flusher := prepareTestStream(t, w)
		_, _ = fmt.Fprintf(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"unknown-call\",\"type\":\"function\",\"function\":{\"name\":%q,\"arguments\":\"{}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n", name)
		flusher.Flush()
		writeTestStreamDone(t, w, flusher)
	}))
	defer server.Close()
	ctx, cancel := context.WithCancelCause(context.Background())
	defer cancel(nil)
	events := AgentChat(ctx, newTestOpenAIClient(server.URL), "openai", "test-model", "", 0,
		testSessionID, "user-1", 1, "read and edit", nil, "English", nil, EditorContext{}, nil, false,
		time.Second, 0, "", time.Second, time.Second)
	completed := make(chan []AgentEvent, 1)
	go func() {
		var received []AgentEvent
		for event := range events {
			received = append(received, event)
		}
		completed <- received
	}()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("tool did not start")
	}
	cancel(ErrSessionTimeout)
	var received []AgentEvent
	select {
	case received = <-completed:
	case <-time.After(3 * time.Second):
		t.Fatal("cancelled producer did not finish")
	}
	if len(received) == 0 || received[len(received)-1].Type != "interrupted" {
		t.Fatalf("missing final interruption: %#v", received)
	}
	runtime, err := loadRuntimeState(testSessionID)
	if err != nil {
		t.Fatal(err)
	}
	turn := runtime.ActiveTurn
	if turn == nil || turn.State != "interrupted" || len(turn.Delta) != 1 || len(turn.Delta[0].ToolCalls) != 1 {
		t.Fatalf("missing cancelled tool checkpoint: %#v", turn)
	}
	call := turn.Delta[0].ToolCalls[0]
	if call.State != "unknown" || !strings.Contains(strings.ToLower(call.Result), "unknown") {
		t.Fatalf("cancelled transmission lost tool outcome: %#v", call)
	}
}
