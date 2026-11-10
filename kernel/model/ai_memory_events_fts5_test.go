// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
	"testing"
)

func TestAIMemoryDirectAttributeWriteQueuesOnlySuccess(t *testing.T) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	Conf.AI.Store(conf.NewAI())
	oldReadOnly := util.ReadOnly
	util.ReadOnly = false
	t.Cleanup(func() { util.ReadOnly = oldReadOnly })
	resetMemoryEventQueues(t)
	if err := SetBlockAttrs("20261029000000-missing", map[string]string{"name": "missing"}); err == nil {
		t.Fatal("missing source accepted")
	}
	memorySourceQueue.Lock()
	count := len(memorySourceQueue.ids)
	memorySourceQueue.Unlock()
	if count != 0 {
		t.Fatal("failed attribute write queued memory")
	}
	if err := SetBlockAttrs(fixture.childID, map[string]string{"name": "memory source"}); err != nil {
		t.Fatal(err)
	}
	memorySourceQueue.Lock()
	queued := memorySourceQueue.ids[fixture.sourceID]
	memorySourceQueue.Unlock()
	if !queued {
		t.Fatal("successful attribute write did not queue its document")
	}
}
