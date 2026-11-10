// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package sql

import (
	"fmt"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocTreeUpsertReferenceInvalidation(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(fmt.Sprint(encrypted), func(t *testing.T) {
			previousDB, previousDisabled := db, cacheDisabled
			previousCached, previousIgnore, previousDir := IndexIgnoreCached, indexIgnore, util.DataDir
			db, cacheDisabled, util.DataDir = newDeletePathTestDB(t, encrypted), true, t.TempDir()
			IndexIgnoreCached, indexIgnore = true, nil
			t.Cleanup(func() {
				db, cacheDisabled, util.DataDir = previousDB, previousDisabled, previousDir
				IndexIgnoreCached, indexIgnore = previousCached, previousIgnore
				ClearCache()
			})
			tree := newUpsertTestTree(2)
			write := func(wantChange bool) {
				t.Helper()
				tx, err := db.Begin()
				if err != nil {
					t.Fatal(err)
				}
				defer tx.Rollback()
				defer closeTxPreparedStmts(tx)
				context := map[string]any{"docTreeRefsChanged": true}
				if err = upsertTreeWithChanges(tx, tree, context, nil); err != nil {
					t.Fatal(err)
				}
				if context["docTreeRefsChanged"] != wantChange {
					t.Fatalf("reference change = %v, want %v", context["docTreeRefsChanged"], wantChange)
				}
				if err = commitTx(tx); err != nil {
					t.Fatal(err)
				}
			}
			write(false)
			tree.Root.FirstChild.FirstChild.Tokens = []byte("changed plain paragraph")
			tree.Root.SetIALAttr("updated", "20261026120000")
			write(false)
			// 本次完整文档快照不再含这条引用，提交会改变其他文档的引用数排序。
			execDeletePathTestSQL(t, db, "INSERT INTO refs (id, def_block_root_id, block_id, root_id, box, path) VALUES ('old', 'target', ?, ?, ?, ?)",
				tree.Root.FirstChild.ID, tree.ID, tree.Box, tree.Path)
			write(true)
			write(false)
		})
	}
}
