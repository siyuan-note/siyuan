//go:build fts5

package sql

import "testing"

func TestRecentUpdatedBlocksIndexDatabaseInitialization(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		database := newDeletePathTestDB(t, encrypted)
		for _, name := range []string{"idx_blocks_recent_p", "idx_blocks_recent_d"} {
			var count int
			if err := database.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?", name).Scan(&count); err != nil {
				t.Fatal(err)
			}
			if count != 1 {
				t.Fatalf("encrypted=%v: index %s missing", encrypted, name)
			}
		}
		if _, err := database.Exec("INSERT INTO blocks (id, type, length, updated) VALUES ('paragraph', 'p', 8, '20261008000000')"); err != nil {
			t.Fatal(err)
		}
		if !encrypted {
			if _, err := database.Exec("INSERT INTO block_embeddings (id, embedding) VALUES ('paragraph', x'010203')"); err != nil {
				t.Fatal(err)
			}
		}
		if err := ensureRecentUpdatedBlocksIndexes(database); err != nil {
			t.Fatal(err)
		}
		var updated string
		if err := database.QueryRow("SELECT updated FROM blocks WHERE id = 'paragraph'").Scan(&updated); err != nil {
			t.Fatal(err)
		}
		if updated != "20261008000000" {
			t.Fatal("index migration changed existing block data")
		}
		if !encrypted {
			var embedding string
			if err := database.QueryRow("SELECT hex(embedding) FROM block_embeddings WHERE id = 'paragraph'").Scan(&embedding); err != nil {
				t.Fatal(err)
			}
			if embedding != "010203" {
				t.Fatal("index migration changed existing embedding data")
			}
		}
	}
}
