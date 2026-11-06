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
	"github.com/siyuan-note/siyuan/kernel/sql"
)

func newDocumentSearchTestDB(t testing.TB) *gosql.DB {
	t.Helper()
	database := newSearchHPathTestDB(t)
	if _, err := database.Exec("CREATE INDEX idx_blocks_search_metadata_root_id ON blocks(root_id) WHERE " + sql.BlockSearchMetadataPredicate); err != nil {
		t.Fatal(err)
	}
	tokenizer := "siyuan"
	if !Conf.LoadSearch().CaseSensitive {
		tokenizer += " case_insensitive"
	}
	if !Conf.LoadSearch().HanSensitiveVal() {
		tokenizer += " han_insensitive"
	}
	_, err := database.Exec("CREATE VIRTUAL TABLE blocks_fts USING fts5(root_id UNINDEXED, content, name, alias, memo, ial, tag, content='blocks', content_rowid='rowid', tokenize='" + tokenizer + "')")
	if err != nil {
		if strings.Contains(err.Error(), "no such module: fts5") {
			t.Skip("document search requires the fts5 build tag")
		}
		t.Fatal(err)
	}
	for _, statement := range []string{
		"CREATE TRIGGER blocks_ai AFTER INSERT ON blocks BEGIN INSERT INTO blocks_fts(rowid, root_id, content, name, alias, memo, ial, tag) VALUES(new.rowid, new.root_id, new.content, new.name, new.alias, new.memo, new.ial, new.tag); END",
		"CREATE TRIGGER blocks_au AFTER UPDATE ON blocks BEGIN INSERT INTO blocks_fts(blocks_fts, rowid, root_id, content, name, alias, memo, ial, tag) VALUES('delete', old.rowid, old.root_id, old.content, old.name, old.alias, old.memo, old.ial, old.tag); INSERT INTO blocks_fts(rowid, root_id, content, name, alias, memo, ial, tag) VALUES(new.rowid, new.root_id, new.content, new.name, new.alias, new.memo, new.ial, new.tag); END",
	} {
		if _, err = database.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	return database
}

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
					database := newDocumentSearchTestDB(t)
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
			database := newDocumentSearchTestDB(b)
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
			baseline := withoutDocumentSearchCandidates(statement, []string{"alpha", "beta"}, "(type IN ('d','p'))", false)
			for _, entry := range []struct{ name, statement string }{{"baseline", baseline}, {"indexed", statement}} {
				b.Run(entry.name, func(b *testing.B) {
					b.ReportAllocs()
					b.ResetTimer()
					for i := 0; i < b.N; i++ {
						rows := documentSearchRows(b, database, entry.statement, nil)
						if len(rows) != 50 {
							b.Fatalf("expected 50 documents matching keywords across blocks, got %d", len(rows))
						}
					}
					b.ReportMetric(float64(size), "blocks/op")
				})
			}
		})
	}
}

func TestDocumentSearchPartialIndexResults(t *testing.T) {
	for _, sensitive := range []bool{false, true} {
		t.Run(fmt.Sprintf("case=%t", sensitive), func(t *testing.T) {
			setSearchCaseSensitive(t, sensitive)
			database := newDocumentSearchTestDB(t)
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

func TestDocumentSearchFTSCandidatesPreserveResults(t *testing.T) {
	for _, sensitive := range []bool{false, true} {
		t.Run(fmt.Sprint(sensitive), func(t *testing.T) {
			setSearchCaseSensitive(t, sensitive)
			Conf.LoadSearch().Name, Conf.LoadSearch().Alias, Conf.LoadSearch().Memo, Conf.LoadSearch().IAL = true, true, true, true
			database := newDocumentSearchTestDB(t)
			setting := "OFF"
			if sensitive {
				setting = "ON"
			}
			if _, err := database.Exec("PRAGMA case_sensitive_like = " + setting + "; CREATE INDEX idx_blocks_root_id ON blocks(root_id)"); err != nil {
				t.Fatal(err)
			}
			for _, block := range [][5]string{
				{"cross", "cross", "/Planning", "Planning", "d"},
				{"meeting", "cross", "/Planning", "meeting", "p"},
				{"records", "cross", "/Planning", "records", "p"},
				{"substring", "substring", "/Alphabet", "alphabet", "d"},
				{"fields", "fields", "/Unrelated", "cross", "d"},
				{"ial", "ial", "/IAL", "cross", "d"},
				{"commas", "commas", "/Comma", "Comma", "d"},
				{"end", "commas", "/Comma", "end", "p"},
				{"start", "commas", "/Comma", "start", "p"},
				{"token", "commas", "/Comma", "token", "p"},
				{"quotes", "quotes", "/Quote", "reader's choice", "d"},
				{"path", "path", "/Ancestor/Meeting", "bodyword", "d"},
				{"upper", "upper", "/Upper", "MEETING RECORDS", "d"},
				{"unicode", "unicode", "/Unicode", "École notes", "d"},
				{"literal", "literal", "/Literal", "100% snake_case C:\\notes", "d"},
				{"han", "han", "/Han", "会议记录", "d"},
			} {
				insertSearchHPathTestBlock(t, database, block[0], block[1], block[2], block[3], block[4])
			}
			if _, err := database.Exec("UPDATE blocks SET alias = 'field' WHERE id = 'fields'"); err != nil {
				t.Fatal(err)
			}
			if _, err := database.Exec("UPDATE blocks SET ial = 'attribute' WHERE id = 'ial'"); err != nil {
				t.Fatal(err)
			}
			queries := []string{"meet rec", "pha bet", "crossf ield", "end,start token", "reader's choice",
				"Ancestor bodyword", "école notes", "100% snake_case", `C:\notes 100%`, "会议 记录", "会议  记录", "missing words", "end,start body,word", "crossattri bute"}
			for _, query := range queries {
				keywords := strings.Split(strings.ReplaceAll(query, "'", "''"), " ")
				for _, hpath := range []bool{false, true} {
					for _, filter := range []string{"(type IN ('d','p'))", "type = 'd'"} {
						for order := 0; order <= 7; order++ {
							for page := 1; page <= 3; page++ {
								statement := buildDocumentSearchStatement(query, keywords, filter, " AND box = ?", " AND path LIKE ?", " AND id != 'ignored'", order, page, 2, hpath)
								baseline := withoutDocumentSearchCandidates(statement, keywords, filter, hpath)
								args := []any{"20260729120000-box000", "%", "20260729120000-box000", "%"}
								want := documentSearchRows(t, database, baseline, args)
								got := documentSearchRows(t, database, statement, args)
								if !reflect.DeepEqual(got, want) {
									t.Fatalf("candidate filter changed %q (path=%t, filter=%s, order=%d, page=%d): got %v, want %v", query, hpath, filter, order, page, got, want)
								}
							}
						}
					}
				}
			}
			Conf.LoadSearch().IAL = false
			statement := buildDocumentSearchStatement("meet rec", []string{"meet", "rec"}, "(type IN ('d','p'))", "", "", "", 0, 1, 50, false)
			rows := documentSearchRows(t, database, statement, nil)
			foundCrossBlock := false
			for _, row := range rows {
				foundCrossBlock = foundCrossBlock || row[0] == "cross"
			}
			if !foundCrossBlock {
				t.Fatalf("cross-block substring match missing: %v", rows)
			}
			plan := documentSearchRows(t, database, "EXPLAIN QUERY PLAN "+statement, nil)
			if !strings.Contains(fmt.Sprint(plan), "SCAN blocks_fts VIRTUAL TABLE INDEX") ||
				!strings.Contains(fmt.Sprint(plan), "SEARCH blocks USING INDEX idx_blocks_root_id (root_id=?)") ||
				!strings.Contains(fmt.Sprint(plan), "idx_blocks_search_metadata_root_id") {
				t.Fatalf("FTS candidates must drive indexed document lookup: %v", plan)
			}
		})
	}
}

func withoutDocumentSearchCandidates(statement string, keywords []string, typeFilter string, hpath bool) string {
	if candidates := buildDocumentSearchCandidates(keywords, typeFilter, hpath); candidates != "" {
		return strings.Replace(statement, " AND root_id IN ("+candidates+")", "", 1)
	}
	return statement
}

func BenchmarkDocumentSearchSparseCandidates(b *testing.B) {
	setSearchCaseSensitive(b, false)
	for _, size := range []int{10000, 100000} {
		b.Run(fmt.Sprint(size), func(b *testing.B) {
			database := newDocumentSearchTestDB(b)
			if _, err := database.Exec("CREATE INDEX idx_blocks_root_id ON blocks(root_id)"); err != nil {
				b.Fatal(err)
			}
			tx, err := database.Begin()
			if err != nil {
				b.Fatal(err)
			}
			defer tx.Rollback()
			insert, err := tx.Prepare("INSERT INTO blocks VALUES (?, '', ?, '', '20261019000000-box0001', ?, '', '', '', '', '', ?, '', '', 512, ?, '', '{: id=\"fixture\" updated=\"20261019000000\"}', 0, '20261019000000', '20261019000000')")
			if err != nil {
				b.Fatal(err)
			}
			defer insert.Close()
			for i := range size {
				root := fmt.Sprintf("doc-%07d", i/100)
				id := fmt.Sprintf("block-%07d", i)
				content, typ := strings.Repeat("普通笔记正文包含日常工作和项目安排以及其他内容 ", 8), "p"
				if i%100 == 0 {
					typ = "d"
					id = root
				}
				if i%10000 == 1 {
					content = "会议"
				} else if i%10000 == 2 {
					content = "记录"
				}
				if _, err = insert.Exec(id, root, "/"+root+".sy", content, typ); err != nil {
					b.Fatal(err)
				}
			}
			if err = tx.Commit(); err != nil {
				b.Fatal(err)
			}
			keywords := []string{"会议", "记录"}
			optimized := buildDocumentSearchStatement("会议 记录", keywords, "(type IN ('d','p'))", "", "", "", 0, 1, 50, false)
			baseline := withoutDocumentSearchCandidates(optimized, keywords, "(type IN ('d','p'))", false)
			for _, entry := range []struct{ name, statement string }{{"baseline", baseline}, {"indexed", optimized}} {
				b.Run(entry.name, func(b *testing.B) {
					b.ReportAllocs()
					b.ResetTimer()
					for i := 0; i < b.N; i++ {
						rows := documentSearchRows(b, database, entry.statement, nil)
						if len(rows) != size/10000 {
							b.Fatalf("unexpected matching document count: %d", len(rows))
						}
					}
				})
			}
		})
	}
}
