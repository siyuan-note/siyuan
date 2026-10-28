// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package sql

import (
	"database/sql"
	"fmt"
	"testing"

	"github.com/88250/lute/parse"
	"github.com/emirpasic/gods/sets/hashset"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// upsertTreeWithFullAuxiliaryReplacement 以完整替换附属记录作为增量路径的基准对照。
func upsertTreeWithFullAuxiliaryReplacement(tx *sql.Tx, tree *parse.Tree, context map[string]any) (err error) {
	oldBlockHashes := queryBlockHashes(tx, tree.ID)
	blocks, spans, assets, attributes := fromTree(tree.Root, tree)
	newBlockHashes := map[string]string{}
	for _, block := range blocks {
		newBlockHashes[block.ID] = block.Hash
	}
	unchanged := hashset.New()
	var removed []string
	for id, hash := range oldBlockHashes {
		if next, ok := newBlockHashes[id]; ok {
			if next == hash {
				unchanged.Add(id)
			}
		} else {
			removed = append(removed, id)
		}
	}
	next := blocks[:0]
	for _, block := range blocks {
		if !unchanged.Contains(block.ID) {
			next = append(next, block)
			removed = append(removed, block.ID)
		}
	}
	if err = deleteBlocksByIDs(tx, removed); err != nil {
		return
	}
	for _, remove := range []func() error{
		func() error { return deleteSpansByRootID(tx, tree.ID) },
		func() error { return deleteAssetsByRootID(tx, tree.ID) },
		func() error { return deleteAttributesByRootID(tx, tree.ID) },
		func() error { return deleteRefsByPathTx(tx, tree.Box, tree.Path) },
		func() error { return deleteFileAnnotationRefsByPathTx(tx, tree.Box, tree.Path) },
	} {
		if err = remove(); err != nil {
			return
		}
	}
	refs, annotations := refsFromTree(tree)
	return insertTree0(tx, tree, context, next, spans, assets, attributes, refs, annotations)
}

func BenchmarkUpsertTreeAuxiliaryIndexes(b *testing.B) {
	previousCached, previousIgnore, previousDir, previousDisabled, previousDB := IndexIgnoreCached, indexIgnore, util.DataDir, cacheDisabled, db
	IndexIgnoreCached, indexIgnore, cacheDisabled, util.DataDir = true, nil, true, b.TempDir()
	b.Cleanup(func() {
		IndexIgnoreCached, indexIgnore, util.DataDir, cacheDisabled = previousCached, previousIgnore, previousDir, previousDisabled
		db = previousDB
		ClearCache()
	})
	for _, size := range []int{1000, 5000, 20000} {
		b.Run(fmt.Sprint(size), func(b *testing.B) {
			for _, mode := range []struct {
				name   string
				update func(*sql.Tx, *parse.Tree, map[string]any) error
			}{{"complete", upsertTreeWithFullAuxiliaryReplacement}, {"incremental", upsertTree}, {"changeset", func(tx *sql.Tx, tree *parse.Tree, context map[string]any) error {
				return upsertTreeWithChanges(tx, tree, context, NewTreeIndexChanges([]string{tree.ID, tree.Root.FirstChild.ID}))
			}}} {
				b.Run(mode.name, func(b *testing.B) {
					database := newDeletePathTestDB(b, false)
					db = database
					tree := newUpsertTestTree(size)
					tx, err := database.Begin()
					if err != nil {
						b.Fatal(err)
					}
					if err = indexTree(tx, tree, nil); err == nil {
						err = commitTx(tx)
					}
					if err != nil {
						b.Fatal(err)
					}
					tx, err = database.Begin()
					if err != nil {
						b.Fatal(err)
					}
					if hashes := queryBlockHashes(tx, tree.ID); len(hashes) != size+1 {
						b.Fatalf("baseline must contain all existing block hashes: got %d", len(hashes))
					}
					tx.Rollback()
					var before, after int64
					if err = database.QueryRow("SELECT total_changes()").Scan(&before); err != nil {
						b.Fatal(err)
					}
					b.ReportAllocs()
					b.ResetTimer()
					for i := 0; i < b.N; i++ {
						content := "changed ordinary paragraph content "
						if i%2 == 1 {
							content = "original paragraph content "
						}
						tree.Root.FirstChild.FirstChild.Tokens = []byte(content)
						tx, err = database.Begin()
						if err != nil {
							b.Fatal(err)
						}
						if err = mode.update(tx, tree, nil); err == nil {
							err = commitTx(tx)
						}
						if err != nil {
							tx.Rollback()
							closeTxPreparedStmts(tx)
							b.Fatal(err)
						}
					}
					b.StopTimer()
					if err = database.QueryRow("SELECT total_changes()").Scan(&after); err != nil {
						b.Fatal(err)
					}
					b.ReportMetric(float64(after-before)/float64(b.N), "sqlite_changes/op")
				})
			}
		})
	}
}
