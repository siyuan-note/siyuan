// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	gosql "database/sql"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"text/template"

	"github.com/siyuan-note/logging"
)

func TestTagSpanQueriesIgnoreExtraColumns(t *testing.T) {
	for _, extended := range []bool{false, true} {
		name := "standard"
		if extended {
			name = "extra columns"
		}
		t.Run(name, func(t *testing.T) {
			testDB := useSpanTestDB(t)
			if extended {
				for _, column := range []string{"extra1", "extra2", "extra3"} {
					if _, err := testDB.Exec("ALTER TABLE spans ADD COLUMN " + column + " TEXT"); err != nil {
						t.Fatal(err)
					}
				}
			}
			for _, query := range tagSpanTestQueries() {
				t.Run(query.name, func(t *testing.T) {
					assertSpanTestResult(t, query.run())
				})
			}
			if _, err := testDB.Exec("UPDATE spans SET content = ''"); err != nil {
				t.Fatal(err)
			}
			if spans := QueryTagSpansByLabel(""); len(spans) != 1 || spans[0] == nil || spans[0].ID != "span" || spans[0].Content != "" {
				t.Errorf("unexpected empty-label results: %#v", spans)
			}
		})
	}
}

func TestSpanQueriesSkipInvalidRows(t *testing.T) {
	testDB := useSpanTestDB(t)
	// 无效行分别位于有效行之前和之后，不能污染返回值或中断剩余行扫描。
	if _, err := testDB.Exec("INSERT INTO spans SELECT 'a-invalid', 'a-invalid', root_id, box, path, content, '#invalid-a#', type, NULL FROM spans; INSERT INTO spans SELECT 'z-invalid', 'z-invalid', root_id, box, path, content, '#invalid-z#', type, NULL FROM spans WHERE id = 'span'"); err != nil {
		t.Fatal(err)
	}
	logPath := useSpanTestLog(t)
	queries := append(tagSpanTestQueries(), struct {
		name string
		run  func() []*Span
	}{"SelectSpansRawStmt", func() []*Span {
		return SelectSpansRawStmt("SELECT * FROM spans ORDER BY id", 100)
	}})
	for _, query := range queries {
		t.Run(query.name, func(t *testing.T) {
			assertSpanTestResult(t, query.run())
		})
	}
	data, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Count(string(data), "span query ["); got != len(queries) {
		t.Fatalf("want one scan diagnostic per query, got %d: %s", got, data)
	}
}

func TestSpanTemplateQueriesValidateProjection(t *testing.T) {
	for _, scope := range []string{"global", "encrypted box"} {
		t.Run(scope, func(t *testing.T) {
			var testDB *gosql.DB
			var boxIDs []string
			source := "SelectSpansRawStmt"
			if scope == "global" {
				testDB = useSpanTestDB(t)
			} else {
				var boxID string
				testDB, boxID = useEncryptedQueryTestDB(t)
				createSpanTestTable(t, testDB)
				boxIDs = []string{boxID}
				source += "InBox"
			}
			if _, err := testDB.Exec("INSERT INTO spans SELECT 'second', block_id, root_id, box, path, content, markdown, type, ial FROM spans"); err != nil {
				t.Fatal(err)
			}
			logPath := useSpanTestLog(t)
			funcs := template.FuncMap{}
			SQLTemplateFuncs(&funcs, boxIDs...)
			querySpans := funcs["querySpans"].(func(string, ...string) []*Span)
			assertSpanTestResult(t, querySpans("SELECT * FROM spans WHERE id = 'span' LIMIT ?", "1"))
			for _, stmt := range []string{
				"SELECT spans.*, 'private-query-marker' AS extra1, 2 AS extra2, 3 AS extra3 FROM spans",
				"SELECT spans.*, 1 AS extra1, 2 AS extra2, 3 AS extra3 FROM spans WHERE 0",
				"SELECT id FROM spans",
			} {
				if got := querySpans(stmt); len(got) != 0 {
					t.Errorf("incompatible projection returned span entries: %#v", got)
				}
			}
			assertSpanTestResult(t, querySpans("SELECT * FROM spans WHERE id = 'span'"))
			data, err := os.ReadFile(logPath)
			if err != nil {
				t.Fatal(err)
			}
			log := strings.ReplaceAll(string(data), "\r\n", "\n")
			if strings.Count(log, "span query ["+source+"]") != 3 ||
				strings.Count(log, "expected 9 columns, got 12\n") != 2 ||
				strings.Count(log, "expected 9 columns, got 1\n") != 1 {
				t.Errorf("missing source/column diagnostics or repeated per-row logs: %s", log)
			}
			if strings.Contains(log, "private-query-marker") {
				t.Error("projection diagnostic includes SQL content")
			}
		})
	}
}

func TestSpanQueryReportsIterationError(t *testing.T) {
	testDB := useSpanTestDB(t)
	if _, err := testDB.Exec("INSERT INTO spans SELECT 'z-error', block_id, root_id, box, path, content, markdown, type, ial FROM spans"); err != nil {
		t.Fatal(err)
	}
	logPath := useSpanTestLog(t)
	// 第二行计算失败应留下诊断，第一行仍保持既有的部分结果语义。
	spans := SelectSpansRawStmt("SELECT id, block_id, root_id, box, path, content, markdown, type, CASE WHEN id = 'span' THEN ial ELSE abs(-9223372036854775808) END FROM spans ORDER BY rowid", 100)
	assertSpanTestResult(t, spans)
	data, err := os.ReadFile(logPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "span query [SelectSpansRawStmt] iteration failed") || !strings.Contains(string(data), "integer overflow") {
		t.Fatalf("missing iteration error diagnostic: %s", data)
	}
}

func useSpanTestDB(t *testing.T) *gosql.DB {
	t.Helper()
	testDB, err := gosql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	testDB.SetMaxOpenConns(1)
	previous := db
	db = testDB
	t.Cleanup(func() {
		db = previous
		testDB.Close()
	})
	createSpanTestTable(t, testDB)
	return testDB
}

func createSpanTestTable(t *testing.T, testDB *gosql.DB) {
	t.Helper()
	for _, stmt := range []string{
		"CREATE TABLE spans (id, block_id, root_id, box, path, content, markdown, type, ial)",
		"INSERT INTO spans VALUES ('span', 'block', 'root', 'box', '/doc.sy', 'tag', '#tag#', 'tag strong', '')",
	} {
		if _, err := testDB.Exec(stmt); err != nil {
			t.Fatal(err)
		}
	}
}

func tagSpanTestQueries() []struct {
	name string
	run  func() []*Span
} {
	return []struct {
		name string
		run  func() []*Span
	}{
		{"QueryTagSpans all", func() []*Span { return QueryTagSpans("") }},
		{"QueryTagSpans path", func() []*Span { return QueryTagSpans("/doc.sy") }},
		{"QueryTagSpansByLabel", func() []*Span { return QueryTagSpansByLabel("tag") }},
		{"QueryTagSpansByKeyword all", func() []*Span { return QueryTagSpansByKeyword("", 100) }},
		{"QueryTagSpansByKeyword", func() []*Span { return QueryTagSpansByKeyword("tag", 100) }},
	}
}

func assertSpanTestResult(t *testing.T, spans []*Span) {
	t.Helper()
	want := &Span{ID: "span", BlockID: "block", RootID: "root", Box: "box", Path: "/doc.sy", Content: "tag", Markdown: "#tag#", Type: "tag strong"}
	if len(spans) != 1 || !reflect.DeepEqual(spans[0], want) {
		t.Errorf("unexpected spans: %#v, want %#v", spans, want)
	}
}

func useSpanTestLog(t *testing.T) string {
	t.Helper()
	previous := logging.LogPath
	logPath := filepath.Join(t.TempDir(), "span.log")
	logging.SetLogPath(logPath)
	t.Cleanup(func() { logging.SetLogPath(previous) })
	return logPath
}
