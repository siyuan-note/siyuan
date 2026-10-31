// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/memo"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func setupAIMemoryClearTest(t *testing.T) *conf.AI {
	cfg := setupAIMemoryTest(t)
	previous, persisted := util.ConfDir, lastPersistedConf()
	util.ConfDir = t.TempDir()
	t.Cleanup(func() { util.ConfDir = previous; recordPersistedConf(persisted) })
	return cfg
}

func TestAIMemoryClearPersistsDisableWithoutCallingModel(t *testing.T) {
	cfg := setupAIMemoryClearTest(t)
	ctx := context.Background()
	_, err := SaveAIMemory(ctx, apicontract.AIMemorySaveRequest{Revision: "missing", OperationID: "manual", Kind: "fact", Subject: "user", Scope: "workspace", State: "active", Content: "A confirmed fact"})
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	memoryComplete = func(context.Context, *conf.AI, string) (string, error) { calls++; return "", nil }
	ret, err := ClearAIMemory(ctx)
	if err != nil || !ret.Disabled || !ret.Cleared || calls != 0 {
		t.Fatalf("clear result %+v %v calls=%d", ret, err, calls)
	}
	current := Conf.LoadAI()
	if current.Memory.Enabled || current.Memory.ModelID != cfg.Memory.ModelID || !cfg.Memory.Enabled {
		t.Fatal("disable lost model settings or mutated old configuration snapshot")
	}
	data, err := os.ReadFile(filepath.Join(util.ConfDir, "conf.json"))
	if err != nil {
		t.Fatal(err)
	}
	var persisted struct {
		AI struct {
			Memory struct {
				Enabled bool
				ModelID string
			}
		}
	}
	if err = json.Unmarshal(data, &persisted); err != nil || persisted.AI.Memory.Enabled || persisted.AI.Memory.ModelID != cfg.Memory.ModelID {
		t.Fatalf("disabled setting not persisted: %v", err)
	}
	result, err := aiMemoryStore().Search(ctx, memo.SearchOptions{States: []string{"candidate", "active", "review", "disabled", "superseded"}})
	if err != nil || len(result.Entries) != 0 {
		t.Fatalf("clear left records: %+v %v", result, err)
	}
}

func TestAIMemoryClearStopsLateModelResults(t *testing.T) {
	cfg := setupAIMemoryClearTest(t)
	entered, release := make(chan struct{}), make(chan struct{})
	memoryComplete = func(_ context.Context, _ *conf.AI, prompt string) (string, error) {
		if strings.Contains(prompt, `"terms"`) {
			return `{"intent":"remember","terms":["coffee"]}`, nil
		}
		close(entered)
		<-release
		return `{"actions":[{"id":"","kind":"preference","subject":"user","scope":"workspace","content":"Coffee","state":"active","sourceIndexes":[0]}]}`, nil
	}
	ctx, cancel := context.WithCancel(context.Background())
	task := &memoryTask{cancel: cancel, dataDir: util.DataDir, epoch: memoryWriteEpoch.Load()}
	done := make(chan struct{})
	go func() {
		defer close(done)
		runAIMemory(ctx, cfg, apicontract.AIMemoryMaintainRequest{Text: "Coffee", OperationID: "late"}, []memo.Source{{Kind: "user", ID: "late", Revision: "one", Evidence: "Coffee"}}, false, task)
	}()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		close(release)
		t.Fatal("proposal did not start")
	}
	ret, err := ClearAIMemory(context.Background())
	// Re-enabling the same provider configuration must not authorize a pre-clear task.
	Conf.AI.Store(cfg)
	close(release)
	<-done
	if err != nil || !ret.Disabled || !ret.Cleared {
		t.Fatalf("clear %+v %v", ret, err)
	}
	result, err := aiMemoryStore().Search(context.Background(), memo.SearchOptions{States: []string{"active", "candidate"}})
	if err != nil || len(result.Entries) != 0 || task.status.State == "completed" {
		t.Fatalf("late proposal resurrected memory: %+v %+v %v", result, task.status, err)
	}
}

func TestAIMemoryClearFailureKeepsFeatureDisabled(t *testing.T) {
	setupAIMemoryClearTest(t)
	ctx := context.Background()
	_, err := aiMemoryStore().Save(ctx, memo.Record{Kind: "fact", Subject: "user", Scope: "workspace", State: "candidate", Content: "Candidate", Sources: []memo.Source{{Kind: "user", ID: "manual", Revision: "one"}}}, "missing", "manual")
	if err != nil {
		t.Fatal(err)
	}
	name := filepath.Join(util.DataDir, "storage/ai/memos/records", "20261031000000-abcdefg.md")
	if err = os.WriteFile(name, []byte("unknown format"), 0600); err != nil {
		t.Fatal(err)
	}
	ret, err := ClearAIMemory(ctx)
	if err != nil || !ret.Disabled || ret.Cleared || Conf.LoadAI().Memory.Enabled {
		t.Fatalf("failure falsely reported completion: %+v %v", ret, err)
	}
	if data, err := os.ReadFile(name); err != nil || string(data) != "unknown format" {
		t.Fatal("unsupported original was discarded")
	}
	if err = os.Remove(name); err != nil {
		t.Fatal(err)
	}
	ret, err = ClearAIMemory(ctx)
	if err != nil || !ret.Disabled || !ret.Cleared {
		t.Fatalf("explicit retry failed: %+v %v", ret, err)
	}
}

func TestAIMemoryClearRequiresPersistedDisable(t *testing.T) {
	for _, mode := range []string{"canceled", "persistence"} {
		t.Run(mode, func(t *testing.T) {
			setupAIMemoryClearTest(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			entry, err := aiMemoryStore().Save(ctx, memo.Record{Kind: "fact", Subject: "user", Scope: "workspace", State: "active", Content: "Preserve this", Sources: []memo.Source{{Kind: "user", ID: "manual", Revision: "one"}}}, "missing", "manual")
			if err != nil {
				t.Fatal(err)
			}
			if mode == "canceled" {
				cancel()
			} else if err = os.Mkdir(filepath.Join(util.ConfDir, "conf.json"), 0700); err != nil {
				t.Fatal(err)
			}
			ret, err := ClearAIMemory(ctx)
			if err == nil || ret.Disabled || ret.Cleared || !Conf.LoadAI().Memory.Enabled {
				t.Fatalf("clear proceeded without disabling: %+v %v", ret, err)
			}
			current, err := aiMemoryStore().Get(context.Background(), entry.Record.ID)
			if err != nil || current.Revision != entry.Revision {
				t.Fatalf("record changed without persisted disable: %+v %v", current, err)
			}
		})
	}
}
