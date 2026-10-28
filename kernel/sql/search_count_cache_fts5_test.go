// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package sql

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
	"unsafe"

	"github.com/88250/lute/parse"
	"github.com/mattn/go-sqlite3"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const ftsCountTestFields = "id,parent_id,root_id,hash,box,path,hpath,name,alias,memo,tag,content,fcontent,markdown,length,type,subtype,ial,sort,created,updated"
const ftsCountTestStatement = "SELECT " + ftsCountTestFields + " FROM blocks_fts WHERE blocks_fts MATCH ? ORDER BY id LIMIT 1"
const ftsCountTestCount = "SELECT COUNT(id) + observe_fts_count(), COUNT(DISTINCT root_id) FROM blocks_fts WHERE blocks_fts MATCH ?"

func prepareFTSCountCacheTest(t *testing.T, disk bool) (*sql.DB, *parse.Tree, *atomic.Int64, string) {
	t.Helper()
	previousDB, previousDisabled, previousDir := db, cacheDisabled, util.DataDir
	previousCached, previousIgnore := IndexIgnoreCached, indexIgnore
	cacheDisabled, util.DataDir, IndexIgnoreCached, indexIgnore = true, t.TempDir(), true, nil
	path := ""
	if disk {
		path = filepath.Join(t.TempDir(), "search.db")
		var err error
		db, err = sql.Open("sqlite3_extended", path+"?_journal_mode=WAL&_busy_timeout=1000")
		if err != nil {
			t.Fatal(err)
		}
		db.SetMaxOpenConns(1)
		initDBTables()
		opened := db
		t.Cleanup(func() { opened.Close() })
	} else {
		db = newDeletePathTestDB(t, false)
	}
	t.Cleanup(func() {
		db, cacheDisabled, util.DataDir = previousDB, previousDisabled, previousDir
		IndexIgnoreCached, indexIgnore = previousCached, previousIgnore
		ClearCache()
	})
	database := db
	tree := newUpsertTestTree(6)
	tx, err := database.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if err = indexTree(tx, tree, nil); err == nil {
		err = commitTx(tx)
	}
	if err != nil {
		t.Fatal(err)
	}
	calls := &atomic.Int64{}
	connection, err := database.Conn(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	err = connection.Raw(func(raw any) error {
		return raw.(*sqlite3.SQLiteConn).RegisterFunc("observe_fts_count", func() int64 { calls.Add(1); return 0 }, false)
	})
	connection.Close()
	if err != nil {
		t.Fatal(err)
	}
	clearFTSCountCache()
	return database, tree, calls, path
}

func TestFTSCountCacheTracksOwnCommitsRollbackAndArguments(t *testing.T) {
	database, tree, calls, _ := prepareFTSCountCacheTest(t, false)
	query := func(statement, term string, want int) {
		t.Helper()
		_, matches, docs, err := SelectFTSBlocksWithCountContext(context.Background(), statement, ftsCountTestCount, []any{"content:(" + term + ")"})
		if err != nil || matches != want || docs != min(want, 1) {
			t.Fatalf("incorrect exact count: %d/%d, want %d, err=%v", matches, docs, want, err)
		}
	}
	query(ftsCountTestStatement, "original", 6)
	query(ftsCountTestStatement+" OFFSET 1", "original", 6)
	if calls.Load() != 1 {
		t.Fatal("pagination did not reuse the exact count")
	}
	write := func(commit bool) {
		t.Helper()
		tx, err := database.Begin()
		if err != nil {
			t.Fatal(err)
		}
		if err = insertBlocks(tx, []*Block{{ID: fmt.Sprint(calls.Load()), RootID: tree.ID, Content: "original new row", Type: "p"}}, nil); err != nil {
			t.Fatal(err)
		}
		if commit {
			err = commitTx(tx)
		} else {
			err = tx.Rollback()
			closeTxPreparedStmts(tx)
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	write(true)
	query(ftsCountTestStatement, "original", 7)
	write(false)
	query(ftsCountTestStatement, "original", 7)
	query(ftsCountTestStatement, "missing", 0)
	query(ftsCountTestStatement+" OFFSET 2", "missing", 0)
	if calls.Load() != 4 {
		t.Fatalf("wrong version/argument reuse: %d count queries", calls.Load())
	}
	ClearCache()
	query(ftsCountTestStatement, "original", 7)
	if calls.Load() != 5 {
		t.Fatal("explicit invalidation reused an old count")
	}
}

func TestFTSCountSnapshotSurvivesConcurrentCommit(t *testing.T) {
	for _, boundary := range []string{"before snapshot", "before version confirmation", "during row read"} {
		t.Run(boundary, func(t *testing.T) {
			database, tree, _, path := prepareFTSCountCacheTest(t, true)
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			args := []any{"content:(original)"}
			if _, matches, _, err := SelectFTSBlocksWithCountContext(ctx, ftsCountTestStatement, ftsCountTestCount, args); err != nil || matches != 6 {
				t.Fatalf("warm snapshot: %d, %v", matches, err)
			}
			ready, resume := make(chan struct{}), make(chan struct{})
			var release sync.Once
			defer release.Do(func() { close(resume) })
			connection, err := database.Conn(ctx)
			if err != nil {
				t.Fatal(err)
			}
			statement := ftsCountTestStatement
			err = connection.Raw(func(raw any) error {
				native := raw.(*sqlite3.SQLiteConn)
				if boundary == "before version confirmation" || boundary == "before snapshot" {
					var invocations int
					native.RegisterAuthorizer(func(operation int, name, _, _ string) int {
						if boundary == "before snapshot" && operation == sqlite3.SQLITE_TRANSACTION && name == "BEGIN" ||
							boundary == "before version confirmation" && operation == sqlite3.SQLITE_PRAGMA && name == "data_version" {
							invocations++
							if boundary == "before snapshot" && invocations == 1 || boundary == "before version confirmation" && invocations == 2 {
								close(ready)
								<-resume
							}
						}
						return 0
					})
					return nil
				}
				statement = strings.Replace(statement, "content,fcontent", "content || hold_fts_snapshot(),fcontent", 1)
				return native.RegisterFunc("hold_fts_snapshot", func() string { close(ready); <-resume; return "" }, false)
			})
			connection.Close()
			if err != nil {
				t.Fatal(err)
			}
			result := make(chan error, 1)
			go func() {
				_, matches, docs, err := SelectFTSBlocksWithCountContext(ctx, statement, ftsCountTestCount, args)
				want := 6
				if boundary == "before snapshot" {
					want = 7
				}
				if err == nil && (matches != want || docs != 1) {
					err = fmt.Errorf("snapshot mixed old rows with new count: %d/%d", matches, docs)
				}
				result <- err
			}()
			select {
			case <-ready:
			case <-ctx.Done():
				t.Fatal("reader did not reach the commit boundary")
			}
			writer, err := sql.Open("sqlite3_extended", path+"?_journal_mode=WAL&_busy_timeout=1000")
			if err != nil {
				t.Fatal(err)
			}
			tx, err := writer.Begin()
			if err == nil {
				err = insertBlocks(tx, []*Block{{ID: "external", RootID: tree.ID, Type: "p", Content: "original external row"}}, nil)
			}
			if err == nil {
				err = commitTx(tx)
			}
			writer.Close()
			release.Do(func() { close(resume) })
			if err != nil {
				t.Fatal(err)
			}
			if err = <-result; err != nil {
				t.Fatal(err)
			}
			if _, matches, _, err := SelectFTSBlocksWithCountContext(ctx, ftsCountTestStatement, ftsCountTestCount, args); err != nil || matches != 7 {
				t.Fatalf("new snapshot reused a stale exact count: %d, %v", matches, err)
			}
		})
	}
}

func TestFTSCountCacheIsolatesCountSQLAndSkipsNonStringArguments(t *testing.T) {
	_, _, calls, _ := prepareFTSCountCacheTest(t, false)
	ctx := context.Background()
	args := []any{"content:(original)"}
	if _, matches, _, err := SelectFTSBlocksWithCountContext(ctx, ftsCountTestStatement, ftsCountTestCount, args); err != nil || matches != 6 {
		t.Fatalf("initial count: %d, %v", matches, err)
	}
	if _, matches, _, err := SelectFTSBlocksWithCountContext(ctx, ftsCountTestStatement,
		ftsCountTestCount+" AND type='d'", args); err != nil || matches != 0 {
		t.Fatalf("different count SQL reused a previous scope: %d, %v", matches, err)
	}
	query := strings.Replace(ftsCountTestStatement, " ORDER BY", " AND ?=1 ORDER BY", 1)
	for range 2 {
		if _, matches, _, err := SelectFTSBlocksWithCountContext(ctx, query, ftsCountTestCount+" AND ?=1", append(args, 1)); err != nil || matches != 6 {
			t.Fatalf("uncacheable argument changed exact results: %d, %v", matches, err)
		}
	}
	if calls.Load() != 4 {
		t.Fatalf("count SQL or argument type was ignored: %d calls", calls.Load())
	}
}

func TestFTSCountCacheCancellationBudgetAndStaleAdmission(t *testing.T) {
	database, _, _, _ := prepareFTSCountCacheTest(t, false)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, _, err := SelectFTSBlocksWithCountContext(ctx, ftsCountTestStatement, ftsCountTestCount, []any{"original"}); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled read: %v", err)
	}
	if err := database.Ping(); err != nil {
		t.Fatal("canceled search did not release its connection")
	}
	deadline, stop := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer stop()
	heavyCount := "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<100000000) SELECT COUNT(*),1 FROM n WHERE ? IS NOT NULL"
	if _, _, _, err := SelectFTSBlocksWithCountContext(deadline, ftsCountTestStatement, heavyCount, []any{"original"}); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("running count was not interrupted: %v", err)
	}
	reuse, release := context.WithTimeout(context.Background(), time.Second)
	defer release()
	if err := database.PingContext(reuse); err != nil {
		t.Fatalf("interrupted count left its connection occupied: %v", err)
	}
	if unsafe.Sizeof(ftsCounts) > 128*1024 {
		t.Fatal("fixed cache storage exceeded the byte budget")
	}
	generation := ftsCountGeneration()
	key := ftsCountKey{database: database, query: sha256.Sum256([]byte("scope"))}
	clearFTSCountCache()
	setFTSCount(key, generation, 10, 1)
	if _, _, found := getFTSCount(key, ftsCountGeneration()); found {
		t.Fatal("old request repopulated a new cache generation")
	}
}
