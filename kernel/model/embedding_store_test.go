package model

import (
	"database/sql"
	"testing"

	_ "github.com/mattn/go-sqlite3"
)

func TestEmbeddingResultWrites(t *testing.T) {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	exec := func(stmt string, args ...any) {
		t.Helper()
		if _, err := db.Exec(stmt, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec("CREATE TABLE blocks (id TEXT PRIMARY KEY, root_id TEXT, box TEXT, path TEXT, updated TEXT, content TEXT)")
	exec("CREATE TABLE block_embeddings (id TEXT PRIMARY KEY, root_id TEXT, box TEXT, path TEXT, embedding BLOB, model TEXT, content_len INTEGER, updated TEXT, fail_count INTEGER, last_tried INTEGER, ignored_type INTEGER)")
	exec("INSERT INTO blocks VALUES ('id', 'root', 'box', '/path', '1', 'original')")
	check := func(wantCount, wantFailures, wantBytes int) {
		t.Helper()
		var count, failures, bytes int
		if err := db.QueryRow("SELECT COUNT(*), COALESCE(SUM(fail_count), 0), COALESCE(SUM(length(embedding)), 0) FROM block_embeddings").Scan(&count, &failures, &bytes); err != nil {
			t.Fatal(err)
		}
		if count != wantCount || failures != wantFailures || bytes != wantBytes {
			t.Fatalf("count=%d, failures=%d, bytes=%d", count, failures, bytes)
		}
	}
	exec(stmtFailedEmbedding, []byte{}, "model", 1, "id", "1", "original")
	exec(stmtFailedEmbedding, []byte{}, "model", 2, "id", "1", "original")
	check(1, 2, 0)
	exec(stmtIgnoreEmbedding, []byte{}, "model", 2, "id", "1", "original", "box", "/path")
	check(1, 0, 0)
	var ignored int
	if err := db.QueryRow("SELECT ignored_type FROM block_embeddings").Scan(&ignored); err != nil || ignored != 2 {
		t.Fatalf("ignored=%d, error=%v", ignored, err)
	}
	exec(stmtStoreEmbedding, []byte{1, 2, 3, 4}, "model", 8, "id", "1", "original")
	exec(stmtFailedEmbedding, []byte{}, "model", 3, "id", "1", "original")
	check(1, 0, 4)

	// 同一秒内编辑也必须凭内容拦截旧结果。
	exec("DELETE FROM block_embeddings")
	exec("UPDATE blocks SET content = 'edited'")
	exec(stmtStoreEmbedding, []byte{1}, "model", 8, "id", "1", "original")
	exec(stmtFailedEmbedding, []byte{}, "model", 4, "id", "1", "original")
	exec(stmtIgnoreEmbedding, []byte{}, "model", 1, "id", "1", "original", "box", "/path")
	check(0, 0, 0)

	// 移动后使用当前路径，删除后不恢复索引行。
	exec("UPDATE blocks SET path = '/moved'")
	exec(stmtIgnoreEmbedding, []byte{}, "model", 2, "id", "1", "edited", "box", "/path")
	check(0, 0, 0)
	exec(stmtStoreEmbedding, []byte{1}, "model", 6, "id", "1", "edited")
	var path string
	if err := db.QueryRow("SELECT path FROM block_embeddings").Scan(&path); err != nil || path != "/moved" {
		t.Fatalf("path=%s, error=%v", path, err)
	}
	exec("DELETE FROM blocks")
	exec("DELETE FROM block_embeddings")
	exec(stmtStoreEmbedding, []byte{1}, "model", 6, "id", "1", "edited")
	exec(stmtFailedEmbedding, []byte{}, "model", 5, "id", "1", "edited")
	check(0, 0, 0)
}
