package sql

import (
	gosql "database/sql"
	"testing"
)

func TestQueryBacklinkRefDefsInBox(t *testing.T) {
	testDB, boxID := useEncryptedQueryTestDB(t)
	globalDB, err := gosql.Open("sqlite3_extended", ":memory:")
	if nil != err {
		t.Fatal(err)
	}
	defer globalDB.Close()
	if _, err = globalDB.Exec("CREATE TABLE refs (block_id TEXT, def_block_id TEXT)"); nil != err {
		t.Fatal(err)
	}
	if _, err = globalDB.Exec("INSERT INTO refs VALUES ('a', 'global')"); nil != err {
		t.Fatal(err)
	}
	previousDB, previousEncrypted := db, IsEncryptedBoxFn
	db = globalDB
	IsEncryptedBoxFn = func(id string) bool { return id == boxID }
	t.Cleanup(func() { db, IsEncryptedBoxFn = previousDB, previousEncrypted })
	for _, value := range [][3]string{{"a", "archive", "textmark"}, {"a", "archive", "textmark"}, {"b", "topic", "av"}} {
		if _, err := testDB.Exec("INSERT INTO refs (block_id, def_block_id, type) VALUES (?, ?, ?)", value[0], value[1], value[2]); nil != err {
			t.Fatal(err)
		}
	}
	ids := []string{"a", "b", "'); DELETE FROM refs --"}
	for i := 0; i < queryRefsByDefIDsBatchSize; i++ {
		ids = append(ids, "missing")
	}
	refs, err := QueryBacklinkRefDefsInBox(ids, boxID)
	if nil != err || len(refs) != 2 || len(refs["a"]) != 1 || refs["a"][0] != "archive" || refs["b"][0] != "topic" {
		t.Fatalf("unexpected scoped references: %v, %v", refs, err)
	}
	var count int
	if err = testDB.QueryRow("SELECT COUNT(*) FROM refs").Scan(&count); nil != err || count != 3 {
		t.Fatalf("query changed source rows: %d, %v", count, err)
	}
	globalRefs, err := QueryBacklinkRefDefsInBox(ids, "")
	if nil != err || len(globalRefs) != 1 || globalRefs["a"][0] != "global" {
		t.Fatalf("unexpected global references: %v, %v", globalRefs, err)
	}
	encryptedDBs.Delete(boxID)
	if _, err = QueryBacklinkRefDefsInBox(ids, boxID); nil == err {
		t.Fatal("unavailable notebook must not fall back to a different database")
	}
}
