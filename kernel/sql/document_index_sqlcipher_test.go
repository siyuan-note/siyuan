//go:build fts5 && (sqlcipher || libsqlcipher)

package sql

import (
	"bytes"
	"os"
	"reflect"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocumentPartialIndexesEncryptedReopen(t *testing.T) {
	previousTemp, previousDB, previousEncrypted := util.TempDir, db, IsEncryptedBoxFn
	util.TempDir = t.TempDir()
	const box = "document-partial-index-test"
	db = newDeletePathTestDB(t, false)
	IsEncryptedBoxFn = func(id string) bool {
		return id == box || previousEncrypted != nil && previousEncrypted(id)
	}
	t.Cleanup(func() {
		CloseEncryptedDB(box)
		util.TempDir, db, IsEncryptedBoxFn = previousTemp, previousDB, previousEncrypted
	})
	execDeletePathTestSQL(t, db, "INSERT INTO blocks (id, root_id, type, content) VALUES ('decoy', 'decoy', 'd', 'plaintext')")
	key := bytes.Repeat([]byte{37}, 32)
	if err := OpenEncryptedDB(box, key); err != nil {
		t.Fatal(err)
	}
	database := GetEncryptedDB(box)
	var version string
	if err := database.QueryRow("PRAGMA cipher_version").Scan(&version); err != nil || version == "" {
		t.Fatalf("SQLCipher required: %q, %v", version, err)
	}
	execDeletePathTestSQL(t, database, "INSERT INTO blocks (id, root_id, type, content) VALUES "+
		"('encrypted', 'encrypted', 'd', 'private title'), ('body', 'encrypted', 'p', 'private body')")
	const contents = "SELECT id || ':' || content FROM blocks ORDER BY rowid"
	want := deletePathTestIDs(t, database, contents)
	// 保存只有路径索引的密文库，通过正式打开流程补建根文档索引。
	execDeletePathTestSQL(t, database, "DROP INDEX idx_blocks_doc_root_id")
	CloseEncryptedDB(box)
	readCiphertext := func() []byte {
		t.Helper()
		data, err := os.ReadFile(util.EncryptedDBPath(box))
		if err != nil {
			t.Fatal(err)
		}
		if bytes.HasPrefix(data, []byte("SQLite format 3")) {
			t.Fatal("encrypted database has a plaintext header")
		}
		return data
	}
	original := readCiphertext()
	if rows, err := queryForBox(box, "SELECT id FROM blocks"); err == nil {
		if rows != nil {
			rows.Close()
		}
		t.Fatal("locked database query succeeded")
	}
	if err := OpenEncryptedDB(box, bytes.Repeat([]byte{38}, 32)); err == nil {
		t.Fatal("wrong key accepted")
	}
	if GetEncryptedDB(box) != nil || !bytes.Equal(readCiphertext(), original) {
		t.Fatal("failed authentication changed or registered the database")
	}
	for range 2 {
		if err := OpenEncryptedDB(box, key); err != nil {
			t.Fatal(err)
		}
		database = GetEncryptedDB(box)
		if got := deletePathTestIDs(t, database, contents); !reflect.DeepEqual(got, want) {
			t.Fatalf("encrypted migration changed content: %v", got)
		}
		if got := deletePathTestIDs(t, database, "SELECT id FROM blocks INDEXED BY idx_blocks_doc_root_id WHERE type = 'd'"); !reflect.DeepEqual(got, []string{"encrypted"}) {
			t.Fatalf("encrypted document lookup: %v", got)
		}
		CloseEncryptedDB(box)
	}
	if got := deletePathTestIDs(t, db, "SELECT content FROM blocks"); !reflect.DeepEqual(got, []string{"plaintext"}) {
		t.Fatalf("plaintext database changed: %v", got)
	}
}
