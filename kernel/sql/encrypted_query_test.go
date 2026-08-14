// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package sql

import (
	"context"
	gosql "database/sql"
	"errors"
	"fmt"
	"testing"
	"time"
)

func TestGetBlocksInBoxPreservesInputOrder(t *testing.T) {
	testDB, boxID := useEncryptedQueryTestDB(t)
	insertEncryptedQueryTestBlock(t, testDB, "block-1", "", "block-1", "d")
	insertEncryptedQueryTestBlock(t, testDB, "block-2", "", "block-2", "d")
	insertEncryptedQueryTestBlock(t, testDB, "block-3", "", "block-3", "d")

	blocks := GetBlocksInBox([]string{"block-3", "block-1", "block-2"}, boxID)
	if 3 != len(blocks) {
		t.Fatalf("unexpected block count: %d", len(blocks))
	}
	for i, expected := range []string{"block-3", "block-1", "block-2"} {
		if nil == blocks[i] || expected != blocks[i].ID {
			t.Fatalf("unexpected block at %d: %#v", i, blocks[i])
		}
	}
}

func TestQueryRefsByDefIDInBoxContainsChildren(t *testing.T) {
	testDB, boxID := useEncryptedQueryTestDB(t)
	insertEncryptedQueryTestBlock(t, testDB, "root", "", "root", "d")
	insertEncryptedQueryTestBlock(t, testDB, "heading", "root", "root", "h")
	insertEncryptedQueryTestBlock(t, testDB, "paragraph", "heading", "root", "p")
	insertEncryptedQueryTestBlock(t, testDB, "sibling", "root", "root", "p")
	insertEncryptedQueryTestRef(t, testDB, "ref-heading", "heading", "root")
	insertEncryptedQueryTestRef(t, testDB, "ref-paragraph", "paragraph", "root")
	insertEncryptedQueryTestRef(t, testDB, "ref-sibling", "sibling", "root")

	refs := QueryRefsByDefIDInBox("heading", true, boxID)
	actual := map[string]bool{}
	for _, ref := range refs {
		actual[ref.DefBlockID] = true
	}
	if 2 != len(refs) || !actual["heading"] || !actual["paragraph"] || actual["sibling"] {
		t.Fatalf("unexpected refs: %#v", actual)
	}
}

func TestQueryRefsRecentInBoxPrioritizesUsageBeforeLimit(t *testing.T) {
	testDB, boxID := useEncryptedQueryTestDB(t)
	for i := 0; i < 40; i++ {
		defID := fmt.Sprintf("def-%02d", i)
		insertEncryptedQueryTestBlock(t, testDB, defID, "", defID, "d")
		insertEncryptedQueryTestRef(t, testDB, fmt.Sprintf("ref-%02d", i), defID, defID)
	}

	refs := QueryRefsRecentInBox(true, "('d')", nil, []string{"def-00"}, boxID)
	if 32 != len(refs) {
		t.Fatalf("最近引用查询数量错误：%d", len(refs))
	}
	if "def-00" != refs[0].DefBlockID {
		t.Fatalf("最近引用的文档未排在候选列表首位：%s", refs[0].DefBlockID)
	}
}

func TestExistRefByDefIDsSearchesGlobalAndEncryptedIndexes(t *testing.T) {
	globalDB, err := gosql.Open("sqlite3_extended", ":memory:")
	if nil != err {
		t.Fatalf("open global test database failed: %s", err)
	}
	globalDB.SetMaxOpenConns(1)
	if _, err = globalDB.Exec("CREATE TABLE refs (def_block_id TEXT, def_block_root_id TEXT, block_id TEXT, root_id TEXT)"); nil != err {
		t.Fatalf("create global refs table failed: %s", err)
	}
	if _, err = globalDB.Exec("INSERT INTO refs VALUES ('global-definition', 'global-root', 'global-ref', 'global-ref-root')"); nil != err {
		t.Fatalf("insert global ref failed: %s", err)
	}
	if _, err = globalDB.Exec("INSERT INTO refs VALUES ('mixed-definition', 'mixed-root', 'internal-ref', 'internal-root'), ('mixed-definition', 'mixed-root', 'external-ref', 'external-root')"); nil != err {
		t.Fatalf("insert mixed refs failed: %s", err)
	}
	if _, err = globalDB.Exec("INSERT INTO refs VALUES ('', '', 'dirty-ref', 'dirty-root'), ('dirty-source-definition', 'dirty-source-root', '', '')"); nil != err {
		t.Fatalf("insert invalid refs failed: %s", err)
	}
	previousDB := db
	db = globalDB
	t.Cleanup(func() {
		db = previousDB
		globalDB.Close()
	})

	encryptedDB, _ := useEncryptedQueryTestDB(t)
	insertEncryptedQueryTestRef(t, encryptedDB, "encrypted-ref", "encrypted-definition", "encrypted-root")

	if exists, queryErr := ExistRefByDefIDs([]string{"global-definition"}, nil, nil, nil); nil != queryErr || !exists {
		t.Fatalf("global ref was not found: %v", queryErr)
	}
	if exists, queryErr := ExistRefByDefIDs([]string{"encrypted-definition"}, nil, nil, nil); nil != queryErr || !exists {
		t.Fatalf("encrypted ref was not found: %v", queryErr)
	}
	if exists, queryErr := ExistRefByDefIDs(nil, []string{"encrypted-root"}, nil, nil); nil != queryErr || !exists {
		t.Fatalf("encrypted root ref was not found: %v", queryErr)
	}
	if exists, queryErr := ExistRefByDefIDs([]string{"missing"}, []string{"missing"}, nil, nil); nil != queryErr || exists {
		t.Fatalf("unexpected missing ref result: exists=%v, err=%v", exists, queryErr)
	}
	if exists, queryErr := ExistRefByDefIDs(
		[]string{"global-definition"}, nil, []string{"global-ref"}, nil); nil != queryErr || exists {
		t.Fatalf("reference from an excluded block should be ignored: exists=%v, err=%v", exists, queryErr)
	}
	if exists, queryErr := ExistRefByDefIDs(
		nil, []string{"global-root"}, nil, []string{"global-ref-root"}); nil != queryErr || exists {
		t.Fatalf("reference from an excluded document should be ignored: exists=%v, err=%v", exists, queryErr)
	}
	if exists, queryErr := ExistRefByDefIDs(
		[]string{"mixed-definition"}, nil, []string{"internal-ref"}, []string{"internal-root"}); nil != queryErr || !exists {
		t.Fatalf("reference from outside the excluded set was not found: exists=%v, err=%v", exists, queryErr)
	}
	if exists, queryErr := ExistRefByDefIDs([]string{"", "missing"}, []string{""}, nil, nil); nil != queryErr || exists {
		t.Fatalf("empty definition IDs should be ignored: exists=%v, err=%v", exists, queryErr)
	}
	if exists, queryErr := ExistRefByDefIDs([]string{"dirty-source-definition"}, nil, nil, nil); nil != queryErr || exists {
		t.Fatalf("references with an empty source should be ignored: exists=%v, err=%v", exists, queryErr)
	}
}

func TestQueryBoundBlockAVIDsSearchesGlobalAndEncryptedIndexes(t *testing.T) {
	globalDB, err := gosql.Open("sqlite3_extended", ":memory:")
	if nil != err {
		t.Fatalf("open global test database failed: %s", err)
	}
	globalDB.SetMaxOpenConns(1)
	if _, err = globalDB.Exec("CREATE TABLE blocks (id TEXT, root_id TEXT, ial TEXT)"); nil != err {
		t.Fatalf("create global blocks table failed: %s", err)
	}
	if _, err = globalDB.Exec("INSERT INTO blocks VALUES ('global-bound', 'global-root', '{: id=\"global-bound\" custom-avs=\"20260804000000-global\"}'), ('false-positive', 'global-root', '{: id=\"false-positive\" memo=\"custom-avs=20260804000000-false\"}')"); nil != err {
		t.Fatalf("insert global bound blocks failed: %s", err)
	}
	if _, err = globalDB.Exec("INSERT INTO blocks VALUES ('', 'dirty-root', '{: custom-avs=\"20260804000000-dirty\"}')"); nil != err {
		t.Fatalf("insert invalid bound block failed: %s", err)
	}
	previousDB := db
	db = globalDB
	t.Cleanup(func() {
		db = previousDB
		globalDB.Close()
	})

	encryptedDB, boxID := useEncryptedQueryTestDB(t)
	insertEncryptedQueryTestBlock(t, encryptedDB, "encrypted-bound", "", "encrypted-root", "p")
	if _, err = encryptedDB.Exec("UPDATE blocks SET ial = ? WHERE id = ?", "{: id=\"encrypted-bound\" custom-avs=\"20260804000000-encrypted\"}", "encrypted-bound"); nil != err {
		t.Fatalf("update encrypted bound block failed: %s", err)
	}

	boundAVIDs, queryErr := QueryBoundBlockAVIDs([]string{"global-bound", "false-positive"}, []string{"encrypted-root"})
	if nil != queryErr {
		t.Fatalf("query bound blocks failed: %s", queryErr)
	}
	if 1 != len(boundAVIDs["global-bound"]) || "20260804000000-global" != boundAVIDs["global-bound"][0] {
		t.Fatalf("unexpected global bound block result: %#v", boundAVIDs)
	}
	if 1 != len(boundAVIDs["encrypted-bound"]) || "20260804000000-encrypted" != boundAVIDs["encrypted-bound"][0] {
		t.Fatalf("unexpected encrypted bound block result in box %s: %#v", boxID, boundAVIDs)
	}
	if _, exists := boundAVIDs["false-positive"]; exists {
		t.Fatalf("attribute value text should not be treated as a database binding: %#v", boundAVIDs)
	}
	dirtyBoundAVIDs, queryErr := QueryBoundBlockAVIDs([]string{"", "missing"}, []string{"dirty-root"})
	if nil != queryErr || 0 != len(dirtyBoundAVIDs) {
		t.Fatalf("empty bound block IDs should be ignored: result=%#v, err=%v", dirtyBoundAVIDs, queryErr)
	}
}

func TestSelectBlocksRawStmtInBoxPaginatesExistingLimit(t *testing.T) {
	testDB, boxID := useEncryptedQueryTestDB(t)
	for i := 1; i <= 6; i++ {
		id := fmt.Sprintf("block-%02d", i)
		insertEncryptedQueryTestBlock(t, testDB, id, "", id, "d")
	}

	blocks := SelectBlocksRawStmtInBox("SELECT * FROM blocks ORDER BY id LIMIT 3", 2, 32, boxID)
	if 3 != len(blocks) {
		t.Fatalf("unexpected block count: %d", len(blocks))
	}
	for i, expected := range []string{"block-04", "block-05", "block-06"} {
		if expected != blocks[i].ID {
			t.Fatalf("unexpected block at %d: %s", i, blocks[i].ID)
		}
	}
}

func TestSelectBlocksRawStmtBoundedInBoxContext(t *testing.T) {
	testDB, boxID := useEncryptedQueryTestDB(t)
	for i := 1; i <= 3; i++ {
		id := fmt.Sprintf("block-%02d", i)
		insertEncryptedQueryTestBlock(t, testDB, id, "", id, "d")
	}

	blocks, truncated, err := SelectBlocksRawStmtBoundedInBoxContext(
		context.Background(), "SELECT * FROM blocks ORDER BY id", 2, boxID)
	if nil != err {
		t.Fatalf("bounded block query failed: %s", err)
	}
	if !truncated || 2 != len(blocks) || "block-01" != blocks[0].ID || "block-02" != blocks[1].ID {
		t.Fatalf("unexpected bounded query result: blocks=%#v truncated=%v", blocks, truncated)
	}

	blocks, truncated, err = SelectBlocksRawStmtBoundedInBoxContext(
		context.Background(), "SELECT * FROM blocks ORDER BY id", 3, boxID)
	if nil != err || truncated || 3 != len(blocks) {
		t.Fatalf("exactly bounded query should not be truncated: blocks=%#v truncated=%v err=%v", blocks, truncated, err)
	}
}

func TestQueryNoLimitInBoxContextCancellation(t *testing.T) {
	testDB, boxID := useEncryptedQueryTestDB(t)
	previousDB := db
	db = testDB
	t.Cleanup(func() {
		db = previousDB
	})

	for name, targetBoxID := range map[string]string{"global": "", "encrypted": boxID} {
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			done := make(chan error, 1)
			go func() {
				_, err := QueryNoLimitInBoxContext(ctx, `
					WITH RECURSIVE sequence(value) AS (
						VALUES(0)
						UNION ALL
						SELECT value + 1 FROM sequence WHERE value < 100000000
					)
					SELECT COUNT(*) FROM sequence`, targetBoxID)
				done <- err
			}()

			time.Sleep(10 * time.Millisecond)
			cancel()
			select {
			case err := <-done:
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("unexpected cancellation error: %v", err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("SQL query was not canceled")
			}
		})
	}
}

func TestSelectBlocksRawStmtInBoxContextCancellation(t *testing.T) {
	testDB, boxID := useEncryptedQueryTestDB(t)
	insertEncryptedQueryTestBlock(t, testDB, "block", "", "block", "d")
	previousDB := db
	db = testDB
	t.Cleanup(func() {
		db = previousDB
	})

	for name, targetBoxID := range map[string]string{"global": "", "encrypted": boxID} {
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			done := make(chan error, 1)
			go func() {
				_, err := SelectBlocksRawStmtInBoxContext(ctx, `
					WITH RECURSIVE sequence(value) AS (
						VALUES(0)
						UNION ALL
						SELECT value + 1 FROM sequence WHERE value < 100000000
					)
					SELECT blocks.* FROM blocks
					WHERE (SELECT COUNT(*) FROM sequence) > 0`, 1, 32, targetBoxID)
				done <- err
			}()

			time.Sleep(10 * time.Millisecond)
			cancel()
			select {
			case err := <-done:
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("unexpected cancellation error: %v", err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("SQL query was not canceled")
			}
		})
	}
}

func useEncryptedQueryTestDB(t *testing.T) (*gosql.DB, string) {
	t.Helper()
	testDB, err := gosql.Open("sqlite3_extended", ":memory:")
	if nil != err {
		t.Fatalf("open test database failed: %s", err)
	}
	testDB.SetMaxOpenConns(1)
	if _, err = testDB.Exec("CREATE TABLE blocks (id TEXT NOT NULL DEFAULT '', parent_id TEXT NOT NULL DEFAULT '', root_id TEXT NOT NULL DEFAULT '', hash TEXT NOT NULL DEFAULT '', box TEXT NOT NULL DEFAULT '', path TEXT NOT NULL DEFAULT '', hpath TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', alias TEXT NOT NULL DEFAULT '', memo TEXT NOT NULL DEFAULT '', tag TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', fcontent TEXT NOT NULL DEFAULT '', markdown TEXT NOT NULL DEFAULT '', length INTEGER NOT NULL DEFAULT 0, type TEXT NOT NULL DEFAULT '', subtype TEXT NOT NULL DEFAULT '', ial TEXT NOT NULL DEFAULT '', sort INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL DEFAULT '', updated TEXT NOT NULL DEFAULT '')"); nil != err {
		t.Fatalf("create blocks table failed: %s", err)
	}
	if _, err = testDB.Exec("CREATE TABLE refs (id TEXT NOT NULL DEFAULT '', def_block_id TEXT NOT NULL DEFAULT '', def_block_parent_id TEXT NOT NULL DEFAULT '', def_block_root_id TEXT NOT NULL DEFAULT '', def_block_path TEXT NOT NULL DEFAULT '', block_id TEXT NOT NULL DEFAULT '', root_id TEXT NOT NULL DEFAULT '', box TEXT NOT NULL DEFAULT '', path TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', markdown TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT '')"); nil != err {
		t.Fatalf("create refs table failed: %s", err)
	}

	boxID := t.Name()
	encryptedDBs.Store(boxID, testDB)
	t.Cleanup(func() {
		encryptedDBs.Delete(boxID)
		testDB.Close()
	})
	return testDB, boxID
}

func insertEncryptedQueryTestBlock(t *testing.T, testDB *gosql.DB, id, parentID, rootID, blockType string) {
	t.Helper()
	if _, err := testDB.Exec("INSERT INTO blocks (id, parent_id, root_id, type) VALUES (?, ?, ?, ?)", id, parentID, rootID, blockType); nil != err {
		t.Fatalf("insert block failed: %s", err)
	}
}

func insertEncryptedQueryTestRef(t *testing.T, testDB *gosql.DB, id, defBlockID, defRootID string) {
	t.Helper()
	if _, err := testDB.Exec("INSERT INTO refs (id, def_block_id, def_block_root_id, block_id, root_id) VALUES (?, ?, ?, ?, ?)",
		id, defBlockID, defRootID, id+"-source", id+"-source-root"); nil != err {
		t.Fatalf("insert ref failed: %s", err)
	}
}
