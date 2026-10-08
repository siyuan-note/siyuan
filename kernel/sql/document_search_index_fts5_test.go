//go:build fts5

package sql

import (
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func TestDocumentSearchIndexSchemaAndMigration(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(fmt.Sprintf("encrypted=%t", encrypted), func(t *testing.T) {
			database := newDeletePathTestDB(t, encrypted)
			var ddl string
			if err := database.QueryRow("SELECT sql FROM sqlite_master WHERE name = 'idx_blocks_doc_root_id'").Scan(&ddl); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(ddl, "ON blocks(root_id) WHERE type = 'd'") {
				t.Fatalf("unexpected document index: %s", ddl)
			}
			execDeletePathTestSQL(t, database, "INSERT INTO blocks (id, root_id, hpath, type, content) VALUES "+
				"('doc', 'doc', '/Doc', 'd', 'title words'), ('body', 'doc', '/Doc', 'p', 'body words'), "+
				"('null', 'doc', '/Doc', NULL, 'nullable type')")
			before := deletePathTestIDs(t, database, "SELECT id || ':' || content FROM blocks ORDER BY id")
			// 模拟版本相同但尚未具有文档分组索引的旧库，迁移不得重建或删除内容。
			execDeletePathTestSQL(t, database, "DROP INDEX idx_blocks_doc_root_id")
			for range 2 {
				if err := ensureBlocksDocIndexes(database); err != nil {
					t.Fatal(err)
				}
			}
			if after := deletePathTestIDs(t, database, "SELECT id || ':' || content FROM blocks ORDER BY id"); !reflect.DeepEqual(after, before) {
				t.Fatalf("migration changed content: %v, want %v", after, before)
			}
			if got := deletePathTestIDs(t, database, "SELECT id FROM blocks INDEXED BY idx_blocks_doc_root_id WHERE type = 'd'"); !reflect.DeepEqual(got, []string{"doc"}) {
				t.Fatalf("document index includes non-document blocks: %v", got)
			}
			// 由正文变为文档，再改回正文时，SQLite 必须同步维护稀疏索引。
			execDeletePathTestSQL(t, database, "UPDATE blocks SET type = 'd' WHERE id = 'body'")
			if got := deletePathTestIDs(t, database, "SELECT id FROM blocks INDEXED BY idx_blocks_doc_root_id WHERE type = 'd' ORDER BY id"); !reflect.DeepEqual(got, []string{"body", "doc"}) {
				t.Fatalf("index missed document update: %v", got)
			}
			execDeletePathTestSQL(t, database, "UPDATE blocks SET type = 'p' WHERE id = 'body'")
			if got := deletePathTestIDs(t, database, "SELECT id FROM blocks INDEXED BY idx_blocks_doc_root_id WHERE type = 'd'"); !reflect.DeepEqual(got, []string{"doc"}) {
				t.Fatalf("index retained non-document update: %v", got)
			}
			execDeletePathTestSQL(t, database, "DELETE FROM blocks WHERE id = 'doc'")
			if got := deletePathTestIDs(t, database, "SELECT id FROM blocks INDEXED BY idx_blocks_doc_root_id WHERE type = 'd'"); len(got) != 0 {
				t.Fatalf("index retained deleted document: %v", got)
			}
		})
	}
}
