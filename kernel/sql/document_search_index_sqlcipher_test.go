//go:build fts5 && sqlcipher

package sql

import (
	"bytes"
	"crypto/sha256"
	"os"
	"reflect"
	"slices"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocumentSearchIndexEncryptedMigration(t *testing.T) {
	previousTempDir, previousEncrypted, previousDB := util.TempDir, IsEncryptedBoxFn, db
	util.TempDir = t.TempDir()
	const boxID = "document-search-index-migration"
	IsEncryptedBoxFn = func(box string) bool {
		return box == boxID || previousEncrypted != nil && previousEncrypted(box)
	}
	db = newDeletePathTestDB(t, false)
	t.Cleanup(func() {
		CloseEncryptedDB(boxID)
		util.TempDir, IsEncryptedBoxFn, db = previousTempDir, previousEncrypted, previousDB
	})
	execDeletePathTestSQL(t, db, "INSERT INTO blocks (id, root_id, type, content) VALUES "+
		"('decoy', 'decoy', 'd', 'plaintext-decoy')")
	key := make([]byte, 32)
	key[0] = 7
	if err := OpenEncryptedDB(boxID, key); err != nil {
		t.Fatal(err)
	}
	database := GetEncryptedDB(boxID)
	var cipherVersion string
	if err := database.QueryRow("PRAGMA cipher_version").Scan(&cipherVersion); err != nil || cipherVersion == "" {
		t.Fatalf("not a SQLCipher connection: version=%q, error=%v", cipherVersion, err)
	}
	execDeletePathTestSQL(t, database, "INSERT INTO blocks (id, root_id, type, content) VALUES "+
		"('doc', 'doc', 'd', 'title words'), ('doc', 'doc', 'd', 'duplicate title'), "+
		"('body', 'doc', 'p', 'body words'), ('null-type', 'doc', NULL, 'nullable type')")
	const selected = "SELECT id || ':' || content FROM blocks ORDER BY rowid"
	beforeRows := deletePathTestIDs(t, database, selected)
	// 模拟尚未补建文档索引的旧密文文件，保留原格式和所有行。
	execDeletePathTestSQL(t, database, "DROP INDEX idx_blocks_doc_root_id")
	CloseEncryptedDB(boxID)
	beforeCiphertext, err := os.ReadFile(util.EncryptedDBPath(boxID))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.HasPrefix(beforeCiphertext, []byte("SQLite format 3")) {
		t.Fatal("encrypted fixture has a plaintext SQLite header")
	}
	if rows, queryErr := queryForBox(boxID, "SELECT id FROM blocks"); queryErr == nil || rows != nil {
		if rows != nil {
			rows.Close()
		}
		t.Fatalf("locked content query fell back to plaintext: %v", queryErr)
	}
	wrongKey := slices.Clone(key)
	wrongKey[0] = 8
	if err = OpenEncryptedDB(boxID, wrongKey); err == nil {
		t.Fatal("incorrect key opened the encrypted index")
	}
	afterWrongKey, err := os.ReadFile(util.EncryptedDBPath(boxID))
	if err != nil || sha256.Sum256(beforeCiphertext) != sha256.Sum256(afterWrongKey) {
		t.Fatalf("incorrect-key attempt changed ciphertext: %v", err)
	}
	if GetEncryptedDB(boxID) != nil {
		t.Fatal("failed unlock registered a content database")
	}
	if err = OpenEncryptedDB(boxID, key); err != nil {
		t.Fatal(err)
	}
	database = GetEncryptedDB(boxID)
	for range 2 {
		if err = ensureBlocksDocIndexes(database); err != nil {
			t.Fatal(err)
		}
	}
	if got := deletePathTestIDs(t, database, selected); !reflect.DeepEqual(got, beforeRows) {
		t.Fatalf("encrypted index migration changed rows: got %v, want %v", got, beforeRows)
	}
	const grouped = "SELECT root_id, GROUP_CONCAT(content) FROM blocks WHERE type = 'd' GROUP BY root_id"
	planRows, err := database.Query("EXPLAIN QUERY PLAN " + grouped)
	if err != nil {
		t.Fatal(err)
	}
	var plan strings.Builder
	for planRows.Next() {
		var id, parent, unused int
		var detail string
		if err = planRows.Scan(&id, &parent, &unused, &detail); err != nil {
			planRows.Close()
			t.Fatal(err)
		}
		plan.WriteString(detail)
		plan.WriteByte('\n')
	}
	err = planRows.Err()
	planRows.Close()
	if err != nil || !strings.Contains(plan.String(), "USING INDEX idx_blocks_doc_root_id") {
		t.Fatalf("encrypted document query lacks its index: plan=%s, error=%v", plan.String(), err)
	}
	rows, err := queryForBox(boxID, grouped)
	if err != nil {
		t.Fatal(err)
	}
	if !rows.Next() {
		rows.Close()
		t.Fatal("encrypted document query lost its result")
	}
	var rootID, content string
	if err = rows.Scan(&rootID, &content); err != nil {
		rows.Close()
		t.Fatal(err)
	}
	if rootID != "doc" || content != "title words,duplicate title" || rows.Next() {
		rows.Close()
		t.Fatalf("encrypted document query changed results or leaked the decoy: root=%q, content=%q", rootID, content)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		t.Fatal(err)
	}
	if got := deletePathTestIDs(t, db, "SELECT content FROM blocks"); !reflect.DeepEqual(got, []string{"plaintext-decoy"}) {
		t.Fatalf("encrypted migration changed the plaintext database: %v", got)
	}
	CloseEncryptedDB(boxID)
	if err = OpenEncryptedDB(boxID, key); err != nil {
		t.Fatal(err)
	}
	if got := deletePathTestIDs(t, GetEncryptedDB(boxID), selected); !reflect.DeepEqual(got, beforeRows) {
		t.Fatalf("reopening the migrated encrypted index changed rows: got %v, want %v", got, beforeRows)
	}
}
