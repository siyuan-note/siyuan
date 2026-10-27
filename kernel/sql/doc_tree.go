package sql

import (
	"database/sql"
	"maps"
	"strings"
)

// 正文和引用锚文本变化不改变目录排序；只比较同一源文档对每个目标根文档的引用块数。
// 在当前索引事务内、辅助引用写入前读取，避免异步树缓存或提交间隙引起误判。
func docTreeRefCountsChanged(tx *sql.Tx, box, path string, next []*Ref) (bool, error) {
	type countKey struct{ root, block string }
	unique := map[countKey]bool{}
	counts := map[string]int{}
	for _, ref := range next {
		key := countKey{ref.DefBlockRootID, ref.BlockID}
		if !unique[key] {
			unique[key] = true
			counts[ref.DefBlockRootID]++
		}
	}
	rows, err := tx.Query("SELECT def_block_root_id, COUNT(DISTINCT block_id) FROM refs WHERE box = ? AND path = ? GROUP BY def_block_root_id", box, path)
	if err != nil {
		return true, err
	}
	defer rows.Close()
	previous := map[string]int{}
	for rows.Next() {
		var root sql.NullString
		var count int
		if err = rows.Scan(&root, &count); err != nil {
			return true, err
		}
		if !root.Valid {
			return true, nil
		}
		previous[root.String] = count
	}
	if err = rows.Err(); err != nil {
		return true, err
	}
	return !maps.Equal(previous, counts), nil
}

// QueryDocTreeRefCounts 只查询所需根文档；ids 为 nil 时用于引用数排序的首次构建。
// boxes 由调用方已持有的笔记本租约确定，空字符串表示普通数据库。
func QueryDocTreeRefCounts(ids, boxes []string, visible func(string, string) bool) (map[string]int, error) {
	ret := map[string]int{}
	if db == nil || ids != nil && len(ids) == 0 {
		return ret, nil
	}
	for _, boxID := range boxes {
		for start := 0; ; start += 512 {
			stmt := "SELECT def_block_root_id, box, path, COUNT(DISTINCT block_id) FROM refs"
			var args []interface{}
			if ids != nil {
				for _, id := range ids[start:min(start+512, len(ids))] {
					args = append(args, id)
				}
				stmt += " WHERE def_block_root_id IN (" + strings.TrimSuffix(strings.Repeat("?,", len(args)), ",") + ")"
			}
			stmt += " GROUP BY def_block_root_id, box, path"
			rows, err := queryForBox(boxID, stmt, args...)
			if err != nil {
				return nil, err
			}
			for rows.Next() {
				var id, sourceBox, sourcePath string
				var count int
				if err = rows.Scan(&id, &sourceBox, &sourcePath, &count); err != nil {
					rows.Close()
					return nil, err
				}
				if visible == nil || visible(sourceBox, sourcePath) {
					ret[id] += count
				}
			}
			err = rows.Err()
			rows.Close()
			if err != nil {
				return nil, err
			}
			if ids == nil || start+512 >= len(ids) {
				break
			}
		}
	}
	return ret, nil
}
