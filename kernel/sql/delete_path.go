package sql

import (
	"database/sql"
	"strings"
)

// ensureDocumentPathIndexes 为文档删除建立路径范围索引，加密内容库不包含向量表。
func ensureDocumentPathIndexes(database *sql.DB, embeddings bool) error {
	tables := []string{"blocks", "spans", "assets", "refs", "file_annotation_refs", "attributes"}
	if embeddings {
		tables = append(tables, "block_embeddings")
	}
	for _, table := range tables {
		column := "path"
		if table == "assets" {
			column = "docpath"
		}
		if _, err := database.Exec("CREATE INDEX IF NOT EXISTS idx_" + table + "_box_docpath ON " +
			table + "(box, " + column + " COLLATE NOCASE)"); err != nil {
			return err
		}
	}
	return nil
}

// documentPathPrefixCondition 用固定排序规则约束扫描范围，LIKE 保留当前大小写设置的匹配语义。
// 非标准路径保留原有匹配方式，避免通配符或非 ASCII 字符改变删除范围。
func documentPathPrefixCondition(column, boxID, prefix string) (string, []any) {
	condition := "box = ? AND " + column + " LIKE ?"
	args := []any{boxID, prefix + "%"}
	if prefix == "" {
		return condition, args
	}
	for _, c := range prefix {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' ||
			c == '/' || c == '-' || c == '.') {
			return condition, args
		}
	}
	lower := strings.ToLower(prefix)
	upper := lower[:len(lower)-1] + string(lower[len(lower)-1]+1)
	return condition + " AND " + column + " COLLATE NOCASE >= ? AND " + column + " COLLATE NOCASE < ?",
		append(args, lower, upper)
}
