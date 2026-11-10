// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package agent

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/mcp/tools"
	kernelModel "github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestAgentSnapshotPreflightKeepsReadsAndRejectsWritesBeforeConfirmation(t *testing.T) {
	setupToolRoundLimitAgentTest(t, 0)
	const name = "test_snapshot_preflight"
	const prerequisite = "Initialize the local data repository key first"
	util.Langs["en"][26] = prerequisite
	kernelModel.Conf.Lang = "en"
	var reads, writes, requests atomic.Int32
	tools.SetTool(name, &tools.Tool{
		Name: name, Source: "native",
		InputSchema:   tools.ToolSchema{Type: "object", Properties: map[string]tools.Property{"action": {Type: "string"}}},
		ActionEffects: map[string]tools.ToolEffects{"read": {LocalRead: true}, "write": {LocalWrite: true}},
		Handler: func(arguments map[string]any) (tools.CallToolResult, error) {
			if arguments["action"] == "write" {
				writes.Add(1)
			} else {
				reads.Add(1)
			}
			return tools.CallToolResult{Content: []tools.ContentItem{{Type: "text", Text: "read completed"}}}, nil
		},
	})
	t.Cleanup(func() { tools.RemoveTool(name) })
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempt := requests.Add(1)
		flusher := prepareTestStream(t, w)
		if attempt <= 2 {
			action := "write"
			if attempt == 2 {
				action = "read"
			}
			_, _ = fmt.Fprintf(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-%d\",\"type\":\"function\",\"function\":{\"name\":%q,\"arguments\":%q}}]},\"finish_reason\":\"tool_calls\"}]}\n\n", attempt, name, `{"action":"`+action+`"}`)
			flusher.Flush()
		} else {
			writeTestStreamChunk(t, w, flusher, "Please initialize the key; reading succeeded")
		}
		writeTestStreamDone(t, w, flusher)
	}))
	defer server.Close()
	prerequisiteSeen, done := false, false
	for event := range AgentChat(context.Background(), util.NewAIClientWithModel("key", server.URL+"/v1", "test-model"), "openai", "test-model", "", 0,
		testSessionID, "user-1", 1, "read and edit", nil, "English", nil, EditorContext{}, nil, false,
		time.Second, 0, "", time.Second, time.Second) {
		if event.Type == "confirm" || event.Type == "snapshot" || event.Type == "error" {
			t.Errorf("unexpected event: %+v", event)
		}
		if event.Type == "tool_result" && strings.Contains(event.Result, prerequisite) {
			prerequisiteSeen = true
		}
		if event.Type == "done" {
			done = true
		}
	}
	if !prerequisiteSeen || !done || writes.Load() != 0 || reads.Load() != 1 || requests.Load() != 3 {
		t.Fatalf("preflight failed: prerequisite=%v done=%v writes=%d reads=%d requests=%d", prerequisiteSeen, done, writes.Load(), reads.Load(), requests.Load())
	}
	registration := &capabilityRegistration{ModelName: name, Tool: tools.GetTool(name)}
	repo := conf.NewRepo()
	repo.Key = []byte("initialized")
	kernelModel.Conf.Repo.Store(repo)
	if err := preflightCapabilitySnapshot(registration, "write"); err != nil {
		t.Fatal(err)
	}
}
