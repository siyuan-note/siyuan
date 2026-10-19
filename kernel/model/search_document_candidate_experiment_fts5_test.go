//go:build fts5

package model

import (
	gosql "database/sql"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"
)

// documentCandidateExperiment 仅用于对照实验，不参与实际搜索。
// 单个字面子串产生候选根 ID，完整查询仍负责过滤、聚合、计数及排序。
func documentCandidateExperiment(statement, needle, strategy string, hpath bool) string {
	if needle == "" || strings.ContainsAny(needle, ",%_\x00") {
		return statement
	}
	predicate := buildSearchDocumentLikeFilter(columnConcat(), []string{needle})
	if hpath {
		predicate = buildSearchDocumentLikeFilterWithHPath(columnConcat(), normalizedHPathSearchField("hpath"), []string{needle})
	}
	candidates := "SELECT root_id FROM blocks WHERE " + predicate
	if strategy == "trigram" {
		if hpath || len([]rune(needle)) < 3 {
			return statement
		}
		candidates = `SELECT root_id FROM document_candidates WHERE content MATCH '"` + strings.ReplaceAll(needle, `"`, `""`) + `"'`
	}
	return strings.Replace(statement, " FROM blocks WHERE ", " FROM blocks WHERE root_id IN ("+candidates+") AND ", 1)
}

func TestDocumentSearchCandidateScanExperimentPreservesResults(t *testing.T) {
	for _, sensitive := range []bool{false, true} {
		t.Run(fmt.Sprint(sensitive), func(t *testing.T) {
			setSearchCaseSensitive(t, sensitive)
			database := newSearchHPathTestDB(t)
			setting := "OFF"
			if sensitive {
				setting = "ON"
			}
			for _, ddl := range []string{"CREATE INDEX idx_blocks_root_id ON blocks(root_id)", "PRAGMA case_sensitive_like=" + setting} {
				if _, err := database.Exec(ddl); err != nil {
					t.Fatal(err)
				}
			}
			for _, block := range [][5]string{
				{"substring", "substring", "/Other", "malpha", "d"},
				{"body", "substring", "/Other", "beta", "p"},
				{"upper", "upper", "/Other", "ALPHA beta", "d"},
				{"path", "path", "/Projects/alpha/beta", "plain", "d"},
				{"comma", "comma", "/Other", "boundary", "d"},
				{"marker", "comma", "/Other", "marker beta", "p"},
				{"nul", "nul", "/Other", "beta\x00stop", "d"},
				{"after", "nul", "/Other", "alpha", "p"},
				{"quote", "quote", "/Other", "author's beta", "d"},
			} {
				insertSearchHPathTestBlock(t, database, block[0], block[1], block[2], block[3], block[4])
			}
			for _, hpath := range []bool{false, true} {
				for _, query := range []string{"alpha beta", "boundary,marker beta", "author's beta", "alpha %", "_ beta", "missing beta"} {
					keywords := strings.Split(strings.ReplaceAll(query, "'", "''"), " ")
					for _, typ := range []string{"(type IN ('d','p'))", "(type = 'd')"} {
						for order := 0; order < 8; order++ {
							for page := 1; page < 4; page++ {
								for _, scope := range []struct {
									filter string
									args   []any
								}{
									{},
									{" AND box = ? AND path LIKE ?", []any{"20260729120000-box000", "/substring%"}},
									{" AND id != 'body'", nil},
								} {
									statement := buildDocumentSearchStatement(query, keywords, typ, scope.filter, "", "", order, page, 2, hpath)
									args := append(append([]any{}, scope.args...), scope.args...)
									want := documentSearchRows(t, database, statement, args)
									for _, keyword := range keywords {
										candidate := documentCandidateExperiment(statement, keyword, "scan", hpath)
										if got := documentSearchRows(t, database, candidate, args); !reflect.DeepEqual(got, want) {
											t.Fatalf("candidate scan changed complete rows/count/order: query=%q hpath=%t type=%s page=%d order=%d; got=%v want=%v", query, hpath, typ, page, order, got, want)
										}
									}
								}
							}
						}
					}
				}
			}
		})
	}
}

func TestDocumentSearchCandidateIndexExperimentRejectsIncompleteRecall(t *testing.T) {
	setSearchCaseSensitive(t, false)
	database := newSearchHPathTestDB(t)
	insertSearchHPathTestBlock(t, database, "substring", "substring", "/Other", "malpha beta", "d")
	insertSearchHPathTestBlock(t, database, "fields", "fields", "/Other", "al", "d")
	if _, err := database.Exec("UPDATE blocks SET name = 'interruption', alias = 'pha beta' WHERE id = 'fields'"); err != nil {
		t.Fatal(err)
	}
	Conf.Search.Load().Name, Conf.Search.Load().Alias = false, true
	for _, ddl := range []string{
		"CREATE VIRTUAL TABLE block_candidates USING fts5(root_id UNINDEXED, content)",
		"INSERT INTO block_candidates SELECT root_id, content FROM blocks",
		"CREATE VIRTUAL TABLE document_candidates USING fts5(root_id UNINDEXED, content, tokenize='trigram')",
		"INSERT INTO document_candidates SELECT root_id, GROUP_CONCAT(content || name || alias || memo || ial || tag) FROM blocks GROUP BY root_id",
	} {
		if _, err := database.Exec(ddl); err != nil {
			t.Fatal(err)
		}
	}
	statement := buildDocumentSearchStatement("alpha beta", []string{"alpha", "beta"}, "(type = 'd')", "", "", "", 0, 1, 50, false)
	want := documentSearchRows(t, database, statement, nil)
	if len(want) != 2 {
		t.Fatalf("baseline must match substrings and enabled-field concatenation: %v", want)
	}
	words := documentSearchRows(t, database, "SELECT root_id FROM block_candidates WHERE content MATCH 'alpha'", nil)
	if len(words) != 0 {
		t.Fatalf("fixture did not demonstrate the substring recall boundary: %v", words)
	}
	got := documentSearchRows(t, database, documentCandidateExperiment(statement, "alpha", "trigram", false), nil)
	if len(got) != 1 || got[0][0] != "substring" {
		t.Fatalf("all-field trigram index must demonstrate the missing enabled-field join: %v", got)
	}
}

func newDocumentCandidateExperimentDB(b *testing.B, size int) *gosql.DB {
	b.Helper()
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
		content, typ := "common text repeated for candidate experiment", "p"
		switch i % 100 {
		case 0:
			typ = "d"
		case 1:
			content = "alpha content across blocks"
			if i < 100 {
				content += " selective"
			}
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
	return database
}

func documentCandidateExperimentBytes(b *testing.B, database *gosql.DB) int64 {
	b.Helper()
	var pages, pageSize int64
	if err := database.QueryRow("PRAGMA page_count").Scan(&pages); err != nil {
		b.Fatal(err)
	}
	if err := database.QueryRow("PRAGMA page_size").Scan(&pageSize); err != nil {
		b.Fatal(err)
	}
	return pages * pageSize
}

// BenchmarkDocumentSearchCandidates 对照无候选、扫描候选及固定字段聚合的 trigram 候选。
// 索引预先建成；其构建时间、页空间和更新成本需要与查询收益分别评估。
func BenchmarkDocumentSearchCandidates(b *testing.B) {
	setSearchCaseSensitive(b, false)
	for _, size := range []int{10000, 100000, 1000000} {
		b.Run(fmt.Sprint(size), func(b *testing.B) {
			database := newDocumentCandidateExperimentDB(b, size)
			before := documentCandidateExperimentBytes(b, database)
			start := time.Now()
			for _, ddl := range []string{
				"CREATE VIRTUAL TABLE document_candidates USING fts5(root_id UNINDEXED, content, tokenize='trigram')",
				"INSERT INTO document_candidates SELECT root_id, GROUP_CONCAT(" + columnConcat() + ") FROM blocks GROUP BY root_id",
			} {
				if _, err := database.Exec(ddl); err != nil {
					b.Fatal(err)
				}
			}
			buildMS := float64(time.Since(start).Microseconds()) / 1000
			bytes := documentCandidateExperimentBytes(b, database) - before
			for _, query := range []string{"alpha beta", "selective beta", "missing beta"} {
				keywords := strings.Split(query, " ")
				baseline := buildDocumentSearchStatement(query, keywords, "(type IN ('d','p'))", "", "", "", 0, 1, 50, false)
				want := documentSearchRows(b, database, baseline, nil)
				for _, strategy := range []string{"baseline", "scan", "trigram"} {
					statement := baseline
					if strategy != "baseline" {
						statement = documentCandidateExperiment(baseline, keywords[0], strategy, false)
					}
					if got := documentSearchRows(b, database, statement, nil); !reflect.DeepEqual(got, want) {
						b.Fatalf("%s candidate changed results for %q", strategy, query)
					}
					b.Run(strings.ReplaceAll(query, " ", "_")+"/"+strategy, func(b *testing.B) {
						b.ReportAllocs()
						for b.Loop() {
							documentSearchRows(b, database, statement, nil)
						}
						if strategy == "trigram" {
							b.ReportMetric(buildMS, "candidate_build_ms")
							b.ReportMetric(float64(bytes), "candidate_bytes")
						}
					})
				}
			}
		})
	}
}

// BenchmarkDocumentCandidateIndexWrite 测量单块 SQL 写入与附加全文档 trigram 重建的成本。
// 文档序列化、文件落盘及现有产品 FTS 写入不在此对照范围内。
func BenchmarkDocumentCandidateIndexWrite(b *testing.B) {
	setSearchCaseSensitive(b, false)
	for _, size := range []int{100, 1000, 20000} {
		b.Run(fmt.Sprint(size), func(b *testing.B) {
			database := newDocumentCandidateExperimentDB(b, size)
			for _, ddl := range []string{
				"UPDATE blocks SET root_id = 'document', type = CASE WHEN rowid = 1 THEN 'd' ELSE 'p' END",
				"CREATE VIRTUAL TABLE document_candidates USING fts5(root_id UNINDEXED, content, tokenize='trigram')",
				"INSERT INTO document_candidates SELECT root_id, GROUP_CONCAT(" + columnConcat() + ") FROM blocks GROUP BY root_id",
			} {
				if _, err := database.Exec(ddl); err != nil {
					b.Fatal(err)
				}
			}
			for _, indexed := range []bool{false, true} {
				b.Run(fmt.Sprintf("candidate=%t", indexed), func(b *testing.B) {
					var before, after int64
					if err := database.QueryRow("SELECT total_changes()").Scan(&before); err != nil {
						b.Fatal(err)
					}
					iteration := 0
					b.ReportAllocs()
					for b.Loop() {
						tx, err := database.Begin()
						if err != nil {
							b.Fatal(err)
						}
						if _, err = tx.Exec("UPDATE blocks SET content = ? WHERE rowid = 2", fmt.Sprintf("alpha changed text %d", iteration%2)); err == nil && indexed {
							if _, err = tx.Exec("DELETE FROM document_candidates WHERE root_id = 'document'"); err == nil {
								_, err = tx.Exec("INSERT INTO document_candidates SELECT root_id, GROUP_CONCAT(" + columnConcat() + ") FROM blocks WHERE root_id = 'document' GROUP BY root_id")
							}
						}
						if err != nil {
							tx.Rollback()
							b.Fatal(err)
						}
						if err = tx.Commit(); err != nil {
							b.Fatal(err)
						}
						iteration++
					}
					if err := database.QueryRow("SELECT total_changes()").Scan(&after); err != nil {
						b.Fatal(err)
					}
					b.ReportMetric(float64(after-before)/float64(b.N), "sqlite_changes/op")
				})
			}
		})
	}
}
