// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package agent

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/sashabaranov/go-openai"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAgentChatLogsUnexposedToolNamesOncePerRound(t *testing.T) {
	setupCompactionAgentTest(t)
	logPath := filepath.Join(t.TempDir(), "tool-dispatch.log")
	originalLogPath := logging.LogPath
	logging.SetLogPath(logPath)
	t.Cleanup(func() { logging.SetLogPath(originalLogPath) })

	const model = "test-model"
	const protocol = util.OpenAIProtocolChatCompletions
	const prompt = "private conversation marker"
	const arguments = `{"action":"get","data":"private tool argument marker"}`
	const token = "private-header-marker"
	if _, _, err := SaveSessionState(marshalSession(t, map[string]any{
		"id": testSessionID, "title": "Tool dispatch diagnostic",
		"entries": []any{map[string]any{"id": "user-1", "type": "user", "content": prompt}},
	})); err != nil {
		t.Fatal(err)
	}

	returnedNames := [][]string{{"system"}, {"block.get", "document.read", "system"}, {"block.get"}}
	requestTools := make(chan []string, len(returnedNames))
	var requestCount atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req openai.ChatCompletionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Error(err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		round := int(requestCount.Add(1)) - 1
		if round > len(returnedNames) {
			t.Error("unexpected model request")
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if got := r.Header.Get("Authorization"); !strings.Contains(got, token) {
			t.Error("private header fixture was not sent")
		}
		if round == 0 && !slices.ContainsFunc(req.Messages, func(message openai.ChatCompletionMessage) bool {
			return message.Content == prompt
		}) {
			t.Error("private message fixture was not sent")
		}
		flusher := prepareTestStream(t, w)
		if round == len(returnedNames) {
			writeTestStreamChunk(t, w, flusher, "Finished.")
			writeTestStreamDone(t, w, flusher)
			return
		}
		names := make([]string, 0, len(req.Tools))
		for _, tool := range req.Tools {
			if tool.Function != nil {
				names = append(names, tool.Function.Name)
			}
		}
		if !slices.Contains(names, "block") || !slices.Contains(names, "system") || slices.Contains(names, "block.get") {
			t.Errorf("unexpected exposed tools: %v", names)
		}
		requestTools <- names

		calls := make([]openai.ToolCall, 0, len(returnedNames[round]))
		for index, name := range returnedNames[round] {
			args := arguments
			if name == "system" {
				args = `{"action":"version"}`
			}
			calls = append(calls, openai.ToolCall{
				Index: new(index), ID: fmt.Sprintf("call-%d-%d", round, index), Type: openai.ToolTypeFunction,
				Function: openai.FunctionCall{Name: name, Arguments: args},
			})
		}
		chunk := openai.ChatCompletionStreamResponse{Choices: []openai.ChatCompletionStreamChoice{
			{Delta: openai.ChatCompletionStreamChoiceDelta{ToolCalls: calls}, FinishReason: openai.FinishReasonToolCalls},
		}}
		if _, err := fmt.Fprintf(w, "data: %s\n\n", marshalSession(t, chunk)); err != nil {
			t.Error(err)
		}
		flusher.Flush()
		writeTestStreamDone(t, w, flusher)
	}))
	defer server.Close()

	var modelRoundIDs []string
	var done bool
	for event := range AgentChat(t.Context(), util.NewAIClientWithModel(token, server.URL+"/v1", model),
		protocol, model, "", 0, testSessionID, "user-1", 1, prompt, nil, "English", nil,
		EditorContext{}, nil, false, 5*time.Second, 0, "", 5*time.Second, 5*time.Second) {
		switch event.Type {
		case "tool_result":
			if len(modelRoundIDs) == 0 || modelRoundIDs[len(modelRoundIDs)-1] != event.RoundID {
				modelRoundIDs = append(modelRoundIDs, event.RoundID)
			}
			if event.Name == "system" {
				if !strings.Contains(event.Result, util.Ver) {
					t.Errorf("registered tool result: %s", event.Result)
				}
			} else if !strings.Contains(event.Result, "capability was not exposed in this model round") {
				t.Errorf("unregistered tool result: %s", event.Result)
			}
		case "done":
			done = true
		case "error":
			t.Errorf("agent error: %s", event.Error)
		}
	}
	if !done || len(modelRoundIDs) != len(returnedNames) || len(requestTools) != len(returnedNames) {
		t.Fatalf("agent did not complete all tool rounds: done=%t rounds=%v requests=%d", done, modelRoundIDs, requestCount.Load())
	}

	data, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	const diagnostic = "agent returned unexposed tool calls"
	var lines []string
	for line := range strings.SplitSeq(string(data), "\n") {
		if strings.Contains(line, diagnostic) {
			lines = append(lines, line)
		}
	}
	if len(lines) != 2 {
		t.Fatalf("expected one diagnostic per failed round: %v", lines)
	}
	<-requestTools
	for round := 1; round < len(returnedNames); round++ {
		expected := fmt.Sprintf("%s [roundID=%q, model=%q, protocol=%q, requestToolNames=%q, returnedToolNames=%q]",
			diagnostic, modelRoundIDs[round], model, protocol, <-requestTools, returnedNames[round])
		if !strings.HasSuffix(strings.TrimSpace(lines[round-1]), expected) {
			t.Errorf("unexpected diagnostic: %q; want suffix %q", lines[round-1], expected)
		}
	}
	for _, private := range []string{prompt, "private tool argument marker", token} {
		if strings.Contains(string(data), private) {
			t.Error("diagnostic log contains private fixture data")
		}
	}
}
