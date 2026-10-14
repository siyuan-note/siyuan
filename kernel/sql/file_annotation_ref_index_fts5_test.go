//go:build fts5

package sql

import "testing"

func TestFileAnnotationRefIndexDatabaseInitialization(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		database := newDeletePathTestDB(t, encrypted)
		var count int
		if err := database.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = 'idx_file_annotation_refs_annotation_id'").Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 1 {
			t.Fatalf("encrypted=%v: annotation reference index missing", encrypted)
		}
	}
}
