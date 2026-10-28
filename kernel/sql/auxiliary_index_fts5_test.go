// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package sql

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"strings"
	"testing"
)

const auxiliaryTestRoot = "20261019000000-root001"

func auxiliaryTableSnapshot(t testing.TB, database *sql.DB, table auxiliaryIndexTable, withIDs bool) []string {
	t.Helper()
	columns := table.columns
	if withIDs {
		columns = "rowid,id," + columns
	}
	rows, err := database.Query("SELECT " + columns + " FROM " + table.name)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var result []string
	for rows.Next() {
		values := make([]any, strings.Count(columns, ",")+1)
		args := make([]any, len(values))
		for i := range values {
			args[i] = &values[i]
		}
		if err = rows.Scan(args...); err != nil {
			t.Fatal(err)
		}
		for i, value := range values {
			if bytes, ok := value.([]byte); ok {
				values[i] = string(bytes)
			}
		}
		encoded, err := json.Marshal(values)
		if err != nil {
			t.Fatal(err)
		}
		result = append(result, string(encoded))
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	slices.Sort(result)
	return result
}

func runAuxiliaryIndexCases[T any](t *testing.T, encrypted bool, table auxiliaryIndexTable,
	makeRow func(id, block, content string) *T, keyOf func(*T) auxiliaryIndexKey,
	insert func(*sql.Tx, []*T) error) {
	t.Helper()
	database := newDeletePathTestDB(t, encrypted)
	previousDisabled := cacheDisabled
	cacheDisabled = true
	t.Cleanup(func() { cacheDisabled = previousDisabled; ClearCache() })
	write := func(target *sql.DB, values []*T) {
		t.Helper()
		tx, err := target.Begin()
		if err != nil {
			t.Fatal(err)
		}
		defer closeTxPreparedStmts(tx)
		defer tx.Rollback()
		if err = insert(tx, values); err != nil {
			t.Fatal(err)
		}
		if err = tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}
	old := []*T{makeRow("old-keep", "keep", "unchanged"), makeRow("old-one", "change", "one"),
		makeRow("old-duplicate", "change", "one"), makeRow("old-remove", "remove", "removed")}
	write(database, old)
	before := auxiliaryTableSnapshot(t, database, table, true)
	tx, err := database.Begin()
	if err != nil {
		t.Fatal(err)
	}
	same := []*T{makeRow("new-remove", "remove", "removed"), makeRow("new-one", "change", "one"),
		makeRow("new-keep", "keep", "unchanged"), makeRow("new-duplicate", "change", "one")}
	change, err := diffAuxiliaryIndex(tx, table, auxiliaryTestRoot, "box", "/doc.sy", same, keyOf)
	tx.Rollback()
	if err != nil || len(change.remove) != 0 || len(change.insert) != 0 {
		t.Fatalf("IDs and ordering must not cause rewrites: remove=%v insert=%v err=%v", change.remove, change.insert, err)
	}
	if after := auxiliaryTableSnapshot(t, database, table, true); !reflect.DeepEqual(before, after) {
		t.Fatal("comparing records changed the database")
	}

	next := []*T{makeRow("new-keep", "keep", "unchanged"), makeRow("new-changed", "change", "two"), makeRow("new-added", "added", "new")}
	tx, err = database.Begin()
	if err != nil {
		t.Fatal(err)
	}
	change, err = diffAuxiliaryIndex(tx, table, auxiliaryTestRoot, "box", "/doc.sy", next, keyOf)
	if err != nil || len(change.remove) != 3 || len(change.insert) != 2 {
		tx.Rollback()
		t.Fatalf("unexpected changed block multiset: deleted=%d inserted=%d err=%v", len(change.remove), len(change.insert), err)
	}
	if err = change.delete(tx); err == nil {
		err = insert(tx, change.insert)
	}
	if err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	if err = commitTx(tx); err != nil {
		t.Fatal(err)
	}
	var retained string
	if err = database.QueryRow("SELECT id FROM " + table.name + " WHERE block_id = 'keep'").Scan(&retained); err != nil || retained != "old-keep" {
		t.Fatalf("unchanged record was replaced: id=%s err=%v", retained, err)
	}
	oracle := newDeletePathTestDB(t, encrypted)
	write(oracle, next)
	if got, want := auxiliaryTableSnapshot(t, database, table, false), auxiliaryTableSnapshot(t, oracle, table, false); !reflect.DeepEqual(got, want) {
		t.Fatalf("incremental index differs from complete replacement: got=%v want=%v", got, want)
	}
	before = auxiliaryTableSnapshot(t, database, table, true)
	// 重放同一个最终快照必须保持所有记录 ID 和行号。
	tx, err = database.Begin()
	if err != nil {
		t.Fatal(err)
	}
	change, err = diffAuxiliaryIndex(tx, table, auxiliaryTestRoot, "box", "/doc.sy", next, keyOf)
	tx.Rollback()
	if err != nil || len(change.remove) != 0 || len(change.insert) != 0 {
		t.Fatalf("replayed snapshot rewrites records: %+v err=%v", change, err)
	}

	execDeletePathTestSQL(t, database, "CREATE TRIGGER injected_failure BEFORE INSERT ON "+table.name+
		" WHEN new.id = 'fail' BEGIN SELECT RAISE(ABORT, 'injected auxiliary failure'); END")
	tx, err = database.Begin()
	if err != nil {
		t.Fatal(err)
	}
	failing := []*T{makeRow("fail", "keep", "changed before rollback"), next[1], next[2]}
	change, err = diffAuxiliaryIndex(tx, table, auxiliaryTestRoot, "box", "/doc.sy", failing, keyOf)
	if err == nil {
		err = change.delete(tx)
	}
	if err == nil {
		err = insert(tx, change.insert)
	}
	tx.Rollback()
	closeTxPreparedStmts(tx)
	if err == nil || !strings.Contains(err.Error(), "injected auxiliary failure") {
		t.Fatalf("expected the injected write failure, got %v", err)
	}
	if got := auxiliaryTableSnapshot(t, database, table, true); !reflect.DeepEqual(got, before) {
		t.Fatalf("rollback changed the committed index: got=%v want=%v", got, before)
	}
}

func TestAuxiliaryIndexChangesPreserveBusinessRecords(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(fmt.Sprint(encrypted), func(t *testing.T) {
			t.Run("spans", func(t *testing.T) {
				runAuxiliaryIndexCases(t, encrypted, spanIndex, func(id, block, content string) *Span {
					return &Span{ID: id, BlockID: block, RootID: auxiliaryTestRoot, Box: "box", Path: "/doc.sy", Content: content, Type: "tag"}
				}, spanIndexKey, insertSpans)
			})
			t.Run("assets", func(t *testing.T) {
				runAuxiliaryIndexCases(t, encrypted, assetIndex, func(id, block, content string) *Asset {
					return &Asset{ID: id, BlockID: block, RootID: auxiliaryTestRoot, Box: "box", DocPath: "/doc.sy", Path: "assets/source.png", Hash: content}
				}, assetIndexKey, insertAssets)
			})
			t.Run("attributes", func(t *testing.T) {
				runAuxiliaryIndexCases(t, encrypted, attributeIndex, func(id, block, content string) *Attribute {
					return &Attribute{ID: id, BlockID: block, RootID: auxiliaryTestRoot, Box: "box", Path: "/doc.sy", Name: "custom-test", Value: content, Type: "b"}
				}, attributeIndexKey, insertAttributes)
			})
			t.Run("refs", func(t *testing.T) {
				runAuxiliaryIndexCases(t, encrypted, refIndex, func(id, block, content string) *Ref {
					return &Ref{ID: id, BlockID: block, RootID: auxiliaryTestRoot, Box: "box", Path: "/doc.sy", DefBlockID: "definition", DefBlockPath: content}
				}, refIndexKey, insertBlockRefs)
			})
			t.Run("file_annotations", func(t *testing.T) {
				runAuxiliaryIndexCases(t, encrypted, fileAnnotationIndex, func(id, block, content string) *FileAnnotationRef {
					return &FileAnnotationRef{ID: id, BlockID: block, RootID: auxiliaryTestRoot, Box: "box", Path: "/doc.sy", AnnotationID: content, FilePath: "assets/source.pdf"}
				}, fileAnnotationIndexKey, insertFileAnnotationRefs)
			})
		})
	}
}

func TestAuxiliaryIndexesPreserveExistingDataAndUseIndexedLookups(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		database := newDeletePathTestDB(t, encrypted)
		for _, table := range []auxiliaryIndexTable{spanIndex, assetIndex, attributeIndex} {
			execDeletePathTestSQL(t, database, "INSERT INTO "+table.name+" (id, root_id) VALUES ('existing', 'root')")
			execDeletePathTestSQL(t, database, "DROP INDEX idx_"+table.name+"_root_id")
		}
		for range 2 {
			if err := ensureAuxiliaryRootIndexes(database); err != nil {
				t.Fatal(err)
			}
		}
		for _, table := range []auxiliaryIndexTable{spanIndex, assetIndex, attributeIndex, refIndex, fileAnnotationIndex} {
			condition, args := "root_id = ?", []any{"root"}
			if table.byPath {
				condition, args = "box = ? AND path = ?", []any{"box", "/doc.sy"}
			}
			plan := queryPlanDetails(t, database, "SELECT rowid,"+table.columns+" FROM "+table.name+" WHERE "+condition, args...)
			if !strings.Contains(plan, "SEARCH "+table.name+" USING INDEX") {
				t.Fatalf("snapshot lookup scans %s: %s", table.name, plan)
			}
			plan = queryPlanDetails(t, database, "DELETE FROM "+table.name+" WHERE rowid IN (?, ?)", 1, 2)
			if !strings.Contains(plan, "INTEGER PRIMARY KEY") {
				t.Fatalf("changed rows are not located by rowid: %s", plan)
			}
		}
		for _, table := range []auxiliaryIndexTable{spanIndex, assetIndex, attributeIndex} {
			if ids := deletePathTestIDs(t, database, "SELECT id FROM "+table.name); !reflect.DeepEqual(ids, []string{"existing"}) {
				t.Fatalf("index upgrade changed existing rows: %s %v", table.name, ids)
			}
		}
	}
}

func TestAuxiliaryIndexPreservesNullDistinctionAndBatchesDeletes(t *testing.T) {
	database := newDeletePathTestDB(t, false)
	execDeletePathTestSQL(t, database, "INSERT INTO spans VALUES ('nullable', 'block', ?, '', '', '', '', '', NULL)", auxiliaryTestRoot)
	tx, err := database.Begin()
	if err != nil {
		t.Fatal(err)
	}
	change, err := diffAuxiliaryIndex(tx, spanIndex, auxiliaryTestRoot, "box", "/doc.sy",
		[]*Span{{ID: "replacement", BlockID: "block", RootID: auxiliaryTestRoot}}, spanIndexKey)
	tx.Rollback()
	if err != nil || len(change.remove) != 1 || len(change.insert) != 1 {
		t.Fatalf("NULL was treated as an empty string: %+v err=%v", change, err)
	}
	execDeletePathTestSQL(t, database, "DELETE FROM spans")
	for i := range 1300 {
		execDeletePathTestSQL(t, database, "INSERT INTO spans (id, block_id, root_id, ial) VALUES (?, 'block', ?, NULL)", fmt.Sprint(i), auxiliaryTestRoot)
	}
	tx, err = database.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	change, err = diffAuxiliaryIndex(tx, spanIndex, auxiliaryTestRoot, "box", "/doc.sy",
		[]*Span{{ID: "replacement", BlockID: "block", RootID: auxiliaryTestRoot}}, spanIndexKey)
	if err != nil || len(change.remove) != 1300 || len(change.insert) != 1 {
		t.Fatalf("NULL values or duplicate rows were treated as equal: removed=%d inserted=%d err=%v", len(change.remove), len(change.insert), err)
	}
	if err = change.delete(tx); err == nil {
		err = insertSpans(tx, change.insert)
	}
	if err != nil {
		t.Fatal(err)
	}
	if err = commitTx(tx); err != nil {
		t.Fatal(err)
	}
	if ids := deletePathTestIDs(t, database, "SELECT id FROM spans"); !reflect.DeepEqual(ids, []string{"replacement"}) {
		t.Fatalf("batched deletion left stale records: %v", ids)
	}
}
