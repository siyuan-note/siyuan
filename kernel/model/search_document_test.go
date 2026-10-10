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
	Conf.Search = &conf.Search{Document: true, Mindmap: new(false), MindmapItem: new(false), CustomBlock: new(false)}
	if got := buildTypeFilter(nil, nil); got != "(type = 'd')" {
		t.Fatalf("document-only settings: %s", got)
	}
	Conf.Search.Paragraph = true
	if got := buildTypeFilter(nil, nil); got != "(type IN ('d','p'))" {
		t.Fatalf("mixed settings: %s", got)
	}
}

func documentSearchRows(t *testing.T, database *gosql.DB, statement string, args []any) [][]any {
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
