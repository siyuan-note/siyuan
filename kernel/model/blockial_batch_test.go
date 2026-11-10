// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"maps"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestBatchBlockAttrsValidationDoesNotPublishChanges(t *testing.T) {
	fixture := setupFileOperationTest(t)
	putBatchBlockAttrsTestIAL(t, fixture.childID, fixture.box.ID, map[string]string{"custom-test": "old"})
	err := batchSetBlockAttrs([]map[string]any{
		{"id": fixture.childID, "attrs": map[string]string{"custom-test": "new"}},
		{"id": fixture.targetID, "attrs": map[string]string{"data-task": "x"}},
	}, func(*parse.Tree) error {
		t.Fatal("validation failure reached document persistence")
		return nil
	})
	if err == nil || !strings.Contains(err.Error(), "data-task") {
		t.Fatalf("expected validation error: %v", err)
	}
	if got := cache.GetBlockIALInBox(fixture.childID, fixture.box.ID)["custom-test"]; got != "old" {
		t.Fatalf("failed validation changed cached attributes: %q", got)
	}
	tree, err := LoadTreeByBlockID(fixture.childID)
	if err != nil || treenode.GetNodeInTree(tree, fixture.childID).IALAttr("custom-test") != "" {
		t.Fatalf("failed validation changed persisted attributes: %v", err)
	}
}

func TestBatchBlockAttrsPublishesOnlyPersistedDocuments(t *testing.T) {
	fixture := setupFileOperationTest(t)
	for _, id := range []string{fixture.childID, fixture.sourceID, fixture.targetID} {
		putBatchBlockAttrsTestIAL(t, id, fixture.box.ID, map[string]string{"custom-test": "old"})
	}
	injected := errors.New("injected second document failure")
	writes := 0
	err := batchSetBlockAttrs([]map[string]any{
		{"id": fixture.childID, "attrs": map[string]string{"custom-test": "new"}},
		{"id": fixture.sourceID, "attrs": map[string]string{"custom-test": "new"}},
		{"id": fixture.targetID, "attrs": map[string]string{"custom-test": "new"}},
	}, func(tree *parse.Tree) error {
		writes++
		if writes == 2 {
			return injected
		}
		if got := cache.GetBlockIALInBox(fixture.childID, fixture.box.ID)["custom-test"]; got != "old" {
			t.Fatalf("cache changed before persistence: %q", got)
		}
		_, err := filesys.WriteTree(tree)
		return err
	})
	if !errors.Is(err, injected) || writes != 2 || !strings.Contains(err.Error(), "1 of 2 documents") {
		t.Fatalf("partial failure was not reported accurately: writes=%d err=%v", writes, err)
	}
	for _, id := range []string{fixture.childID, fixture.sourceID, fixture.targetID} {
		wantCache, wantDisk := "new", "new"
		if id == fixture.targetID {
			wantCache, wantDisk = "old", ""
		}
		if got := cache.GetBlockIALInBox(id, fixture.box.ID)["custom-test"]; got != wantCache {
			t.Fatalf("cache does not match committed document %s: %q", id, got)
		}
		tree, loadErr := LoadTreeByBlockID(id)
		if loadErr != nil || treenode.GetNodeInTree(tree, id).IALAttr("custom-test") != wantDisk {
			t.Fatalf("unexpected persisted document %s: %v", id, loadErr)
		}
	}
}

func putBatchBlockAttrsTestIAL(t *testing.T, id, boxID string, attrs map[string]string) {
	t.Helper()
	cache.RemoveBlockIALInBox(id, boxID)
	cache.PutBlockIALInBox(id, boxID, attrs)
	t.Cleanup(func() { cache.RemoveBlockIALInBox(id, boxID) })

	// 首次写入异步入缓存；必须先确认夹具可见，再检查被测操作是否发布了属性。
	timeout := time.NewTimer(5 * time.Second)
	defer timeout.Stop()
	ticker := time.NewTicker(time.Millisecond)
	defer ticker.Stop()
	for {
		got := cache.GetBlockIALInBox(id, boxID)
		if maps.Equal(got, attrs) {
			return
		}
		select {
		case <-ticker.C:
		case <-timeout.C:
			t.Fatalf("cache fixture was not published for block %s: got %v, want %v", id, got, attrs)
		}
	}
}
