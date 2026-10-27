// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	gosql "database/sql"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestDocumentTypeFilterFromSettings(t *testing.T) {
	setSearchCaseSensitive(t, false)
	Conf.Search.Store(&conf.Search{Document: true, Mindmap: new(false), MindmapItem: new(false), CustomBlock: new(false)})
	if got := buildTypeFilter(nil, nil); got != "(type = 'd')" {
		t.Fatalf("document-only settings: %s", got)
	}
	Conf.Search.Load().Paragraph = true
	if got := buildTypeFilter(nil, nil); got != "(type IN ('d','p'))" {
		t.Fatalf("mixed settings: %s", got)
	}
}

func TestDocumentSearchLiteralSpecialCharacters(t *testing.T) {
	for _, sensitive := range []bool{false, true} {
		for _, tc := range []struct{ name, query, other string }{
			{"percent", "100% efficiency", "100X efficiency"},
			{"underscore", "snake_case token", "snakeXcase token"},
			{"backslash", `C:\notes token`, "C:notes token"},
			{"quote", "reader's choice", "readers choice"},
			{"consecutive quotes", "reader''s choice", "reader's choice"},
		} {
			for _, pathOnly := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/case=%t/path=%t", tc.name, sensitive, pathOnly), func(t *testing.T) {
					setSearchCaseSensitive(t, sensitive)
					database := newSearchHPathTestDB(t)
					setting := "OFF"
					if sensitive {
						setting = "ON"
					}
					if _, err := database.Exec("PRAGMA case_sensitive_like = " + setting); err != nil {
						t.Fatal(err)
					}
					for _, doc := range []struct{ id, content string }{{"literal", tc.query}, {"wildcard", tc.other}} {
						content, hpath := doc.content, "/Unrelated"
						if pathOnly {
							content, hpath = "Unrelated", "/"+doc.content
						}
						insertSearchHPathTestBlock(t, database, doc.id, doc.id, hpath, content, "d")
					}
					keywords := strings.Split(strings.ReplaceAll(tc.query, "'", "''"), " ")
					statement := buildDocumentSearchStatement(tc.query, keywords, "type = 'd'", "", "", "", 0, 1, 32, pathOnly)
					rows := documentSearchRows(t, database, statement, nil)
					if len(rows) != 1 || rows[0][0] != "literal" {
						t.Fatalf("expected only literal match, got %v", rows)
					}
					if !pathOnly {
						var score int
						if err := database.QueryRow("SELECT " + buildDocumentMatchScore("content", keywords) + " FROM blocks WHERE id = 'wildcard'").Scan(&score); err != nil {
							t.Fatal(err)
						}
						if score != 1 {
							t.Fatalf("nonliteral keyword affected relevance score: %d", score)
						}
					}
				})
			}
		}
	}
}

func documentSearchRows(t testing.TB, database *gosql.DB, statement string, args []any) [][]any {
	t.Helper()
	rows, err := database.Query(statement, args...)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		t.Fatal(err)
	}
	var result [][]any
	for rows.Next() {
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err = rows.Scan(pointers...); err != nil {
			t.Fatal(err)
		}
		for i, value := range values {
			if bytes, ok := value.([]byte); ok {
				values[i] = string(bytes)
			}
		}
		result = append(result, values)
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	return result
}

// BenchmarkDocumentSearch 固定每篇 100 块、跨块双词命中和 50 篇分页，测量热内存库查询及精确计数。
func BenchmarkDocumentSearch(b *testing.B) {
	setSearchCaseSensitive(b, false)
	for _, size := range []int{10000, 100000, 1000000} {
		b.Run(fmt.Sprint(size), func(b *testing.B) {
			database := newSearchHPathTestDB(b)
			if _, err := database.Exec("CREATE INDEX idx_blocks_root_id ON blocks(root_id)"); err != nil {
				b.Fatal(err)
			}
			tx, err := database.Begin()
			if err != nil {
				b.Fatal(err)
			}
			defer tx.Rollback()
			insert, err := tx.Prepare("INSERT INTO blocks VALUES (?, '', ?, '', '20261019000000-box0001', ?, '', '', '', '', '', ?, '', '', 32, ?, '', '', 0, '20261019000000', '20261019000000')")
			if err != nil {
				b.Fatal(err)
			}
			defer insert.Close()
			for i := range size {
				rootID := fmt.Sprintf("20261019000000-%07d", (i/100)*100)
				content, typ := "common text repeated for baseline", "p"
				switch i % 100 {
				case 0:
					typ = "d"
				case 1:
					content = "alpha content across blocks"
				case 2:
					content = "beta content across blocks"
				}
				if _, err = insert.Exec(fmt.Sprintf("20261019000000-%07d", i), rootID, "/"+rootID+".sy", content, typ); err != nil {
					b.Fatal(err)
				}
			}
			if err = tx.Commit(); err != nil {
				b.Fatal(err)
			}
			statement := buildDocumentSearchStatement("alpha beta", []string{"alpha", "beta"}, "(type IN ('d','p'))", "", "", "", 0, 1, 50, false)
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				rows := documentSearchRows(b, database, statement, nil)
				if len(rows) != 50 {
					b.Fatalf("expected 50 documents matching keywords across blocks, got %d", len(rows))
				}
			}
			b.ReportMetric(float64(size), "blocks/op")
		})
	}
}

func TestDocumentSearchPartialIndexResults(t *testing.T) {
	for _, sensitive := range []bool{false, true} {
		t.Run(fmt.Sprintf("case=%t", sensitive), func(t *testing.T) {
			setSearchCaseSensitive(t, sensitive)
			database := newSearchHPathTestDB(t)
			for _, ddl := range []string{
				"CREATE INDEX idx_blocks_root_id ON blocks(root_id)",
				"CREATE INDEX idx_blocks_doc_hpath ON blocks(hpath) WHERE type = 'd'",
				"CREATE INDEX idx_blocks_recent_d ON blocks(updated DESC) WHERE type = 'd'",
			} {
				if _, err := database.Exec(ddl); err != nil {
					t.Fatal(err)
				}
			}
			setting := "OFF"
			if sensitive {
				setting = "ON"
			}
			if _, err := database.Exec("PRAGMA case_sensitive_like = " + setting); err != nil {
				t.Fatal(err)
			}
			for i, block := range [][5]string{
				{"release", "release", "/Projects/Release", "release notes", "d"},
				{"upper", "upper", "/Projects/Upper", "RELEASE NOTES", "d"},
				{"path", "path", "/Projects/release/notes", "path match", "d"},
				{"body", "path", "/Projects/release/notes", "body exclusive", "p"},
				{"quoted", "quoted", "/Other", "author's release", "d"},
				{"comma", "comma", "/Other", "boundary", "d"},
				{"comma", "comma", "/Other", "marker", "d"},
				{"nul", "nul", "/Other", "release\x00notes", "d"},
			} {
				insertSearchHPathTestBlock(t, database, block[0], block[1], block[2], block[3], block[4])
				if _, err := database.Exec("UPDATE blocks SET created = ?, updated = ?, sort = ? WHERE rowid = ?",
					fmt.Sprintf("202610100000%02d", i), fmt.Sprintf("202610100000%02d", 20-i), i, i+1); err != nil {
					t.Fatal(err)
				}
			}
			type comparison struct {
				statement string
				args      []any
				rows      [][]any
			}
			var comparisons []comparison
			// 对照结果在补建索引之前读取，包含完整投影、统计值及分页顺序。
			for _, hpath := range []bool{false, true} {
				for _, query := range []string{"release notes", "body exclusive", "author's release", "boundary,marker", "release %", "_ notes", "missing words"} {
					keywords := strings.Split(strings.ReplaceAll(query, "'", "''"), " ")
					for order := 0; order <= 7; order++ {
						for page := 1; page <= 3; page++ {
							for _, scope := range []struct {
								box, path, ignore string
								args              []any
							}{
								{},
								{box: " AND box = ?", path: " AND path LIKE ?", args: []any{"20260729120000-box000", "/release%"}},
								{ignore: " AND id != 'release'"},
							} {
								args := append(append([]any{}, scope.args...), scope.args...)
								oldStatement := buildDocumentSearchStatement(query, keywords, "(type IN ('d'))", scope.box, scope.path, scope.ignore, order, page, 2, hpath)
								newStatement := buildDocumentSearchStatement(query, keywords, buildTypeFilter(map[string]bool{"document": true}, nil), scope.box, scope.path, scope.ignore, order, page, 2, hpath)
								want := documentSearchRows(t, database, oldStatement, args)
								if query == "release notes" && page == 1 && scope.box == "" && scope.ignore == "" && len(want) == 0 {
									t.Fatal("matching document missing from baseline")
								}
								comparisons = append(comparisons, comparison{newStatement, args, want})
							}
						}
					}
				}
			}
			if _, err := database.Exec("CREATE INDEX idx_blocks_doc_root_id ON blocks(root_id) WHERE type = 'd'"); err != nil {
				t.Fatal(err)
			}
			for _, c := range comparisons {
				if got := documentSearchRows(t, database, c.statement, c.args); !reflect.DeepEqual(got, c.rows) {
					t.Fatalf("search result changed: got %v, want %v; query=%s", got, c.rows, c.statement)
				}
			}
			for _, hpath := range []bool{false, true} {
				statement := buildDocumentSearchStatement("release notes", []string{"release", "notes"}, buildTypeFilter(map[string]bool{"document": true}, nil), "", "", "", 0, 1, 32, hpath)
				plan := documentSearchRows(t, database, "EXPLAIN QUERY PLAN "+statement, nil)
				indexed := 0
				for _, row := range plan {
					detail := row[3].(string)
					if strings.Contains(detail, "USING INDEX idx_blocks_doc_root_id") {
						indexed++
					}
					if strings.Contains(detail, "SCAN blocks USING INDEX idx_blocks_root_id") {
						t.Fatalf("document search scans unrelated blocks: %v", plan)
					}
				}
				if indexed < 2 {
					t.Fatalf("aggregation and result lookup must use the document index: %v", plan)
				}
			}
		})
	}
}
