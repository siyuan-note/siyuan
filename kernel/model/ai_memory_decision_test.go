// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/memo"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func memoryDecisionAnswer(choice string, probability float64) *util.DecisionResult {
	confidence := probability
	return &util.DecisionResult{Answers: map[string]util.DecisionAnswer{"memory": {Type: "choice", Choice: &choice, Confidence: &confidence, Probabilities: map[string]*float64{"skip": &probability}}}}
}

func setupMemoryDecisionTest(t *testing.T) (*conf.AI, *fileOperationTestFixture, []memo.Source) {
	cfg := setupAIMemoryTest(t)
	fixture := setupFileOperationTest(t)
	cfg.Decision = &conf.Decision{Enabled: true, Provider: "typesafe", Profiles: map[string]*conf.DecisionProfile{"typesafe": {Endpoint: "https://unused.invalid/decision", APIKey: "test-only", Name: "test", Timeout: 30}}}
	Conf.AI.Store(cfg)
	previous := memoryEvaluateDecision
	t.Cleanup(func() { memoryEvaluateDecision = previous })
	source, err := memorySource(context.Background(), fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	return cfg, fixture, []memo.Source{source}
}

func TestAIMemoryDecisionPipeline(t *testing.T) {
	for _, scenario := range []string{"skip", "process", "unknown", "error", "malformed", "low-confidence", "missing-probability", "missing-confidence", "disabled", "unconfigured", "manual", "text", "conversation", "bound", "bound-child", "late-binding", "cancel", "config", "permission", "source"} {
		t.Run(scenario, func(t *testing.T) {
			cfg, fixture, sources := setupMemoryDecisionTest(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			task := &memoryTask{cancel: cancel}
			q := apicontract.AIMemoryMaintainRequest{SourceIDs: []string{fixture.sourceID}, OperationID: "decision-test"}
			automatic, decisionCalls, memoryCalls := true, 0, 0
			bind := func(id string) {
				_, err := aiMemoryStore().Save(context.Background(), memo.Record{Kind: "fact", Subject: "project", Scope: "workspace", State: "review", Content: "existing fact", Sources: []memo.Source{{Kind: "block", ID: id, Revision: "old"}}}, "missing", "binding")
				if err != nil {
					t.Fatal(err)
				}
			}
			switch scenario {
			case "disabled":
				cfg.Decision.Enabled = false
			case "unconfigured":
				cfg.Decision.Profiles = nil
			case "manual":
				automatic = false
			case "text":
				q.Text = "以后请按这个偏好处理，不要沿用之前的约定"
			case "bound":
				bind(fixture.sourceID)
			case "bound-child":
				bind(fixture.childID)
			case "conversation":
				previous := AIMemoryConversationReader
				t.Cleanup(func() { AIMemoryConversationReader = previous })
				AIMemoryConversationReader = func(context.Context, string, string) (string, error) {
					return "Do not forget my changed preference", nil
				}
				source, err := memorySource(ctx, "conversation:session:entry")
				if err != nil {
					t.Fatal(err)
				}
				sources = []memo.Source{source}
			}
			memoryEvaluateDecision = func(callCtx context.Context, _ util.DecisionOptions, state util.DecisionState, questions map[string]util.DecisionQuestion) (*util.DecisionResult, error) {
				decisionCalls++
				if deadline, ok := callCtx.Deadline(); !ok || time.Until(deadline) > memoryDecisionTimeout {
					t.Fatal("decision lacks short deadline")
				}
				if !strings.Contains(string(state.Data), sources[0].ID) || len(questions) != 1 {
					t.Fatal("missing complete source or question")
				}
				switch scenario {
				case "process", "unknown":
					return memoryDecisionAnswer(scenario, 1), nil
				case "error":
					return nil, errors.New("mock unavailable")
				case "malformed":
					return &util.DecisionResult{}, nil
				case "low-confidence":
					return memoryDecisionAnswer("skip", 0.8), nil
				case "missing-probability":
					result := memoryDecisionAnswer("skip", 1)
					result.Answers["memory"].Probabilities["skip"] = nil
					return result, nil
				case "missing-confidence":
					result := memoryDecisionAnswer("skip", 1)
					answer := result.Answers["memory"]
					answer.Confidence = nil
					result.Answers["memory"] = answer
					return result, nil
				case "cancel":
					cancel()
				case "config":
					Conf.AI.Store(conf.NewAI())
				case "permission":
					util.ReadOnly = true
				case "source":
					sources[0].Revision = "changed"
				case "late-binding":
					bind(fixture.sourceID)
				}
				return memoryDecisionAnswer("skip", 1), nil
			}
			memoryComplete = func(context.Context, *conf.AI, string) (string, error) {
				memoryCalls++
				return "", errors.New("original pipeline reached")
			}
			runAIMemory(ctx, cfg, q, sources, automatic, task)
			bypass := scenario == "disabled" || scenario == "unconfigured" || scenario == "manual" || scenario == "text" || scenario == "conversation" || scenario == "bound" || scenario == "bound-child"
			if (decisionCalls == 0) != bypass {
				t.Fatalf("decision calls = %d", decisionCalls)
			}
			abort := scenario == "cancel" || scenario == "config" || scenario == "permission" || scenario == "source"
			if scenario == "skip" || abort {
				if memoryCalls != 0 {
					t.Fatalf("unsafe memory calls: %d", memoryCalls)
				}
			} else if memoryCalls != 1 {
				t.Fatalf("fallback calls = %d", memoryCalls)
			}
			if scenario == "skip" && (task.status.State != "completed" || len(task.status.Results) != 0 || task.status.OverviewPending) {
				t.Fatalf("skip claimed writes/refresh: %+v", task.status)
			}
			if abort && task.status.State != "failed" && task.status.State != "cancelled" {
				t.Fatalf("unsafe task succeeded: %+v", task.status)
			}
		})
	}
}

func TestAIMemoryDecisionMultilingualEvidenceAndCooldown(t *testing.T) {
	cfg, _, sources := setupMemoryDecisionTest(t)
	sources[0].Evidence = `{"text":"以后请按这个偏好处理；今後はこの条件でお願いします。Recuérdalo para la próxima vez. Keep this condition, not the old one."}`
	calls := 0
	memoryEvaluateDecision = func(_ context.Context, _ util.DecisionOptions, state util.DecisionState, _ map[string]util.DecisionQuestion) (*util.DecisionResult, error) {
		calls++
		var received []memo.Source
		if err := json.Unmarshal(state.Data, &received); err != nil || len(received) != 1 || received[0] != sources[0] {
			t.Fatal("multilingual evidence was altered", err)
		}
		return nil, errors.New("mock unavailable")
	}
	for i := 0; i < 5; i++ {
		skip, err := skipAIMemoryDecision(context.Background(), cfg, apicontract.AIMemoryMaintainRequest{}, sources, true, util.DataDir, func() error { return nil })
		if skip || err != nil {
			t.Fatal("failure/cooldown must preserve original pipeline", err)
		}
	}
	if calls != 3 {
		t.Fatalf("cooldown did not suppress requests: %d", calls)
	}
	cfg.Decision.Profiles["typesafe"].Name = "new-test-model"
	memoryEvaluateDecision = func(_ context.Context, _ util.DecisionOptions, state util.DecisionState, _ map[string]util.DecisionQuestion) (*util.DecisionResult, error) {
		calls++
		var received []memo.Source
		if err := json.Unmarshal(state.Data, &received); err != nil || received[0].Evidence != sources[0].Evidence {
			t.Fatal("changed multilingual evidence", err)
		}
		return memoryDecisionAnswer("process", 1), nil
	}
	skip, err := skipAIMemoryDecision(context.Background(), cfg, apicontract.AIMemoryMaintainRequest{}, sources, true, util.DataDir, func() error { return nil })
	if skip || err != nil || calls != 4 {
		t.Fatal("configuration change did not restore decisions", err, calls)
	}
}

func TestAIMemoryDecisionIncompleteBindingScan(t *testing.T) {
	cfg, _, sources := setupMemoryDecisionTest(t)
	dir := filepath.Join(util.DataDir, "storage", "ai", "memos", "records")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "20261029000000-abcdefg.md"), []byte("invalid record"), 0600); err != nil {
		t.Fatal(err)
	}
	memoryEvaluateDecision = func(context.Context, util.DecisionOptions, util.DecisionState, map[string]util.DecisionQuestion) (*util.DecisionResult, error) {
		t.Fatal("incomplete scan reached decision")
		return nil, nil
	}
	skip, err := skipAIMemoryDecision(context.Background(), cfg, apicontract.AIMemoryMaintainRequest{}, sources, true, util.DataDir, func() error { return nil })
	if skip || err != nil {
		t.Fatal("incomplete scan must preserve pipeline", skip, err)
	}
}

func TestAIMemoryDecisionTimeoutFallsBack(t *testing.T) {
	cfg, fixture, sources := setupMemoryDecisionTest(t)
	decisionCalls := 0
	memoryEvaluateDecision = func(ctx context.Context, _ util.DecisionOptions, _ util.DecisionState, _ map[string]util.DecisionQuestion) (*util.DecisionResult, error) {
		decisionCalls++
		<-ctx.Done()
		return nil, ctx.Err()
	}
	ctx := context.Background()
	skip, err := skipAIMemoryDecision(ctx, cfg, apicontract.AIMemoryMaintainRequest{SourceIDs: []string{fixture.sourceID}}, sources, true, util.DataDir, func() error { return ctx.Err() })
	if skip || err != nil || decisionCalls != 1 {
		t.Fatalf("timeout did not fail open: %v %v %d", skip, err, decisionCalls)
	}
}

func TestAIMemoryDecisionProcessCompletesOriginalPipeline(t *testing.T) {
	cfg, fixture, sources := setupMemoryDecisionTest(t)
	memoryEvaluateDecision = func(context.Context, util.DecisionOptions, util.DecisionState, map[string]util.DecisionQuestion) (*util.DecisionResult, error) {
		return memoryDecisionAnswer("process", 1), nil
	}
	keywords, proposals, overviews := 0, 0, 0
	memoryComplete = func(_ context.Context, _ *conf.AI, prompt string) (string, error) {
		if strings.Contains(prompt, `"terms"`) {
			keywords++
			return `{"intent":"remember","terms":[]}`, nil
		}
		if strings.HasPrefix(prompt, "Generate a concise") {
			overviews++
			return "No verified memory", nil
		}
		proposals++
		return `{"actions":[]}`, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	task := &memoryTask{cancel: cancel}
	runAIMemory(ctx, cfg, apicontract.AIMemoryMaintainRequest{SourceIDs: []string{fixture.sourceID}, OperationID: "process"}, sources, true, task)
	if task.status.State != "completed" || task.status.OverviewPending || keywords != 1 || proposals != 1 {
		t.Fatalf("original pipeline did not complete: %+v keywords=%d proposals=%d overviews=%d", task.status, keywords, proposals, overviews)
	}
}

func TestAIMemoryDecisionCircuit(t *testing.T) {
	var b memoryDecisionBreaker
	now := time.Now()
	for i := 0; i < 3; i++ {
		epoch, allowed := b.begin("a", now)
		if !allowed {
			t.Fatal("early cooldown")
		}
		b.end(epoch, true, now)
	}
	oldEpoch, allowed := b.begin("a", now)
	if allowed {
		t.Fatal("missing cooldown")
	}
	if _, allowed = b.begin("a", now.Add(time.Minute)); !allowed {
		t.Fatal("cooldown did not expire")
	}
	epoch, allowed := b.begin("b", now)
	if !allowed {
		t.Fatal("new configuration inherited cooldown")
	}
	for i := 0; i < 3; i++ {
		b.end(oldEpoch, true, now)
	}
	if _, allowed = b.begin("b", now); !allowed {
		t.Fatal("stale completion poisoned new configuration")
	}
	b.end(epoch, true, now)
	b.end(epoch, false, now)
	b.end(epoch, true, now)
	b.end(epoch, true, now)
	if _, allowed = b.begin("b", now); !allowed {
		t.Fatal("success did not reset consecutive failures")
	}
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); e, _ := b.begin("b", now); b.end(e, true, now) }()
	}
	wg.Wait()
}

func TestAIMemoryDecisionSkipDoesNotGateRevalidation(t *testing.T) {
	cfg, _, sources := setupMemoryDecisionTest(t)
	memoryEvaluateDecision = func(context.Context, util.DecisionOptions, util.DecisionState, map[string]util.DecisionQuestion) (*util.DecisionResult, error) {
		return memoryDecisionAnswer("skip", 1), nil
	}
	skip, err := skipAIMemoryDecision(context.Background(), cfg, apicontract.AIMemoryMaintainRequest{}, sources, true, util.DataDir, func() error { return nil })
	if !skip || err != nil {
		t.Fatal("expected skip", err)
	}
	sources[0].Revision = "stale"
	entry, err := aiMemoryStore().Save(context.Background(), memo.Record{Kind: "fact", Subject: "project", Scope: "workspace", State: "active", Content: "old fact", Sources: sources}, "missing", "stale")
	if err != nil {
		t.Fatal(err)
	}
	if err = RevalidateAIMemorySources(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	entry, err = aiMemoryStore().Get(context.Background(), entry.Record.ID)
	if err != nil || entry.Record.State != "review" {
		t.Fatalf("skip suppressed revalidation: %+v %v", entry, err)
	}
}
