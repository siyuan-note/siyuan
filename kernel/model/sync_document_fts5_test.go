// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSyncDocumentUnsupportedSourceClearsOldIndexes(t *testing.T) {
	for _, test := range []struct {
		name, source string
		wantErr      error
	}{
		{"future spec", `{"Spec":"999","Properties":{"title":"Future"}}`, treenode.ErrSpecTooNew},
		{"future title", `{"Spec":"2","Properties":{"title":{"format":"future"}}}`, documentaddressing.ErrInvalidTitle},
	} {
		t.Run(test.name, func(t *testing.T) {
			testSyncDocumentUnsupportedSourceClearsOldIndexes(t, []byte(test.source), test.wantErr)
		})
	}
}

func testSyncDocumentUnsupportedSourceClearsOldIndexes(t *testing.T, future []byte, wantErr error) {
	fixture := setupStructureTransactionTest(t)
	setupFoldTransactionDatabase(t, fixture)
	previousStatus := util.StatusBarCfg.Load()
	util.StatusBarCfg.Store(&util.StatusBar{MsgDataSyncDisabled: true})
	t.Cleanup(func() { util.StatusBarCfg.Store(previousStatus) })
	stale, err := filesys.LoadTree(fixture.box.ID, fixture.sourcePath, util.NewLute())
	if err != nil {
		t.Fatal(err)
	}
	sql.UpsertTreeQueue(stale)
	sql.FlushQueue()
	if sql.GetBlock(stale.ID) == nil {
		t.Fatal("old source was not indexed")
	}
	path := filepath.Join(util.DataDir, fixture.box.ID, fixture.sourcePath)
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, future, 0644); err != nil {
		t.Fatal(err)
	}
	indexed := upsertIndexes([]string{"/" + fixture.box.ID + fixture.sourcePath, "/" + fixture.box.ID + fixture.targetPath})
	sql.FlushQueue()
	if len(indexed) != 1 || indexed[0] != fixture.targetID {
		t.Fatal("unsupported source blocked compatible indexing", indexed)
	}
	if treenode.GetBlockTreeInBox(stale.ID, fixture.box.ID) != nil || sql.GetBlock(stale.ID) != nil {
		t.Fatal("unsupported source retained its old index")
	}
	if _, ok := cache.GetTreeDataInBox(stale.ID, fixture.box.ID); ok {
		t.Fatal("unsupported source retained cached tree data")
	}
	if _, err = filesys.LoadTree(fixture.box.ID, fixture.sourcePath, util.NewLute()); !errors.Is(err, wantErr) {
		t.Fatal("unsupported source was parsed", err)
	}
	stale.Root.SetIALAttr("title", "Stale edit")
	if _, err = filesys.WriteTree(stale); !errors.Is(err, wantErr) {
		t.Fatal("stale editor overwrote unsupported source", err)
	}
	actual, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(actual, future) {
		t.Fatal("indexing or stale editing changed opaque bytes", err)
	}
	if err = os.WriteFile(path, before, 0644); err != nil {
		t.Fatal(err)
	}
	indexed = upsertIndexes([]string{"/" + fixture.box.ID + fixture.sourcePath})
	sql.FlushQueue()
	if len(indexed) != 1 || indexed[0] != stale.ID || sql.GetBlock(stale.ID) == nil ||
		treenode.GetBlockTreeInBox(stale.ID, fixture.box.ID) == nil {
		t.Fatal("compatible replacement was not reindexed", indexed)
	}
}
