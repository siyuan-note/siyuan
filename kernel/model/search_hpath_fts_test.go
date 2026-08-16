//go:build fts5

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

package model

import (
	gosql "database/sql"
	"slices"
	"strings"
	"testing"
)

func TestFTSAndHPathMatchesIntegration(t *testing.T) {
	setSearchCaseSensitive(t, true)
	testDB, err := gosql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	testDB.SetMaxOpenConns(1)
	t.Cleanup(func() {
		testDB.Close()
	})
	if _, err = testDB.Exec("CREATE TABLE blocks (id, parent_id, root_id, hash, box, path, hpath, name, alias, memo, tag, content, fcontent, markdown, length, type, subtype, ial, sort, created, updated)"); err != nil {
		t.Fatal(err)
	}
	if _, err = testDB.Exec("CREATE VIRTUAL TABLE blocks_fts USING fts5(id UNINDEXED, parent_id UNINDEXED, root_id UNINDEXED, hash UNINDEXED, box UNINDEXED, path UNINDEXED, hpath UNINDEXED, name, alias, memo, tag, content, fcontent, markdown UNINDEXED, length UNINDEXED, type UNINDEXED, subtype UNINDEXED, ial, sort UNINDEXED, created UNINDEXED, updated UNINDEXED, content='blocks', content_rowid='rowid')"); err != nil {
		t.Fatal(err)
	}
	insertSearchHPathTestBlock(t, testDB, "20260729122000-parent1", "20260729122000-parent1", "/Parent", "Parent", "d")
	insertSearchHPathTestBlock(t, testDB, "20260729122001-child01", "20260729122001-child01", "/Parent/Child", "Child", "d")
	insertSearchHPathTestBlock(t, testDB, "20260729122002-block01", "20260729122001-child01", "/Parent/Child", "Parent body", "p")
	if _, err = testDB.Exec("INSERT INTO blocks_fts(blocks_fts) VALUES('rebuild')"); err != nil {
		t.Fatal(err)
	}

	cte, args := buildFTSAndHPathMatchesCTE("Parent", "\"Parent\"", "", "", nil, nil, "(type IN ('d', 'p'))", "")
	stmt := cte + " SELECT b.id, matches.match_source FROM matches JOIN blocks b ON b.rowid = matches.block_rowid " +
		buildHPathSearchOrderBy("Parent", 0)
	rows, err := testDB.Query(stmt, args...)
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	var sources []int
	for rows.Next() {
		var id string
		var source int
		if err = rows.Scan(&id, &source); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
		sources = append(sources, source)
	}
	if err = rows.Close(); err != nil {
		t.Fatal(err)
	}

	expectedIDs := []string{"20260729122000-parent1", "20260729122002-block01", "20260729122001-child01"}
	if !slices.Equal(ids, expectedIDs) {
		t.Fatalf("FTS 与路径联合搜索结果错误：got %v, want %v", ids, expectedIDs)
	}
	if !slices.Equal(sources, []int{0, 0, 1}) {
		t.Fatalf("FTS 与路径联合搜索来源错误：%v", sources)
	}

	countStmt := cte + " SELECT COUNT(*) AS matches, COUNT(DISTINCT b.root_id) AS docs" +
		" FROM matches JOIN blocks b ON b.rowid = matches.block_rowid"
	var matched, docs int
	if err = testDB.QueryRow(countStmt, args...).Scan(&matched, &docs); err != nil {
		t.Fatal(err)
	}
	if 3 != matched || 2 != docs {
		t.Fatalf("FTS 与路径联合搜索统计错误：matches=%d, docs=%d", matched, docs)
	}

	snippetStmt, snippetArgs := buildFTSSnippetBlocksByRowIDQuery("\"Parent\"", []int64{1, 3})
	if !strings.Contains(snippetStmt, "snippet(blocks_fts") || strings.Contains(snippetStmt, "SELECT *") {
		t.Fatalf("FTS 结果应使用摘要投影：%s", snippetStmt)
	}
	snippetRows, err := testDB.Query(snippetStmt, snippetArgs...)
	if err != nil {
		t.Fatal(err)
	}
	if !snippetRows.Next() {
		t.Fatal("FTS 摘要查询应返回结果")
	}
	if err = snippetRows.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestSiYuanFTSMatchesWhitespace(t *testing.T) {
	testDB, err := gosql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	testDB.SetMaxOpenConns(1)
	t.Cleanup(func() {
		testDB.Close()
	})
	if _, err = testDB.Exec(`CREATE VIRTUAL TABLE whitespace_fts USING fts5(content, tokenize="siyuan")`); err != nil {
		t.Fatal(err)
	}
	for _, content := range []string{"你好", "你 好", "你  好"} {
		if _, err = testDB.Exec("INSERT INTO whitespace_fts(content) VALUES (?)", content); err != nil {
			t.Fatal(err)
		}
	}

	assertMatches := func(query string, expected []string) {
		t.Helper()
		ftsQuery, hPathQuery := buildKeywordSearchQueries(query)
		if "" != hPathQuery {
			t.Fatalf("纯空白查询不应参与层级路径搜索：%q", hPathQuery)
		}
		matchQuery := "{content}:(" + ftsQuery + ")"
		rows, queryErr := testDB.Query("SELECT content FROM whitespace_fts WHERE whitespace_fts MATCH ? ORDER BY rowid", matchQuery)
		if queryErr != nil {
			t.Fatal(queryErr)
		}
		var actual []string
		for rows.Next() {
			var content string
			if queryErr = rows.Scan(&content); queryErr != nil {
				rows.Close()
				t.Fatal(queryErr)
			}
			actual = append(actual, content)
		}
		if queryErr = rows.Err(); queryErr != nil {
			rows.Close()
			t.Fatal(queryErr)
		}
		if queryErr = rows.Close(); queryErr != nil {
			t.Fatal(queryErr)
		}
		if !slices.Equal(actual, expected) {
			t.Fatalf("空白查询 %q 的匹配结果错误：got %v, want %v", query, actual, expected)
		}
	}

	assertMatches(" ", []string{"你 好", "你  好"})
	assertMatches("  ", []string{"你  好"})
}
