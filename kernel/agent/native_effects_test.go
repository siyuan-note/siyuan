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
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupLocalToolEffectsTest(t *testing.T) {
	t.Helper()
	previousConf, previousConfDir, previousRepoDir := model.Conf, util.ConfDir, util.RepoDir
	t.Cleanup(func() { model.Conf, util.ConfDir, util.RepoDir = previousConf, previousConfDir, previousRepoDir })
	model.Conf = model.NewAppConf()
	model.Conf.Sync.Store(conf.NewSync())
	model.Conf.Repo.Store(conf.NewRepo())
	util.ConfDir, util.RepoDir = t.TempDir(), t.TempDir()
}

func TestNativeToolConfirmationAndSnapshotsFollowDeclaredEffects(t *testing.T) {
	previous := model.Conf
	t.Cleanup(func() { model.Conf = previous })
	model.Conf = model.NewAppConf()
	for _, enabled := range []bool{false, true} {
		for _, provider := range []int{conf.ProviderSiYuan, conf.ProviderS3, conf.ProviderWebDAV, conf.ProviderLocal} {
			sync := conf.NewSync()
			sync.Provider = provider
			sync.Enabled = enabled
			model.Conf.Sync.Store(sync)
			for _, tool := range tools.GetAllTools() {
				if tool.Source != "native" {
					continue
				}
				actions := tool.InputSchema.Properties["action"].Enum
				if len(actions) == 0 {
					actions = []string{""}
				}
				for _, action := range actions {
					effects, declared := tool.EffectsFor(action)
					if !declared {
						t.Fatalf("missing effects for %s.%s", tool.Name, action)
					}
					wantConfirm := effects.LocalWrite || effects.DataEgress || effects.ExternalCost
					if got := needsConfirm(tool.Name, action, nil); got != wantConfirm {
						t.Errorf("%s.%s confirmation = %v, want %v", tool.Name, action, got, wantConfirm)
					}
					wantSnapshot := effects.LocalWrite && !(tool.Name == "repo" && action == "create")
					if got := needsLocalSnapshot(tool.Name, action); got != wantSnapshot {
						t.Errorf("%s.%s snapshot = %v, want %v", tool.Name, action, got, wantSnapshot)
					}
					registration := &capabilityRegistration{ID: tool.CapabilityID, ModelName: tool.Name, Source: "native", Tool: tool}
					cardEffects := effects
					if wantSnapshot {
						cardEffects = tools.EffectsWithSyncAssets(cardEffects)
					}
					if got := capabilityEffects(registration, action); got != cardEffects {
						t.Errorf("%s.%s confirmation card lost effects: %+v", tool.Name, action, got)
					}
				}
			}
		}
	}
}

func TestCapabilityEffectsRejectExpansion(t *testing.T) {
	previous := model.Conf
	t.Cleanup(func() { model.Conf = previous })
	model.Conf = model.NewAppConf()
	model.Conf.AI.Store(conf.NewAI())
	sync := conf.NewSync()
	sync.Provider = conf.ProviderLocal
	model.Conf.Sync.Store(sync)
	registration := &capabilityRegistration{ModelName: "sync", Tool: tools.SyncTool}
	approved := capabilityEffects(registration, "perform")
	sync.Provider = conf.ProviderS3
	if err := validateCapabilityEffects(registration, "perform", approved); err == nil {
		t.Fatal("local-to-remote sync reused a confirmation without external effects")
	}
	if err := validateCapabilityEffects(registration, "perform", capabilityEffects(registration, "perform")); err != nil {
		t.Fatal("unchanged sync effects rejected", err)
	}
	registration = &capabilityRegistration{ModelName: "web_fetch", Tool: tools.WebFetchTool}
	approved = capabilityEffects(registration, "")
	model.Conf.AI.Load().Web.FetchProvider = "deepseek"
	if err := validateCapabilityEffects(registration, "", approved); err == nil {
		t.Fatal("direct-to-paid fetch reused a confirmation without external cost")
	}
}

func TestConfirmationIncludesAutomaticSnapshotEffects(t *testing.T) {
	previous := model.Conf
	t.Cleanup(func() { model.Conf = previous })
	model.Conf = model.NewAppConf()
	sync := conf.NewSync()
	sync.Enabled = true
	model.Conf.Sync.Store(sync)
	block := &capabilityRegistration{ModelName: "block", Tool: tools.BlockTool}
	if effects := capabilityEffects(block, "update"); !effects.LocalWrite || !effects.DataEgress || !effects.ExternalCost {
		t.Fatalf("local write confirmation omitted snapshot download effects: %+v", effects)
	}
	if effects := capabilityEffects(block, "get"); effects.LocalWrite || effects.DataEgress || effects.ExternalCost {
		t.Fatalf("local read unnecessarily inherited snapshot effects: %+v", effects)
	}
	repo := &capabilityRegistration{ModelName: "repo", Tool: tools.RepoTool}
	if !needsConfirm("repo", "create", nil) || needsCapabilitySnapshot(repo, "create") {
		t.Fatal("snapshot creation must confirm without creating a redundant preflight snapshot")
	}
	if effects := capabilityEffects(repo, "create"); !effects.DataEgress || !effects.ExternalCost {
		t.Fatalf("snapshot creation omitted its own downloads: %+v", effects)
	}
}

func TestAgentRejectsEffectsExpandedDuringConfirmation(t *testing.T) {
	setupToolRoundLimitAgentTest(t, 0)
	const name = "test_changing_effects"
	var changed atomic.Bool
	var executions, requests atomic.Int32
	if err := tools.SetTool(name, &tools.Tool{
		Name: name, Source: "native", InputSchema: tools.ToolSchema{Type: "object"},
		ResolveEffects: func(string) (tools.ToolEffects, bool) {
			return tools.ToolEffects{DataEgress: true, LocalWrite: changed.Load(), ExternalCost: changed.Load()}, true
		},
		Handler: func(map[string]any) (tools.CallToolResult, error) {
			executions.Add(1)
			return tools.CallToolResult{}, nil
		},
	}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { tools.RemoveTool(name) })
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		flusher := prepareTestStream(t, w)
		if requests.Add(1) == 1 {
			_, _ = fmt.Fprintf(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"changed\",\"type\":\"function\",\"function\":{\"name\":%q,\"arguments\":\"{}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n", name)
			flusher.Flush()
		} else {
			writeTestStreamChunk(t, w, flusher, "Please review the current effects")
		}
		writeTestStreamDone(t, w, flusher)
	}))
	defer server.Close()
	confirmed, rejected := false, false
	for event := range AgentChat(context.Background(), util.NewAIClientWithModel("key", server.URL+"/v1", "test-model"), "openai", "test-model", "", 0,
		testSessionID, "user-1", 1, "run the tool", nil, "English", nil, EditorContext{}, nil, false,
		time.Second, 0, "", time.Second, time.Second) {
		if event.Type == "confirm" {
			confirmed = true
			if event.Effects.LocalWrite || event.Effects.ExternalCost {
				t.Fatal("initial confirmation used future effects")
			}
			changed.Store(true)
			if accepted, err := ConfirmSession(event.ConfirmID, true, false); err != nil || !accepted {
				t.Fatalf("approve initial call: accepted=%v, err=%v", accepted, err)
			}
		}
		if event.Type == "snapshot" {
			t.Fatal("expanded effects executed a snapshot before a fresh confirmation")
		}
		if event.Type == "tool_result" && strings.Contains(event.Result, "Tool effects changed") {
			rejected = true
		}
	}
	if !confirmed || !rejected || executions.Load() != 0 {
		t.Fatalf("confirmed=%v, rejected=%v, executions=%d", confirmed, rejected, executions.Load())
	}
}
