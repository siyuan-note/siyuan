package sql

import (
	gosql "database/sql"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func TestTagSpanIndexPreservesQueries(t *testing.T) {
	database, err := gosql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	database.SetMaxOpenConns(1)
	t.Cleanup(func() { database.Close() })
	previous := db
	db = database
	t.Cleanup(func() { db = previous })
	for _, stmt := range []string{
		"CREATE TABLE spans (id, block_id, root_id, box, path, content, markdown, type, ial)",
		"CREATE INDEX idx_spans_root_id ON spans(root_id)",
	} {
		if _, err = database.Exec(stmt); err != nil {
			t.Fatal(err)
		}
	}
	for _, span := range []Span{
		{ID: "plain", BlockID: "plain", Path: "/one.sy", Type: "text", Content: "a%b"},
		{ID: "tag", BlockID: "tag", Path: "/one.sy", Type: "tag strong", Content: "a%b", Markdown: "#a%b#"},
		{ID: "other", BlockID: "other", Path: "/two.sy", Type: "text tag", Content: "axb", Markdown: "#axb#"},
		{ID: "empty", BlockID: "empty", Path: "/one.sy", Type: "tag"},
		{ID: "upper", BlockID: "upper", Path: "/one.sy", Type: "TAG", Content: "a%b", Markdown: "#upper#"},
	} {
		if _, err = database.Exec("INSERT INTO spans VALUES (?, ?, '', '', ?, ?, ?, ?, '')", span.ID, span.BlockID, span.Path, span.Content, span.Markdown, span.Type); err != nil {
			t.Fatal(err)
		}
	}
	ids := func(spans []*Span) []string {
		ret := make([]string, 0, len(spans))
		for _, span := range spans {
			ret = append(ret, span.ID)
		}
		sort.Strings(ret)
		return ret
	}
	for _, setting := range []string{"OFF", "ON", "OFF"} {
		if _, err = database.Exec("PRAGMA case_sensitive_like = " + setting); err != nil {
			t.Fatal(err)
		}
		before := [][]string{ids(QueryTagSpans("")), ids(QueryTagSpans("/one.sy")),
			ids(QueryTagSpansByLabel("a%b")), ids(QueryTagSpansByLabel("")),
			ids(QueryTagSpansByKeyword("", 100)), ids(QueryTagSpansByKeyword("a%b", 100))}
		if err = ensureTagSpansIndex(database); err != nil {
			t.Fatal(err)
		}
		after := [][]string{ids(QueryTagSpans("")), ids(QueryTagSpans("/one.sy")),
			ids(QueryTagSpansByLabel("a%b")), ids(QueryTagSpansByLabel("")),
			ids(QueryTagSpansByKeyword("", 100)), ids(QueryTagSpansByKeyword("a%b", 100))}
		if !reflect.DeepEqual(before, after) {
			t.Fatalf("%s: before=%v after=%v", setting, before, after)
		}
		wantTags, wantLiteral := []string{"empty", "other", "tag", "upper"}, []string{"tag", "upper"}
		if setting == "ON" {
			wantTags, wantLiteral = []string{"empty", "other", "tag"}, []string{"tag"}
		}
		if !reflect.DeepEqual(after[0], wantTags) || !reflect.DeepEqual(after[2], wantLiteral) ||
			!reflect.DeepEqual(after[3], []string{"empty"}) || !reflect.DeepEqual(after[5], wantLiteral) {
			t.Fatalf("%s: unexpected query results: %v", setting, after)
		}
		for _, suffix := range []string{"", " AND path = '/one.sy'", " AND content = '' GROUP BY block_id", " AND content != '' GROUP BY markdown LIMIT 16"} {
			plan := queryPlanDetails(t, database, "SELECT * FROM spans WHERE "+tagSpanPredicate+suffix)
			if !strings.Contains(plan, "idx_spans_tag_path") {
				t.Fatalf("tag query does not use partial index: %s", plan)
			}
		}
	}
}

func queryPlanDetails(t *testing.T, database *gosql.DB, stmt string, args ...any) string {
	t.Helper()
	rows, err := database.Query("EXPLAIN QUERY PLAN "+stmt, args...)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var details []string
	for rows.Next() {
		var id, parent, unused int
		var detail string
		if err = rows.Scan(&id, &parent, &unused, &detail); err != nil {
			t.Fatal(err)
		}
		details = append(details, detail)
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	return strings.Join(details, "\n")
}
