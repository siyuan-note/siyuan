package sql

import (
	gosql "database/sql"
	"reflect"
	"strings"
	"testing"
)

func TestQueryDailyNoteRoots(t *testing.T) {
	for _, encrypted := range []bool{false, true} {
		t.Run(map[bool]string{false: "ordinary", true: "encrypted"}[encrypted], func(t *testing.T) {
			var testDB *gosql.DB
			boxID := "daily-box"
			if encrypted {
				testDB, boxID = useEncryptedQueryTestDB(t)
			} else {
				var err error
				testDB, err = gosql.Open("sqlite3_extended", ":memory:")
				if err != nil {
					t.Fatal(err)
				}
				testDB.SetMaxOpenConns(1)
				previousDB := db
				db = testDB
				t.Cleanup(func() { db = previousDB; testDB.Close() })
			}
			if _, err := testDB.Exec("CREATE TABLE attributes (block_id TEXT, root_id TEXT, box TEXT, name TEXT, value TEXT)"); err != nil {
				t.Fatal(err)
			}
			for _, row := range [][]string{
				{"b", "b", boxID, "custom-dailynote-20240229", "20240229"},
				{"a", "a", boxID, "custom-dailynote-20240229", "20240229"},
				{"a", "a", boxID, "custom-dailynote-20240229", "20240229"},
				{"child", "a", boxID, "custom-dailynote-20240229", "20240229"},
				{"other", "other", "another-box", "custom-dailynote-20240229", "20240229"},
				{"wrong", "wrong", boxID, "custom-dailynote-20240229", "20240301"},
			} {
				if _, err := testDB.Exec("INSERT INTO attributes VALUES (?, ?, ?, ?, ?)", row[0], row[1], row[2], row[3], row[4]); err != nil {
					t.Fatal(err)
				}
			}
			ids, err := QueryDailyNoteRootIDsInBox(boxID, "custom-dailynote-20240229", "20240229")
			if err != nil || !reflect.DeepEqual(ids, []string{"a", "b"}) {
				t.Fatalf("unexpected date roots: %v %v", ids, err)
			}
			for range 2 {
				if err = ensureDailyNoteAttributesIndex(testDB); err != nil {
					t.Fatal(err)
				}
			}
			indexedIDs, err := QueryDailyNoteRootIDsInBox(boxID, "custom-dailynote-20240229", "20240229")
			if err != nil || !reflect.DeepEqual(indexedIDs, ids) {
				t.Fatalf("index changed daily note roots: %v %v", indexedIDs, err)
			}
			plan := queryPlanDetails(t, testDB, "SELECT DISTINCT block_id FROM attributes WHERE box = ? AND name = ? AND value = ? AND block_id = root_id ORDER BY block_id", boxID, "custom-dailynote-20240229", "20240229")
			if !strings.Contains(plan, "SEARCH attributes USING INDEX idx_attributes_name_value") {
				t.Fatalf("daily note lookup did not use its index: %s", plan)
			}
			if _, err := testDB.Exec("DROP TABLE attributes"); err != nil {
				t.Fatal(err)
			}
			if _, err := QueryDailyNoteRootIDsInBox(boxID, "custom-dailynote-20240229", "20240229"); err == nil {
				t.Fatal("query error was treated as a missing date")
			}
		})
	}
}
