//go:build fts5

package model

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestDocumentOnlyTypeFilter(t *testing.T) {
	setSearchCaseSensitive(t, false)
	Conf.Search = &conf.Search{Document: true, Mindmap: new(false), CustomBlock: new(false)}
	for _, tc := range []struct {
		name     string
		types    map[string]bool
		subTypes map[string]bool
		alias    string
		want     string
	}{
		{"explicit", map[string]bool{"document": true}, nil, "", "(type = 'd')"},
		{"configured", nil, nil, "", "(type = 'd')"},
		{"alias", map[string]bool{"document": true}, nil, "b.", "(b.type = 'd')"},
		{"irrelevantSubtype", map[string]bool{"document": true}, map[string]bool{"h2": true}, "", "(type = 'd')"},
		{"paragraph", map[string]bool{"paragraph": true}, nil, "", "(type IN ('p'))"},
		{"heading", map[string]bool{"heading": true}, nil, "", "(type IN ('h'))"},
		{"mixed", map[string]bool{"document": true, "paragraph": true}, nil, "", "(type IN ('d','p'))"},
		{"mixedSubtype", map[string]bool{"document": true, "heading": true}, map[string]bool{"h2": true}, "b.", "(b.type IN ('d') OR (b.type = 'h' AND b.subtype IN ('h2')))"},
		{"disabled", map[string]bool{}, nil, "", "(1 = 0)"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := buildTypeFilter(tc.types, tc.subTypes, tc.alias); got != tc.want {
				t.Fatalf("got %q, want %q", got, tc.want)
			}
		})
	}
}

func TestDocumentOnlySearchUsesDocumentIndex(t *testing.T) {
	for _, caseSensitive := range []bool{false, true} {
		for _, searchHPath := range []bool{false, true} {
			t.Run(fmt.Sprintf("case=%t/hpath=%t", caseSensitive, searchHPath), func(t *testing.T) {
				setSearchCaseSensitive(t, caseSensitive)
				database := newSearchHPathTestDB(t)
				for _, statement := range []string{
					"CREATE INDEX idx_blocks_root_id ON blocks(root_id)",
					"CREATE INDEX idx_blocks_doc_hpath ON blocks(hpath) WHERE type = 'd'",
					"CREATE INDEX idx_blocks_doc_root_id ON blocks(root_id) WHERE type = 'd'",
				} {
					if _, err := database.Exec(statement); err != nil {
						t.Fatal(err)
					}
				}
				filter := buildTypeFilter(map[string]bool{"document": true}, nil)
				statement := buildDocumentSearchStatement("title words", []string{"title", "words"}, filter, "", "", "", 0, 1, 32, searchHPath)
				rows, err := database.Query("EXPLAIN QUERY PLAN " + statement)
				if err != nil {
					t.Fatal(err)
				}
				defer rows.Close()
				var plan strings.Builder
				for rows.Next() {
					var id, parent, unused int
					var detail string
					if err = rows.Scan(&id, &parent, &unused, &detail); err != nil {
						t.Fatal(err)
					}
					plan.WriteString(detail)
					plan.WriteByte('\n')
				}
				if err = rows.Err(); err != nil {
					t.Fatal(err)
				}
				if !strings.Contains(plan.String(), "USING INDEX idx_blocks_doc_root_id") {
					t.Fatalf("document-only search lacks the document index: %s", plan.String())
				}
			})
		}
	}
}

func TestDocumentOnlySearchPreservesResults(t *testing.T) {
	for _, caseSensitive := range []bool{false, true} {
		for _, searchHPath := range []bool{false, true} {
			t.Run(fmt.Sprintf("case=%t/hpath=%t", caseSensitive, searchHPath), func(t *testing.T) {
				setSearchCaseSensitive(t, caseSensitive)
				database := newSearchHPathTestDB(t)
				for _, statement := range []string{
					"CREATE INDEX idx_blocks_root_id ON blocks(root_id)",
					"CREATE INDEX idx_blocks_doc_hpath ON blocks(hpath) WHERE type = 'd'",
				} {
					if _, err := database.Exec(statement); err != nil {
						t.Fatal(err)
					}
				}
				for _, block := range [][5]string{
					{"a", "a", "/Parent/Alpha", "title words", "d"},
					{"a", "a", "/Parent/Alpha", "duplicate title", "d"},
					{"body-a", "a", "/Parent/Alpha", "body-only", "p"},
					{"b", "b", "/Parent/Beta", "TITLE words", "d"},
					{"c", "c", "/Parent/title words", "unrelated title", "d"},
					{"d", "d", "/Parent/Delta", "comma,part", "d"},
					{"e", "e", "/Parent/Epsilon", "title\x00hidden words", "d"},
				} {
					insertSearchHPathTestBlock(t, database, block[0], block[1], block[2], block[3], block[4])
				}
				readRows := func(statement string) [][]any {
					t.Helper()
					rows, err := database.Query(statement)
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
						values, destinations := make([]any, len(columns)), make([]any, len(columns))
						for i := range values {
							destinations[i] = &values[i]
						}
						if err = rows.Scan(destinations...); err != nil {
							t.Fatal(err)
						}
						for i, value := range values {
							if raw, ok := value.([]byte); ok {
								values[i] = string(raw)
							}
						}
						result = append(result, values)
					}
					if err = rows.Err(); err != nil {
						t.Fatal(err)
					}
					return result
				}
				type comparison struct {
					statement string
					want      [][]any
				}
				var comparisons []comparison
				// 在新增索引之前执行原始条件，避免新索引影响对照查询的计划。
				for _, query := range []string{"title words", "TITLE words", "body-only", "comma,part", "absent"} {
					for _, orderBy := range []int{0, 1, 4, 6} {
						for _, page := range []int{1, 2} {
							statement := buildDocumentSearchStatement(query, strings.Fields(query), "(type IN ('d'))", "", "", "", orderBy, page, 2, searchHPath)
							comparisons = append(comparisons, comparison{statement, readRows(statement)})
						}
					}
				}
				if _, err := database.Exec("CREATE INDEX idx_blocks_doc_root_id ON blocks(root_id) WHERE type = 'd'"); err != nil {
					t.Fatal(err)
				}
				filter := buildTypeFilter(map[string]bool{"document": true}, nil)
				for _, tc := range comparisons {
					statement := strings.ReplaceAll(tc.statement, "(type IN ('d'))", filter)
					if got := readRows(statement); !reflect.DeepEqual(got, tc.want) {
						t.Fatalf("document index changed ordered results: got %v, want %v; statement=%s", got, tc.want, statement)
					}
				}
			})
		}
	}
}
