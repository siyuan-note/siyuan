package treenode

import (
	"database/sql"
	"strings"
	"testing"
)

func TestBlockTreeTypeIndexMigration(t *testing.T) {
	for _, initialize := range []func(*sql.DB) error{ensureBlockTreeTypeIndex, initEncryptedBlockTreeTables} {
		database, err := sql.Open("sqlite3_extended", ":memory:")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { database.Close() })
		if _, err = database.Exec("CREATE TABLE blocktrees (id, root_id, parent_id, box_id, path, hpath, updated, type)"); err != nil {
			t.Fatal(err)
		}
		if _, err = database.Exec("INSERT INTO blocktrees VALUES ('doc', 'doc', '', 'box', '/doc.sy', '/Document', '2026', 'd')"); err != nil {
			t.Fatal(err)
		}
		for range 2 {
			if err = initialize(database); err != nil {
				t.Fatal(err)
			}
		}
		var id string
		if err = database.QueryRow("SELECT id FROM blocktrees WHERE type = ?", "d").Scan(&id); err != nil || id != "doc" {
			t.Fatalf("index migration changed the document: %q %v", id, err)
		}
		var node, parent, unused int
		var plan string
		if err = database.QueryRow("EXPLAIN QUERY PLAN SELECT * FROM blocktrees WHERE type = ?", "d").Scan(&node, &parent, &unused, &plan); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(plan, "SEARCH blocktrees USING INDEX idx_blocktrees_type") {
			t.Fatalf("document lookup did not use the type index: %s", plan)
		}
	}
}
