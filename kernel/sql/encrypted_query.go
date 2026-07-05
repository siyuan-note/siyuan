// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package sql

import (
	"database/sql"
	"strings"

	"github.com/siyuan-note/logging"
)

// 本文件提供加密笔记本的 box-scoped 读查询。每个函数接收 boxID，路由到加密 db（已打开）或全局 db。
// 调用方（model 层）在加密 box 上下文里改用这些 InBox 版；全局功能继续用原函数。

// GetBlockInBox 按 id 在指定 box 的 db 里查 block。boxID 为空则查全局 db。
func GetBlockInBox(id, boxID string) (ret *Block) {
	ret = getBlockCache(id)
	if nil != ret {
		return
	}
	row := queryRowForBox(boxID, "SELECT * FROM blocks WHERE id = ?", id)
	if row == nil {
		return
	}
	ret = scanBlockRow(row)
	if nil != ret {
		putBlockCache(ret)
	}
	return
}

// GetBlocksInBox 按 ids 在指定 box 的 db 里批量查 block。
func GetBlocksInBox(ids []string, boxID string) (ret []*Block) {
	if 1 > len(ids) {
		return
	}
	sqlStmt := "SELECT * FROM blocks WHERE id IN ('" + strings.Join(ids, "','") + "')"
	rows, err := queryForBox(boxID, sqlStmt)
	if err != nil {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		b := scanBlockRows(rows)
		if b != nil {
			ret = append(ret, b)
		}
	}
	return
}

// GetRefTextInBox 按 defBlockID 在指定 box 的 db 里查引用文本。
func GetRefTextInBox(defBlockID, boxID string) (ret string) {
	row := queryRowForBox(boxID, "SELECT content FROM blocks WHERE id = ?", defBlockID)
	if row == nil {
		return
	}
	if err := row.Scan(&ret); err != nil {
		if err != sql.ErrNoRows {
			logging.LogErrorf("sql query failed: %s", err)
		}
		ret = ""
	}
	return
}

// QueryRefsByDefIDInBox 按 defBlockID 在指定 box 的 db 里查引用列表。
func QueryRefsByDefIDInBox(defBlockID string, containChildren bool, boxID string) (ret []*Ref) {
	sqlStmt := "SELECT * FROM refs WHERE def_block_id = ?"
	if containChildren {
		sqlStmt = "SELECT r.* FROM refs r JOIN blocktrees b ON r.def_block_root_id = b.root_id WHERE r.def_block_id = ?"
	}
	rows, err := queryForBox(boxID, sqlStmt, defBlockID)
	if err != nil {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var ref Ref
		if err = rows.Scan(&ref.ID, &ref.DefBlockID, &ref.DefBlockParentID, &ref.DefBlockRootID, &ref.DefBlockPath, &ref.BlockID, &ref.RootID, &ref.Box, &ref.Path, &ref.Content, &ref.Markdown, &ref.Type); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret = append(ret, &ref)
	}
	return
}

// QueryRootChildrenRefCountInBox 按 defRootID 在指定 box 的 db 里查子文档引用计数。
func QueryRootChildrenRefCountInBox(defRootID, boxID string) (ret map[string]int) {
	ret = map[string]int{}
	sqlStmt := "SELECT r.def_block_root_id, COUNT(*) FROM refs r WHERE r.def_block_root_id IN (SELECT id FROM blocks WHERE root_id = ? AND type = 'd') GROUP BY r.def_block_root_id"
	rows, err := queryForBox(boxID, sqlStmt, defRootID)
	if err != nil {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var count int
		if err = rows.Scan(&id, &count); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret[id] = count
	}
	return
}

// SelectBlocksRawStmtInBox 在指定 box 的 db 里执行原始 SQL 查询 blocks。
func SelectBlocksRawStmtInBox(stmt string, page, limit int, boxID string) (ret []*Block) {
	stmt = strings.TrimSpace(stmt)
	if 1 > page {
		page = 1
	}
	offset := (page - 1) * limit
	if 0 < limit && !strings.Contains(strings.ToLower(stmt), " limit ") {
		stmt += " LIMIT " + itoa(limit) + " OFFSET " + itoa(offset)
	}
	rows, err := queryForBox(boxID, stmt)
	if err != nil {
		logging.LogErrorf("sql query [%s] failed: %s", stmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		b := scanBlockRows(rows)
		if b != nil {
			ret = append(ret, b)
		}
	}
	return
}

// QueryTagSpansByLabelInBox 按 label 在指定 box 的 db 里查标签。
func QueryTagSpansByLabelInBox(label, boxID string) (ret []*Span) {
	sqlStmt := "SELECT * FROM spans WHERE type LIKE '%tag%' AND content LIKE ?"
	rows, err := queryForBox(boxID, sqlStmt, "%#"+label+"#%")
	if err != nil {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var span Span
		if err = rows.Scan(&span.ID, &span.BlockID, &span.RootID, &span.Box, &span.Path, &span.Content, &span.Markdown, &span.Type, &span.IAL); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret = append(ret, &span)
	}
	return
}

// QueryBookmarkBlocksInBox 在指定 box 的 db 里查书签块。
func QueryBookmarkBlocksInBox(boxID string) (ret []*Block) {
	sqlStmt := "SELECT * FROM blocks WHERE ial LIKE '%bookmark=%'"
	rows, err := queryForBox(boxID, sqlStmt)
	if err != nil {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		b := scanBlockRows(rows)
		if b != nil {
			ret = append(ret, b)
		}
	}
	return
}

// itoa 是 strconv.Itoa 的简写别名，避免重复 import。
func itoa(i int) string {
	return intToStr(i)
}

// intToStr 把 int 转字符串（避免 import strconv 的循环）。
func intToStr(i int) string {
	if i == 0 {
		return "0"
	}
	neg := false
	if i < 0 {
		neg = true
		i = -i
	}
	var buf [20]byte
	pos := len(buf)
	for i > 0 {
		pos--
		buf[pos] = byte('0' + i%10)
		i /= 10
	}
	if neg {
		pos--
		buf[pos] = '-'
	}
	return string(buf[pos:])
}
