package model

// 写入时在同一 SQL 中验证内容及更新时间，避免查询与写入之间发生编辑而产生过期索引。
const stmtStoreEmbedding = "INSERT OR REPLACE INTO block_embeddings " +
	"(id, root_id, box, path, embedding, model, content_len, updated, fail_count, last_tried, ignored_type) " +
	"SELECT id, root_id, box, path, ?, ?, ?, updated, 0, 0, 0 FROM blocks " +
	"WHERE id = ? AND updated = ? AND content = ?"

// 失败仅累加空向量记录，成功结果不受迟到的失败影响。
const stmtFailedEmbedding = "INSERT INTO block_embeddings " +
	"(id, root_id, box, path, embedding, model, content_len, updated, fail_count, last_tried, ignored_type) " +
	"SELECT id, root_id, box, path, ?, ?, 0, updated, 1, ?, 0 FROM blocks " +
	"WHERE id = ? AND updated = ? AND content = ? " +
	"ON CONFLICT(id) DO UPDATE SET fail_count = block_embeddings.fail_count + 1, " +
	"last_tried = excluded.last_tried, model = excluded.model, content_len = 0, ignored_type = 0 " +
	"WHERE length(block_embeddings.embedding) = 0"

const stmtIgnoreEmbedding = "INSERT INTO block_embeddings " +
	"(id, root_id, box, path, embedding, model, content_len, updated, fail_count, last_tried, ignored_type) " +
	"SELECT id, root_id, box, path, ?, ?, 0, updated, 0, 0, ? FROM blocks " +
	"WHERE id = ? AND updated = ? AND content = ? AND box = ? AND path = ? " +
	"ON CONFLICT(id) DO UPDATE SET fail_count = 0, last_tried = 0, ignored_type = excluded.ignored_type, " +
	"model = excluded.model, content_len = 0 WHERE length(block_embeddings.embedding) = 0"
