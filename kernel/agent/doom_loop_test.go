// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	kernelModel "github.com/siyuan-note/siyuan/kernel/model"
)

func doomNative(name string) *capabilityRegistration {
	return &capabilityRegistration{ID: "native/kernel/" + name, Source: "native", Runtime: "kernel", Tool: &tools.Tool{Name: name}}
}

func TestDoomSignatureCompleteCanonicalArguments(t *testing.T) {
	for _, query := range []string{strings.Repeat("中", 30), strings.Repeat("😀", 30), strings.Repeat("a", 63) + "中"} {
		if buildDoomSignature("search", "fulltext", map[string]any{"query": query}) ==
			buildDoomSignature("search", "fulltext", map[string]any{"query": query + "文"}) {
			t.Fatal("Unicode query suffix was lost")
		}
	}
	base := map[string]any{"url": strings.Repeat("a", 100) + "one", "headers": map[string]any{"Authorization": "secret", "X": "a"}, "body": "one", "page": 1}
	sig := buildDoomSignature("http", "get", base)
	if len(sig) != 64 || strings.Contains(sig, "secret") {
		t.Fatalf("signature must be a digest: %q", sig)
	}
	reordered := map[string]any{"page": 1, "body": "one", "headers": map[string]any{"X": "a", "Authorization": "secret"}, "url": base["url"]}
	if sig != buildDoomSignature("http", "get", reordered) {
		t.Fatal("JSON key order changed identity")
	}
	for key, value := range map[string]any{"url": strings.Repeat("a", 100) + "two", "headers": map[string]any{"Authorization": "other", "X": "a"}, "body": "two", "page": 2} {
		changed := map[string]any{}
		for k, v := range base {
			changed[k] = v
		}
		changed[key] = value
		if sig == buildDoomSignature("http", "get", changed) {
			t.Errorf("lost full %s", key)
		}
	}
	if sig == buildDoomSignature("other-owner", "get", base) || sig == buildDoomSignature("http", "post", base) {
		t.Fatal("lost capability or action identity")
	}
	if buildDoomSignature("read", "", map[string]any{"ids": []string{"a", "b"}}) == buildDoomSignature("read", "", map[string]any{"ids": []string{"b", "a"}}) {
		t.Fatal("array order lost")
	}
}

func TestDoomLoopRepeatedResults(t *testing.T) {
	for _, failed := range []bool{false, true} {
		for _, alternating := range []bool{false, true} {
			t.Run(fmt.Sprintf("error=%v/alternating=%v", failed, alternating), func(t *testing.T) {
				var tracker doomLoopTracker
				for i := 1; i <= 5; i++ {
					warn, stop := tracker.record(doomNative("http_request"), "http_request", "get", map[string]any{"url": "A"}, "HTTP response", failed)
					if warn != (i == 3) || stop != (i == 5) {
						t.Fatalf("count %d: warn=%v stop=%v", i, warn, stop)
					}
					if alternating && i < 5 {
						tracker.record(doomNative("http_request"), "http_request", "get", map[string]any{"url": "B"}, "HTTP response", failed)
					}
				}
			})
		}
	}
}

func TestDoomLoopWindowAndChangedResult(t *testing.T) {
	var tracker doomLoopTracker
	read := func(target, result string, isError bool) {
		tracker.record(doomNative("file"), "file", "read", map[string]any{"path": target}, result, isError)
	}
	for range 4 {
		read("A", "old", false)
	}
	read("A", "new", false)
	if tracker.count != 1 {
		t.Fatal("changed result did not reset target")
	}
	read("A", "old", false)
	if tracker.count != 1 {
		t.Fatal("obsolete result returned into observation period")
	}
	read("A", "old", true)
	if tracker.count != 1 {
		t.Fatal("error flag did not reset target")
	}
	for i := range 10 {
		read(fmt.Sprint(i), "other", false)
	}
	read("A", "old", true)
	if tracker.count != 1 || len(tracker.observations) != 10 {
		t.Fatal("window did not expire")
	}
	for i := range 10 {
		read("changing", fmt.Sprint(i), false)
	}
	read("A", "old", true)
	if tracker.count != 1 {
		t.Fatal("changed results extended other targets beyond the window")
	}
}

func TestDoomLoopEmptyResults(t *testing.T) {
	var tracker doomLoopTracker
	for i := 1; i <= 5; i++ {
		warn, stop := tracker.record(nil, "unknown", "", nil, " \n", false)
		if warn != (i == 3) || stop != (i == 5) {
			t.Fatalf("empty result %d: warn=%v stop=%v", i, warn, stop)
		}
	}
}

func TestDoomLoopSuccessBoundaries(t *testing.T) {
	for _, tc := range []struct {
		registration         *capabilityRegistration
		name, action, result string
	}{
		{doomNative("file"), "file", "write", "saved"},
		{doomNative("question"), "question", "", "answer"},
		{doomNative("todo_write"), "todo_write", "", "saved"},
		{&capabilityRegistration{ID: "plugin/read", Source: "plugin", Runtime: "kernel", Tool: &tools.Tool{Name: "file"}}, "file", "read", "same"},
		{&capabilityRegistration{ID: "native/browser/read", Source: "native", Runtime: "browser", Tool: &tools.Tool{Name: "file"}}, "file", "read", "same"},
		{doomNative("http_request"), "http_request", "get", "HTTP 200 image/png\n\nSaved to: path (10 bytes)"},
		{doomNative("web_fetch"), "web_fetch", "", "Saved to: path (10 bytes)"},
		{doomNative("http_request"), "http_request", "post", "HTTP 200\n\nok"},
		{nil, "unknown", "read", "same"},
	} {
		t.Run(tc.name+tc.action+tc.result, func(t *testing.T) {
			var tracker doomLoopTracker
			for range 4 {
				tracker.record(doomNative("file"), "file", "read", nil, "same", false)
			}
			tracker.record(tc.registration, tc.name, tc.action, nil, tc.result, false)
			if len(tracker.observations) != 0 {
				t.Fatal("successful noncandidate did not reset")
			}
			warn, stop := tracker.record(doomNative("file"), "file", "read", nil, "same", false)
			if warn || stop || tracker.count != 1 {
				t.Fatal("read-after-write reused old observation")
			}
		})
	}
}

func TestAgentChatDoomLoopBatchStop(t *testing.T) {
	for _, failed := range []bool{false, true} {
		for _, split := range []bool{false, true} {
			t.Run(fmt.Sprintf("error=%v/split=%v", failed, split), func(t *testing.T) {
				setupToolRoundLimitAgentTest(t, 0)
				original, _ := tools.LookupToolWithValidator("file")
				var reads, writes, requests atomic.Int32
				tools.SetTool("file", &tools.Tool{Name: "file", Source: "native", InputSchema: tools.ToolSchema{Type: "object", Properties: map[string]tools.Property{"action": {Type: "string"}}}, ActionEffects: map[string]tools.ToolEffects{"read": {LocalRead: true}, "write": {LocalWrite: true}}, Handler: func(args map[string]any) (tools.CallToolResult, error) {
					if args["action"] == "write" {
						writes.Add(1)
					} else {
						reads.Add(1)
					}
					return tools.CallToolResult{Content: []tools.ContentItem{{Type: "text", Text: "unchanged response"}}, IsError: failed}, nil
				}})
				t.Cleanup(func() {
					if original != nil {
						tools.SetTool("file", original)
					} else {
						tools.RemoveTool("file")
					}
				})
				var followup atomic.Bool
				var followupCalls atomic.Int32
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					var payload map[string]any
					if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
						t.Error(err)
						return
					}
					n := requests.Add(1)
					flusher := prepareTestStream(t, w)
					if followup.Load() {
						if followupCalls.Add(1) == 1 {
							fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"followup-read\",\"type\":\"function\",\"function\":{\"name\":\"file\",\"arguments\":\"{\\\"action\\\":\\\"read\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n")
							flusher.Flush()
							writeTestStreamDone(t, w, flusher)
							return
						}
						writeTestStreamChunk(t, w, flusher, "Continued normally.")
						writeTestStreamDone(t, w, flusher)
						return
					}
					if n > 2 || (!split && n > 1) {
						t.Error("model requested after stop")
						writeTestStreamDone(t, w, flusher)
						return
					}
					if split && n == 2 {
						encoded, _ := json.Marshal(payload)
						if !strings.Contains(string(encoded), "Please try a different approach") {
							t.Error("batch crossed warning threshold without warning")
						}
					}
					count := 8
					if split {
						count = 4
					}
					calls := []any{}
					for i := 0; i < count; i++ {
						action := "read"
						if (!split && i >= 6) || (split && n == 2 && i >= 2) {
							action = "write"
						}
						calls = append(calls, map[string]any{"index": i, "id": fmt.Sprintf("call-%d-%d", n, i), "type": "function", "function": map[string]any{"name": "file", "arguments": fmt.Sprintf(`{"action":%q}`, action)}})
					}
					chunk, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"index": 0, "delta": map[string]any{"tool_calls": calls}, "finish_reason": "tool_calls"}}})
					fmt.Fprintf(w, "data: %s\n\n", chunk)
					flusher.Flush()
					writeTestStreamDone(t, w, flusher)
				}))
				defer server.Close()
				var content strings.Builder
				var visibleRound string
				usage, resultCount := false, 0
				for event := range AgentChat(context.Background(), newTestOpenAIClient(server.URL), "openai", "test-model", "", 0, testSessionID, "user-1", 1, "read", nil, "English", nil, EditorContext{}, nil, false, time.Second, 0, "", time.Second, time.Second) {
					switch event.Type {
					case "thinking":
						visibleRound = event.RoundID
					case "content":
						if !strings.HasSuffix(visibleRound, "_stop") {
							t.Error("stop content reused the tool assistant round")
						}
						content.WriteString(event.Token)
					case "usage":
						usage = true
					case "tool_result":
						resultCount++
					case "error":
						if event.Error != kernelModel.Conf.Language(471) {
							t.Errorf("unexpected error: %s", event.Error)
						}
					}
				}
				if reads.Load() != 5 || writes.Load() != 0 || !usage || resultCount != 8 || content.String() != kernelModel.Conf.Language(471) {
					t.Fatalf("reads=%d writes=%d usage=%v results=%d content=%q", reads.Load(), writes.Load(), usage, resultCount, content.String())
				}
				runtime, err := loadRuntimeState(testSessionID)
				if err != nil {
					t.Fatal(err)
				}
				turn := runtime.ActiveTurn
				if turn == nil || turn.State != "interrupted" {
					t.Fatalf("turn=%#v", turn)
				}
				finished, skipped := 0, 0
				for _, message := range turn.Delta {
					for _, call := range message.ToolCalls {
						if call.Result == "" {
							t.Fatal("declared call missing result")
						}
						switch call.State {
						case "finished":
							finished++
						case "skipped":
							skipped++
							if !strings.HasPrefix(call.Result, "Not executed:") {
								t.Errorf("skipped result obscures execution state: %q", call.Result)
							}
						default:
							t.Errorf("dangling call: %#v", call)
						}
					}
				}
				last := turn.Delta[len(turn.Delta)-1]
				if finished != 5 || skipped != 3 || last.Content != content.String() || last.RoundID != visibleRound || last.RoundID == turn.Delta[0].RoundID {
					t.Fatalf("invalid durable stop: %#v", turn.Delta)
				}
				recovered, err := GetSession(testSessionID)
				if err != nil {
					t.Fatal(err)
				}
				recovered["expectedRevision"], recovered["commitTurnID"] = int64(1), turn.TurnID
				if _, _, err = SaveSessionState(marshalSession(t, recovered)); err != nil {
					t.Fatal(err)
				}
				recovered, err = GetSession(testSessionID)
				if err != nil {
					t.Fatal(err)
				}
				recovered["entries"] = append(recovered["entries"].([]any), map[string]any{"id": "user-2", "type": "user", "content": "continue"})
				recovered["expectedRevision"] = int64(2)
				if _, _, err = SaveSessionState(marshalSession(t, recovered)); err != nil {
					t.Fatal(err)
				}
				followup.Store(true)
				done := false
				for event := range AgentChat(context.Background(), newTestOpenAIClient(server.URL), "openai", "test-model", "", 0, testSessionID, "user-2", 3, "continue", nil, "English", nil, EditorContext{}, nil, false, time.Second, 0, "", time.Second, time.Second) {
					if event.Type == "error" {
						t.Errorf("followup: %s", event.Error)
					}
					if event.Type == "done" {
						done = true
					}
				}
				if !done || writes.Load() != 0 || reads.Load() != 6 || followupCalls.Load() != 2 {
					t.Fatal("followup replayed work or did not complete")
				}
			})
		}
	}
}
