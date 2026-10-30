// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func waitMemoryOperation(t *testing.T, id string) apicontract.AIMemoryTaskData {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		status, err := GetAIMemoryTask(id)
		if err != nil {
			t.Fatal(err)
		}
		if status.State != "queued" && status.State != "running" {
			return status
		}
		time.Sleep(time.Millisecond)
	}
	_ = CancelAIMemory(id)
	t.Fatal("memory task did not finish")
	return apicontract.AIMemoryTaskData{}
}

func startMemoryOperation(t *testing.T, q apicontract.AIMemoryMaintainRequest, automatic bool) string {
	t.Helper()
	started, err := StartAIMemory(context.Background(), q, automatic)
	if err != nil {
		t.Fatal(err)
	}
	return started.TaskID
}

func TestAIMemoryOperationInMemoryReuse(t *testing.T) {
	for _, scenario := range []string{"completed", "overview-failure", "partial-failure"} {
		t.Run(scenario, func(t *testing.T) {
			setupAIMemoryTest(t)
			var keywords, proposals, overviews atomic.Int32
			memoryComplete = func(_ context.Context, _ *conf.AI, prompt string) (string, error) {
				if strings.Contains(prompt, `"terms"`) {
					keywords.Add(1)
					return `{"intent":"remember","terms":[]}`, nil
				}
				if strings.HasPrefix(prompt, "Generate a concise") {
					if overviews.Add(1) == 1 && scenario == "overview-failure" {
						return "", errors.New("temporary overview failure")
					}
					return "Concise answers", nil
				}
				proposals.Add(1)
				actions := `{"kind":"preference","subject":"user","scope":"workspace","content":"Use concise answers","state":"active","sourceIndexes":[0]}`
				if scenario == "partial-failure" {
					actions += `,{}`
				}
				return `{"actions":[` + actions + `]}`, nil
			}
			q := apicontract.AIMemoryMaintainRequest{Text: "Use concise answers", OperationID: "operation-memory-only"}
			id := startMemoryOperation(t, q, false)
			first := waitMemoryOperation(t, id)
			wantState := "completed"
			if scenario != "completed" {
				wantState = "failed"
			}
			if first.State != wantState || len(first.Results) == 0 || !first.Results[0].Saved {
				t.Fatalf("initial task: %+v", first)
			}
			entry, err := aiMemoryStore().Get(context.Background(), first.Results[0].ID)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = os.Stat(filepath.Join(util.DataDir, "storage/ai/memos/operations")); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("operation files were generated: %v", err)
			}
			if next := startMemoryOperation(t, q, false); next != id {
				t.Fatal("retry changed task identity")
			}
			second := waitMemoryOperation(t, id)
			if scenario == "partial-failure" {
				if second.State != "failed" || len(second.Results) != 2 || second.Results[1].Saved {
					t.Fatalf("invalid action was replaced or activated on retry: %+v", second)
				}
			} else if second.State != "completed" {
				t.Fatalf("task did not complete: %+v", second)
			}
			if keywords.Load() != 1 || proposals.Load() != 1 {
				t.Fatalf("prepared retry repeated paid extraction: keywords=%d proposals=%d", keywords.Load(), proposals.Load())
			}
			if scenario == "overview-failure" && overviews.Load() != 2 {
				t.Fatalf("overview not retried: %d", overviews.Load())
			}
			current, err := aiMemoryStore().Get(context.Background(), entry.Record.ID)
			if err != nil || current.Revision != entry.Revision || len(current.Record.Operations) != 1 {
				t.Fatalf("successful action rewritten on retry: %+v %v", current, err)
			}
			changed := q
			changed.Text = "Use detailed answers"
			if _, err = StartAIMemory(context.Background(), changed, false); err == nil {
				t.Fatal("same task identity accepted different input")
			}
			// A lost process cache means unavailable status, not a replay of the model.
			memoryTasks.Lock()
			delete(memoryTasks.tasks, util.DataDir+"\x00"+id)
			memoryTasks.Unlock()
			if _, err = GetAIMemoryTask(id); err == nil {
				t.Fatal("evicted task unexpectedly recovered")
			}
			if _, err = aiMemoryStore().Get(context.Background(), entry.Record.ID); err != nil {
				t.Fatalf("cache loss removed persisted memory: %v", err)
			}
		})
	}
}

func TestAIMemoryOperationExplicitRetryBeforeProposal(t *testing.T) {
	setupAIMemoryTest(t)
	var keywords atomic.Int32
	memoryComplete = func(_ context.Context, _ *conf.AI, prompt string) (string, error) {
		if strings.Contains(prompt, `"terms"`) {
			if keywords.Add(1) == 1 {
				return "", errors.New("temporary connection failure")
			}
			return `{"intent":"remember","terms":[]}`, nil
		}
		return `{"actions":[]}`, nil
	}
	q := apicontract.AIMemoryMaintainRequest{Text: "Use concise answers", OperationID: "retry-before-proposal"}
	id := startMemoryOperation(t, q, false)
	if first := waitMemoryOperation(t, id); first.State != "failed" {
		t.Fatalf("expected initial error: %+v", first)
	}
	startMemoryOperation(t, q, false)
	if second := waitMemoryOperation(t, id); second.State != "completed" || keywords.Load() != 2 {
		t.Fatalf("explicit retry stuck on the prior error: %+v calls=%d", second, keywords.Load())
	}
}

func TestAIMemoryOperationAutomaticSourceCoalescing(t *testing.T) {
	cfg, fixture, _ := setupMemoryDecisionTest(t)
	cfg.Decision.Enabled = false
	Conf.AI.Store(cfg)
	entered, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	var keywords, proposals atomic.Int32
	memoryComplete = func(ctx context.Context, _ *conf.AI, prompt string) (string, error) {
		if strings.Contains(prompt, `"terms"`) {
			keywords.Add(1)
			once.Do(func() { close(entered) })
			select {
			case <-release:
			case <-ctx.Done():
				return "", ctx.Err()
			}
			return `{"intent":"remember","terms":[]}`, nil
		}
		proposals.Add(1)
		return `{"actions":[]}`, nil
	}
	q := apicontract.AIMemoryMaintainRequest{SourceIDs: []string{fixture.sourceID}, OperationID: "automatic-one"}
	id := startMemoryOperation(t, q, true)
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
		waitMemoryOperation(t, id)
	}()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("first task did not enter the model")
	}
	q.OperationID = "automatic-two"
	if duplicate := startMemoryOperation(t, q, true); duplicate != id {
		t.Fatal("same source version launched a second running task")
	}
	close(release)
	if result := waitMemoryOperation(t, id); result.State != "completed" {
		t.Fatalf("automatic task: %+v", result)
	}
	if keywords.Load() != 1 || proposals.Load() != 1 {
		t.Fatalf("automatic coalescing repeated model: %d/%d", keywords.Load(), proposals.Load())
	}
}

func TestAIMemoryOperationCancelledExplicitRetry(t *testing.T) {
	setupAIMemoryTest(t)
	entered := make(chan struct{})
	var keywords atomic.Int32
	memoryComplete = func(ctx context.Context, _ *conf.AI, prompt string) (string, error) {
		if strings.Contains(prompt, `"terms"`) {
			if keywords.Add(1) == 1 {
				close(entered)
				<-ctx.Done()
				return "", ctx.Err()
			}
			return `{"intent":"remember","terms":[]}`, nil
		}
		return `{"actions":[]}`, nil
	}
	q := apicontract.AIMemoryMaintainRequest{Text: "Use concise answers", OperationID: "cancelled-explicit-retry"}
	id := startMemoryOperation(t, q, false)
	defer func() {
		_ = CancelAIMemory(id)
		waitMemoryOperation(t, id)
	}()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("task did not enter keywords")
	}
	if err := CancelAIMemory(id); err != nil {
		t.Fatal(err)
	}
	if result := waitMemoryOperation(t, id); result.State != "cancelled" {
		t.Fatalf("cancelled task: %+v", result)
	}
	// Reading the cancelled status must not restart model processing.
	for i := 0; i < 3; i++ {
		if result, err := GetAIMemoryTask(id); err != nil || result.State != "cancelled" {
			t.Fatalf("cancelled status changed: %+v %v", result, err)
		}
	}
	if keywords.Load() != 1 {
		t.Fatalf("model retried without explicit request: %d", keywords.Load())
	}
	if next := startMemoryOperation(t, q, false); next != id {
		t.Fatal("explicit retry changed task identity")
	}
	if result := waitMemoryOperation(t, id); result.State != "completed" || keywords.Load() != 2 {
		t.Fatalf("cancelled task retry: %+v calls=%d", result, keywords.Load())
	}
}

func TestAIMemoryOperationCachePrunesOnlyTerminalTasks(t *testing.T) {
	memoryTasks.Lock()
	defer memoryTasks.Unlock()
	previous := memoryTasks.tasks
	defer func() { memoryTasks.tasks = previous }()
	memoryTasks.tasks = make(map[string]*memoryTask)
	base := time.Unix(1, 0)
	// The active entries are older than every terminal entry.
	for i := 0; i < 100; i++ {
		state := "completed"
		if i == 0 {
			state = "running"
		}
		if i == 1 {
			state = "queued"
		}
		memoryTasks.tasks[fmt.Sprint(i)] = &memoryTask{
			created: base.Add(time.Duration(i) * time.Second),
			status:  apicontract.AIMemoryTaskData{State: state},
		}
	}
	pruneMemoryTasksLocked()
	if len(memoryTasks.tasks) != 99 || memoryTasks.tasks["2"] != nil {
		t.Fatal("did not evict oldest terminal task at cache capacity")
	}
	if memoryTasks.tasks["0"] == nil || memoryTasks.tasks["1"] == nil {
		t.Fatal("evicted active task")
	}
	for _, task := range memoryTasks.tasks {
		task.status.State = "running"
	}
	memoryTasks.tasks["new-active"] = &memoryTask{status: apicontract.AIMemoryTaskData{State: "queued"}}
	pruneMemoryTasksLocked()
	if len(memoryTasks.tasks) != 100 {
		t.Fatal("evicted active task when cache contains only active tasks")
	}
}

func TestAIMemoryOperationRetryDoesNotResurrectForgottenSuccess(t *testing.T) {
	setupAIMemoryTest(t)
	var proposals atomic.Int32
	memoryComplete = func(_ context.Context, _ *conf.AI, prompt string) (string, error) {
		if strings.Contains(prompt, `"terms"`) {
			return `{"intent":"remember","terms":[]}`, nil
		}
		if strings.HasPrefix(prompt, "Generate a concise") {
			return "Concise answers", nil
		}
		proposals.Add(1)
		return `{"actions":[{"kind":"preference","subject":"user","scope":"workspace","content":"Use concise answers","state":"active","sourceIndexes":[0]},{}]}`, nil
	}
	q := apicontract.AIMemoryMaintainRequest{Text: "Use concise answers", OperationID: "forget-before-retry"}
	id := startMemoryOperation(t, q, false)
	first := waitMemoryOperation(t, id)
	if first.State != "failed" || len(first.Results) != 2 || !first.Results[0].Saved {
		t.Fatalf("initial partial failure: %+v", first)
	}
	recordID := first.Results[0].ID
	entry, err := aiMemoryStore().Get(context.Background(), recordID)
	if err != nil {
		t.Fatal(err)
	}
	forgotten, err := ForgetAIMemory(context.Background(), apicontract.AIMemoryForgetRequest{
		ID: recordID, Revision: entry.Revision, OperationID: "forget-success",
	})
	if err != nil || !forgotten.Saved {
		t.Fatalf("forget: %+v %v", forgotten, err)
	}
	startMemoryOperation(t, q, false)
	if result := waitMemoryOperation(t, id); result.State != "failed" {
		t.Fatalf("invalid prepared action unexpectedly succeeded: %+v", result)
	}
	if proposals.Load() != 1 {
		t.Fatal("retry regenerated the proposal")
	}
	if _, err := aiMemoryStore().Get(context.Background(), recordID); err == nil {
		t.Fatal("retry resurrected forgotten successful action")
	}
}
