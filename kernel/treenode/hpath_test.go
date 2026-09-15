package treenode

import (
	"database/sql"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestHPathRefreshIndexMigration(t *testing.T) {
	for _, init := range []struct {
		name string
		run  func(*sql.DB) error
	}{{"existing database", ensureHPathIndexes}, {"encrypted database schema", initEncryptedBlockTreeTables}} {
		t.Run(init.name, func(t *testing.T) {
			database, err := sql.Open("sqlite3_extended", ":memory:")
			if err != nil {
				t.Fatal(err)
			}
			defer database.Close()
			database.SetMaxOpenConns(1)
			for _, stmt := range []string{
				"CREATE TABLE blocktrees (id, root_id, parent_id, box_id, path, hpath, updated, type)",
				"CREATE INDEX idx_blocktrees_id ON blocktrees(id)",
				"CREATE INDEX idx_blocktrees_root_id ON blocktrees(root_id)",
				"CREATE INDEX idx_blocktrees_box_id ON blocktrees(box_id)",
				"CREATE INDEX idx_blocktrees_doc_path ON blocktrees(box_id, path) WHERE type = 'd'",
				"INSERT INTO blocktrees VALUES ('block', 'doc', 'doc', 'box', '/doc.sy', '/Document', '20260915000000', 'p')",
			} {
				if _, err = database.Exec(stmt); err != nil {
					t.Fatal(err)
				}
			}
			for range 2 {
				if err = init.run(database); err != nil {
					t.Fatal(err)
				}
			}
			var hpath string
			if err = database.QueryRow("SELECT hpath FROM blocktrees WHERE id = 'block'").Scan(&hpath); err != nil || hpath != "/Document" {
				t.Fatalf("index migration changed existing data: %q, %v", hpath, err)
			}
			rows, err := database.Query("EXPLAIN QUERY PLAN "+blockHPathBatchQuery, "doc", "box", "/doc.sy", 0, 257)
			if err != nil {
				t.Fatal(err)
			}
			defer rows.Close()
			var plan string
			for rows.Next() {
				var id, parent, unused int
				var detail string
				if err = rows.Scan(&id, &parent, &unused, &detail); err != nil {
					t.Fatal(err)
				}
				plan += detail + "\n"
			}
			if err = rows.Err(); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(plan, "root_id=? AND box_id=? AND rowid>?") || strings.Contains(plan, "TEMP B-TREE") {
				t.Fatalf("batch scans beyond the document or sorts all rows: %s", plan)
			}
		})
	}
}

func TestHPathRefreshYieldsToBlockTreeWriter(t *testing.T) {
	indexBlockTreeLock.Lock()
	defer indexBlockTreeLock.Unlock()
	result := make(chan error, 1)
	go func() {
		_, _, err := RefreshBlockHPathsBatch(&BlockTree{}, 0, 32, func() error {
			return errors.New("content write attempted while blocktree writer was busy")
		})
		result <- err
	}()
	select {
	case err := <-result:
		if !errors.Is(err, ErrHPathRefreshBusy) {
			t.Fatalf("background did not yield to writer: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("background waited for the blocktree writer")
	}
}
