// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"

	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/memo"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestAIMemoryTransactionReconcilesChangedBlock(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	oldComplete := memoryComplete
	cfg := conf.NewAI()
	cfg.Memory.Enabled = false
	cfg.Memory.ModelID = "memory-model"
	cfg.Providers = []*conf.Provider{{Enabled: true, Models: []*conf.Model{{ID: "memory-model", Name: "test", Enabled: true}}}}
	Conf.AI.Store(cfg)
	t.Cleanup(func() {
		memoryComplete = oldComplete
		memorySourceQueue.Lock()
		if memorySourceQueue.timer != nil {
			memorySourceQueue.timer.Stop()
		}
		memorySourceQueue.ids = map[string]bool{}
		memorySourceQueue.Unlock()
	})
	ctx := context.Background()
	source, err := memorySource(ctx, fixture.childID)
	if err != nil {
		t.Fatal(err)
	}
	entry, err := aiMemoryStore().Save(ctx, memo.Record{Schema: 1, Kind: "fact", Subject: "project", Scope: fixture.childID, State: "active", Content: "Project status", Sources: []memo.Source{source}}, "missing", "initial")
	if err != nil {
		t.Fatal(err)
	}
	tx := &Transaction{DoOperations: []*Operation{{Action: "update", ID: fixture.childID, Data: fmt.Sprintf(`<div data-node-id="%s" data-type="NodeParagraph"><div contenteditable="true">Project status: completed</div></div>`, fixture.childID)}}}
	if err = PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	// 真实事务提交后的合并队列将失效记录转为待核对，未启用自动模型调用。
	deadline := time.Now().Add(5 * time.Second)
	for {
		current, readErr := aiMemoryStore().Get(ctx, entry.Record.ID)
		if readErr != nil {
			t.Fatal(readErr)
		}
		if current.Record.State == "review" {
			break
		}
		if time.Now().After(deadline) {
			now, sourceErr := memorySource(ctx, fixture.childID)
			t.Fatalf("committed transaction did not invalidate memory: roots=%v state=%s sameRevision=%v sourceErr=%v revalidateErr=%v", tx.GetMutatedRootIDs(), current.Record.State, now.Revision == source.Revision, sourceErr, RevalidateAIMemorySources(ctx, []string{fixture.sourceID}))
		}
		time.Sleep(10 * time.Millisecond)
	}
	rootSource, err := memorySource(ctx, fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	memoryComplete = func(_ context.Context, _ *conf.AI, prompt string) (string, error) {
		if strings.Contains(prompt, `"terms"`) {
			return `{"intent":"remember","terms":["Project status"]}`, nil
		}
		if strings.HasPrefix(prompt, "Generate a concise") {
			return "", nil
		}
		if !strings.Contains(prompt, entry.Record.ID) {
			t.Error("changed child identity missing from document reconciliation")
		}
		return fmt.Sprintf(`{"actions":[{"id":%q,"kind":"fact","subject":"project","scope":%q,"content":"Project status: completed","state":"active","sourceIndexes":[0]}]}`, entry.Record.ID, fixture.childID), nil
	}
	runCtx, cancel := context.WithCancel(ctx)
	task := &memoryTask{cancel: cancel}
	runAIMemory(runCtx, cfg, apicontract.AIMemoryMaintainRequest{SourceIDs: []string{fixture.sourceID}, OperationID: "reconcile"}, []memo.Source{rootSource}, false, task)
	if task.status.State != "completed" || len(task.status.Results) != 1 || !task.status.Results[0].Saved || task.status.Results[0].ID != entry.Record.ID {
		t.Fatalf("transaction reconciliation failed: %+v", task.status)
	}
	updated, err := aiMemoryStore().Get(ctx, entry.Record.ID)
	if err != nil || updated.Record.State != "candidate" || updated.Record.Content != "Project status: completed" || !validateMemorySources(ctx, updated.Record) {
		t.Fatalf("invalid updated record: %+v %v", updated, err)
	}
}

func TestAIMemoryLongDocumentTransactionRefreshesExistingChild(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	resetMemoryEventQueues(t)
	oldComplete := memoryComplete
	t.Cleanup(func() { memoryComplete = oldComplete })
	cfg := conf.NewAI()
	cfg.Memory.Enabled = true
	cfg.Memory.ModelID = "memory-model"
	cfg.Providers = []*conf.Provider{{Enabled: true, Models: []*conf.Model{{ID: "memory-model", Name: "test", Enabled: true}}}}
	Conf.AI.Store(cfg)
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	large := treenode.NewParagraph(ast.NewNodeID())
	large.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(strings.Repeat("x", 70000))})
	tree.Root.AppendChild(large)
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	ctx := context.Background()
	if _, err = memorySource(ctx, fixture.sourceID); err == nil {
		t.Fatal("test requires oversized document source")
	}
	source, err := memorySource(ctx, fixture.childID)
	if err != nil {
		t.Fatal(err)
	}
	entry, err := aiMemoryStore().Save(ctx, memo.Record{Schema: 1, Kind: "fact", Subject: "project", Scope: fixture.childID, State: "active", Content: "Project status", Sources: []memo.Source{source}}, "missing", "initial")
	if err != nil {
		t.Fatal(err)
	}
	memoryComplete = func(_ context.Context, _ *conf.AI, prompt string) (string, error) {
		if strings.Contains(prompt, `"terms"`) {
			return `{"intent":"remember","terms":["Project status"]}`, nil
		}
		if strings.HasPrefix(prompt, "Generate a concise") {
			return "", nil
		}
		return fmt.Sprintf(`{"actions":[{"id":%q,"kind":"fact","subject":"project","scope":%q,"content":"Project status: completed","state":"active","sourceIndexes":[0]}]}`, entry.Record.ID, fixture.childID), nil
	}
	tx := &Transaction{DoOperations: []*Operation{{Action: "update", ID: fixture.childID, Data: fmt.Sprintf(`<div data-node-id="%s" data-type="NodeParagraph"><div contenteditable="true">Project status: completed</div></div>`, fixture.childID)}}}
	if err = PerformTxSync(tx); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(8 * time.Second)
	for {
		updated, readErr := aiMemoryStore().Get(ctx, entry.Record.ID)
		completed := false
		for _, task := range RecentAIMemoryTasks() {
			if task.State == "completed" {
				completed = true
			}
		}
		if readErr == nil && updated.Record.State == "candidate" && updated.Record.Content == "Project status: completed" && completed {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("long document suppressed child maintenance: %+v %v tasks=%+v", updated, readErr, RecentAIMemoryTasks())
		}
		time.Sleep(10 * time.Millisecond)
	}
}
