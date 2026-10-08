//go:build fts5

package sql

import "testing"

func TestBookmarkIndexDatabaseInitialization(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		database := newDeletePathTestDB(t, encrypted)
		for _, name := range []string{"idx_attributes_bookmark_block_id", "idx_spans_tag_path"} {
			var count int
			if err := database.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?", name).Scan(&count); err != nil {
				t.Fatal(err)
			}
			if count != 1 {
				t.Fatalf("encrypted=%v: index %s missing", encrypted, name)
			}
		}
		if _, err := database.Exec("INSERT INTO attributes VALUES ('bookmark', 'bookmark', '&amp;lt;b&amp;gt;', 'b', 'block', 'root', 'box', '/doc.sy')"); err != nil {
			t.Fatal(err)
		}
		if encrypted {
			if err := initEncryptedDBTables(database); err != nil {
				t.Fatal(err)
			}
		} else if err := ensureBookmarkAttributesIndex(database); err != nil {
			t.Fatal(err)
		}
		var value string
		if err := database.QueryRow("SELECT value FROM attributes WHERE id = 'bookmark'").Scan(&value); err != nil {
			t.Fatal(err)
		}
		if value != "&amp;lt;b&amp;gt;" {
			t.Fatal("index initialization changed stored bookmark data")
		}
	}
}
