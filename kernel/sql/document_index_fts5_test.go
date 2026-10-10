//go:build fts5

package sql

import (
	"fmt"
	"reflect"
	"testing"
)

func TestDocumentPartialIndexesMigration(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(fmt.Sprintf("encryptedSchema=%t", encrypted), func(t *testing.T) {
			database := newDeletePathTestDB(t, encrypted)
			for _, column := range []string{"hpath", "root_id"} {
				var ddl string
				if err := database.QueryRow("SELECT sql FROM sqlite_master WHERE name = ?", "idx_blocks_doc_"+column).Scan(&ddl); err != nil {
					t.Fatal(err)
				}
				if want := "CREATE INDEX idx_blocks_doc_" + column + " ON blocks(" + column + ") WHERE type = 'd'"; ddl != want {
					t.Fatalf("index definition: got %s, want %s", ddl, want)
				}
			}
			execDeletePathTestSQL(t, database, "INSERT INTO blocks (id, root_id, content, type) VALUES "+
				"('root', 'root', 'document', 'd'), ('child', 'root', 'paragraph', 'p'), ('unknown', 'root', 'unknown', NULL)")
			before := deletePathTestIDs(t, database, "SELECT id || ':' || content FROM blocks ORDER BY rowid")
			execDeletePathTestSQL(t, database, "DROP INDEX idx_blocks_doc_root_id")
			// 在已有表上补建索引，重复运行不得改变文档内容。
			for range 2 {
				if err := ensureBlocksDocIndexes(database); err != nil {
					t.Fatal(err)
				}
			}
			if after := deletePathTestIDs(t, database, "SELECT id || ':' || content FROM blocks ORDER BY rowid"); !reflect.DeepEqual(after, before) {
				t.Fatalf("migration changed rows: %v", after)
			}
			assertDocuments := func(want []string) {
				t.Helper()
				got := deletePathTestIDs(t, database, "SELECT id FROM blocks INDEXED BY idx_blocks_doc_root_id WHERE type = 'd' ORDER BY id")
				if !reflect.DeepEqual(got, want) {
					t.Fatalf("indexed documents: got %v, want %v", got, want)
				}
			}
			assertDocuments([]string{"root"})
			execDeletePathTestSQL(t, database, "UPDATE blocks SET type = 'd', root_id = 'child' WHERE id = 'child'")
			assertDocuments([]string{"child", "root"})
			var indexedRoot string
			if err := database.QueryRow("SELECT root_id FROM blocks INDEXED BY idx_blocks_doc_root_id WHERE type = 'd' AND root_id = 'child'").Scan(&indexedRoot); err != nil || indexedRoot != "child" {
				t.Fatalf("root lookup after type change: %q, %v", indexedRoot, err)
			}
			execDeletePathTestSQL(t, database, "UPDATE blocks SET type = 'p' WHERE id = 'root'")
			assertDocuments([]string{"child"})
			execDeletePathTestSQL(t, database, "DELETE FROM blocks WHERE id = 'child'")
			assertDocuments(nil)
		})
	}
}
