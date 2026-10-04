//go:build fts5

package sql

import (
	"database/sql"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func newDeletePathTestDB(t testing.TB, encrypted bool) *sql.DB {
	t.Helper()
	database, err := sql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	database.SetMaxOpenConns(1)
	t.Cleanup(func() { database.Close() })
	if encrypted {
		if err = initEncryptedDBTables(database); err != nil {
			t.Fatal(err)
		}
	} else {
		previous := db
		db = database
		defer func() { db = previous }()
		initDBTables()
	}
	return database
}

func deletePathTestTables(encrypted bool) []string {
	tables := []string{"blocks", "spans", "assets", "refs", "file_annotation_refs", "attributes"}
	if !encrypted {
		tables = append(tables, "block_embeddings")
	}
	return tables
}

func deletePathTestColumn(table string) string {
	if table == "assets" {
		return "docpath"
	}
	return "path"
}

func execDeletePathTestSQL(t testing.TB, database *sql.DB, query string, args ...any) {
	t.Helper()
	if _, err := database.Exec(query, args...); err != nil {
		t.Fatal(err)
	}
}

func TestDocumentPathDeletion(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		for _, sensitive := range []string{"OFF", "ON"} {
			t.Run(fmt.Sprintf("encrypted=%t/case=%s", encrypted, sensitive), func(t *testing.T) {
				database := newDeletePathTestDB(t, encrypted)
				execDeletePathTestSQL(t, database, "PRAGMA case_sensitive_like = "+sensitive)
				const prefix = "/20261003000000-abcdefz"
				paths := []string{prefix + ".sy", prefix + "/child.sy", prefix + "/child/grandchild.sy",
					strings.ToUpper(prefix) + ".sy", "/20261003000000-abcdega.sy", "/unrelated.sy"}
				tables := deletePathTestTables(encrypted)
				for _, table := range tables {
					column := deletePathTestColumn(table)
					for i, path := range paths {
						execDeletePathTestSQL(t, database, "INSERT INTO "+table+" (id, box, "+column+") VALUES (?, ?, ?)",
							fmt.Sprint(i), "target", path)
					}
					execDeletePathTestSQL(t, database, "INSERT INTO "+table+" (id, box, "+column+") VALUES ('other-box', 'other', ?)", prefix+".sy")
					// 模拟已有数据的旧库，补建索引不得删除数据，重复升级必须幂等。
					execDeletePathTestSQL(t, database, "DROP INDEX idx_"+table+"_box_docpath")
				}
				for range 2 {
					if err := ensureDocumentPathIndexes(database, !encrypted); err != nil {
						t.Fatal(err)
					}
				}
				execDeletePathTestSQL(t, database, "UPDATE blocks SET content = 'deletiontoken'")
				execDeletePathTestSQL(t, database, "INSERT INTO blocks_fts(blocks_fts) VALUES('rebuild')")
				if encrypted {
					encryptedDBs.Store("target", database)
					t.Cleanup(func() { encryptedDBs.Delete("target") })
				} else {
					previous := db
					db = database
					t.Cleanup(func() { db = previous })
				}
				// 同一删除操作可在恢复队列中重放，FTS 与内容表必须始终一致。
				for range 2 {
					tx, err := beginTxForBox("target")
					if err != nil {
						t.Fatal(err)
					}
					if err = execOp(&dbQueueOperation{action: "delete", removeTreeBox: "target", removeTreePath: prefix}, tx, nil); err != nil {
						tx.Rollback()
						t.Fatal(err)
					}
					if err = commitTx(tx); err != nil {
						t.Fatal(err)
					}
				}
				want := []string{"4", "5", "other-box"}
				if sensitive == "ON" {
					want = append([]string{"3"}, want...)
				}
				for _, table := range append(tables, "blocks_fts") {
					query := "SELECT id FROM " + table
					if table == "blocks_fts" {
						query += " WHERE blocks_fts MATCH 'deletiontoken'"
					}
					if got := deletePathTestIDs(t, database, query+" ORDER BY id"); !reflect.DeepEqual(got, want) {
						t.Fatalf("%s: remaining IDs %v, want %v", table, got, want)
					}
				}
				execDeletePathTestSQL(t, database, "INSERT INTO blocks_fts(blocks_fts, rank) VALUES('integrity-check', 1)")
			})
		}
	}
}

func deletePathTestIDs(t testing.TB, database *sql.DB, query string, args ...any) []string {
	t.Helper()
	rows, err := database.Query(query, args...)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	return ids
}

func TestDocumentPathPrefixCompatibility(t *testing.T) {
	database := newDeletePathTestDB(t, false)
	for i, path := range []string{"/abc.sy", "/ABC.sy", "/abz/child.sy", "/ab9.sy", "/ab_.sy", "/ab%.sy", "/中文.sy", "/other.sy"} {
		execDeletePathTestSQL(t, database, "INSERT INTO blocks (id, box, path) VALUES (?, 'box', ?)", fmt.Sprint(i), path)
	}
	for _, sensitive := range []string{"OFF", "ON"} {
		execDeletePathTestSQL(t, database, "PRAGMA case_sensitive_like = "+sensitive)
		for _, prefix := range []string{"", "/", "/ab", "/AB", "/abz", "/ab9", "/abc.", "/ab%", "/ab_", "/中文", "/a'b", "/ab\x00"} {
			want := deletePathTestIDs(t, database, "SELECT id FROM blocks WHERE box = ? AND path LIKE ? ORDER BY id", "box", prefix+"%")
			condition, args := documentPathPrefixCondition("path", "box", prefix)
			got := deletePathTestIDs(t, database, "SELECT id FROM blocks WHERE "+condition+" ORDER BY id", args...)
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("case %s, prefix %q: %v, want %v", sensitive, prefix, got, want)
			}
		}
	}
}

func TestDocumentPathDeletionQueryPlan(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		database := newDeletePathTestDB(t, encrypted)
		for _, sensitive := range []string{"OFF", "ON"} {
			execDeletePathTestSQL(t, database, "PRAGMA case_sensitive_like = "+sensitive)
			for _, table := range deletePathTestTables(encrypted) {
				column := deletePathTestColumn(table)
				condition, args := documentPathPrefixCondition(column, "box", "/20261003000000-abcdefg")
				queries := []string{"DELETE FROM " + table + " WHERE " + condition}
				if table == "blocks" {
					queries = append(queries, "DELETE FROM blocks_fts WHERE rowid IN (SELECT rowid FROM blocks WHERE "+condition+")")
				}
				for _, query := range queries {
					rows, err := database.Query("EXPLAIN QUERY PLAN "+query, args...)
					if err != nil {
						t.Fatal(err)
					}
					var plan string
					for rows.Next() {
						var id, parent, unused int
						var detail string
						if err = rows.Scan(&id, &parent, &unused, &detail); err != nil {
							t.Fatal(err)
						}
						plan += detail + "\n"
					}
					rows.Close()
					if err = rows.Err(); err != nil {
						t.Fatal(err)
					}
					if !strings.Contains(plan, "idx_"+table+"_box_docpath") || !strings.Contains(plan, column+">? AND "+column+"<?") {
						t.Fatalf("encrypted=%t case=%s: deletion lacks path range search: %s", encrypted, sensitive, plan)
					}
				}
			}
		}
	}
}

func BenchmarkDocumentPathDeletion(b *testing.B) {
	for _, indexed := range []bool{false, true} {
		b.Run(fmt.Sprintf("indexed=%t", indexed), func(b *testing.B) {
			database := newDeletePathTestDB(b, false)
			for _, table := range deletePathTestTables(false) {
				column := deletePathTestColumn(table)
				execDeletePathTestSQL(b, database, "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x < 200000) "+
					"INSERT INTO "+table+" (id, box, "+column+") SELECT printf('%d', x), 'box', printf('/seed/%d.sy', x) FROM n")
				execDeletePathTestSQL(b, database, "INSERT INTO "+table+" (id, box, "+column+") VALUES ('target', 'box', '/target.sy'), ('child', 'box', '/target/child.sy')")
				if !indexed {
					execDeletePathTestSQL(b, database, "DROP INDEX idx_"+table+"_box_docpath")
				}
			}
			execDeletePathTestSQL(b, database, "UPDATE blocks SET content = 'deletiontoken'")
			execDeletePathTestSQL(b, database, "INSERT INTO blocks_fts(blocks_fts) VALUES('rebuild')")
			b.ResetTimer()
			for range b.N {
				tx, err := database.Begin()
				if err != nil {
					b.Fatal(err)
				}
				if indexed {
					err = execOp(&dbQueueOperation{action: "delete", removeTreeBox: "box", removeTreePath: "/target"}, tx, nil)
				} else {
					_, err = tx.Exec("DELETE FROM blocks_fts WHERE rowid IN (SELECT rowid FROM blocks WHERE box = ? AND path LIKE ?)", "box", "/target%")
					for _, table := range deletePathTestTables(false) {
						if err != nil {
							break
						}
						_, err = tx.Exec("DELETE FROM "+table+" WHERE box = ? AND "+deletePathTestColumn(table)+" LIKE ?", "box", "/target%")
					}
					ClearCache()
				}
				rollbackErr := tx.Rollback()
				if err != nil || rollbackErr != nil {
					b.Fatalf("delete: %v; rollback: %v", err, rollbackErr)
				}
			}
		})
	}
}
