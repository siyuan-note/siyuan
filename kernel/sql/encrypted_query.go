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
	"bytes"
	"database/sql"
	"math"
	"regexp"
	"strings"

	"github.com/siyuan-note/logging"
)

// 本文件提供加密笔记本的 box-scoped 读查询。每个函数接收 boxID，路由到加密 db（已打开）或全局 db。
// 调用方（model 层）在加密笔记本上下文里改用这些 InBox 版；全局功能继续用原函数。

// GetBlockInBox 按 id 在指定 box 的 db 里查 block。boxID 为空则查全局 db。
func GetBlockInBox(id, boxID string) (ret *Block) {
	ret = getBlockCacheInBox(id, boxID)
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

	var notHitIDs []string
	cached := map[string]*Block{}
	for _, id := range ids {
		if block := getBlockCacheInBox(id, boxID); nil != block {
			cached[id] = block
		} else {
			notHitIDs = append(notHitIDs, id)
		}
	}

	if 1 > len(notHitIDs) {
		for _, id := range ids {
			ret = append(ret, cached[id])
		}
		return
	}

	sqlStmt := "SELECT * FROM blocks WHERE id IN (" + strings.Repeat("?,", len(notHitIDs)-1) + "?)"
	args := make([]any, len(notHitIDs))
	for i, id := range notHitIDs {
		args[i] = id
	}
	rows, err := queryForBox(boxID, sqlStmt, args...)
	if err != nil {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		if block := scanBlockRows(rows); nil != block {
			cached[block.ID] = block
		}
	}
	for _, id := range ids {
		ret = append(ret, cached[id])
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
// containChildren 为 true 时递归查询定义块及其所有子块，与 QueryRefsByDefID 保持一致。
func QueryRefsByDefIDInBox(defBlockID string, containChildren bool, boxID string) (ret []*Ref) {
	var sqlStmt string
	var args []any
	if containChildren {
		blockIDs := queryBlockChildrenIDsForBox(defBlockID, boxID)
		sqlStmt = "SELECT * FROM refs WHERE def_block_id IN (" + strings.Repeat("?,", len(blockIDs)-1) + "?)"
		args = make([]any, len(blockIDs))
		for i, id := range blockIDs {
			args[i] = id
		}
	} else {
		sqlStmt = "SELECT * FROM refs WHERE def_block_id = ?"
		args = []any{defBlockID}
	}
	rows, err := queryForBox(boxID, sqlStmt, args...)
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

// QueryRootChildrenRefCountInBox 按 defRootID 在指定 box 的 db 里查询根文档下各块的引用计数。
func QueryRootChildrenRefCountInBox(defRootID, boxID string) (ret map[string]int) {
	ret = map[string]int{}
	sqlStmt := "SELECT def_block_id, COUNT(*) AS ref_cnt FROM refs WHERE def_block_root_id = ? GROUP BY def_block_id"
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
	queryFn := func(stmt string, args ...any) (*sql.Rows, error) {
		return queryForBox(boxID, stmt, args...)
	}
	return selectBlocksRawStmtWithQuery(stmt, page, limit, queryFn)
}

// QueryRefCountInBox 按 defBlockIDs 在指定 box 的 db 里查引用计数。
func QueryRefCountInBox(defIDs []string, boxID string) (ret map[string]int) {
	ret = map[string]int{}
	if 1 > len(defIDs) {
		return
	}
	ids := "('" + strings.Join(defIDs, "','") + "')"
	rows, err := queryForBox(boxID, "SELECT def_block_id, COUNT(*) AS ref_cnt FROM refs WHERE def_block_id IN "+ids+" GROUP BY def_block_id")
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var cnt int
		if err = rows.Scan(&id, &cnt); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret[id] = cnt
	}
	return
}

// QueryNoLimitInBox 在指定 box 的 db 里执行无 limit 的原始查询（返回 map 行）。
func QueryNoLimitInBox(stmt, boxID string) (ret []map[string]any, err error) {
	return queryRawStmtForBox(boxID, stmt, math.MaxInt)
}

// QueryNoLimitArgsInBox 与 QueryNoLimitInBox 一致，但支持参数化查询。
func QueryNoLimitArgsInBox(stmt, boxID string, args ...any) (ret []map[string]any, err error) {
	return queryRawStmtArgsForBox(boxID, stmt, args, math.MaxInt)
}

// SelectBlocksRawStmtArgsInBox 在指定 box 的 db 里执行参数化原始 SQL 查询 blocks。
// 与 SelectBlocksRawStmtArgs 对应，绕开 sqlparser 对 "?" 占位的改写。
func SelectBlocksRawStmtArgsInBox(stmt string, args []any, limit int, boxID string) (ret []*Block) {
	rows, err := queryForBox(boxID, stmt, args...)
	if err != nil {
		if strings.Contains(err.Error(), "syntax error") {
			return
		}
		logging.LogWarnf("sql query [%s] failed: %s", stmt, err)
		return
	}
	defer rows.Close()

	noLimit := !containsLimitClause(stmt)
	var count, errCount int
	for rows.Next() {
		count++
		if block := scanBlockRows(rows); nil != block {
			ret = append(ret, block)
		} else {
			logging.LogWarnf("raw sql query [%s] failed", stmt)
			errCount++
		}

		if (noLimit && limit < count) || 0 < errCount {
			break
		}
	}
	return
}

// SelectBlocksRegexInBox 在指定 box 的 db 里执行正则匹配查询 blocks（无占位参数版）。
func SelectBlocksRegexInBox(stmt string, exp *regexp.Regexp, name, alias, memo, ial bool, page, pageSize int, boxID string) (ret []*Block) {
	rows, err := queryForBox(boxID, stmt)
	if err != nil {
		logging.LogErrorf("sql query [%s] failed: %s", stmt, err)
		return
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		count++
		if count <= (page-1)*pageSize {
			continue
		}

		var block Block
		if err := rows.Scan(&block.ID, &block.ParentID, &block.RootID, &block.Hash, &block.Box, &block.Path, &block.HPath, &block.Name, &block.Alias, &block.Memo, &block.Tag, &block.Content, &block.FContent, &block.Markdown, &block.Length, &block.Type, &block.SubType, &block.IAL, &block.Sort, &block.Created, &block.Updated); err != nil {
			logging.LogErrorf("query scan field failed: %s\n%s", err, logging.ShortStack())
			return
		}

		if matchRegexBlock(&block, exp, name, alias, memo, ial) {
			ret = append(ret, &block)
			if len(ret) >= pageSize {
				break
			}
		}
	}
	return
}

// SelectBlocksRegexArgsInBox 与 SelectBlocksRegexInBox 一致，但通过绑定参数执行。
func SelectBlocksRegexArgsInBox(stmt string, exp *regexp.Regexp, name, alias, memo, ial bool, page, pageSize int, boxID string, args ...any) (ret []*Block) {
	rows, err := queryForBox(boxID, stmt, args...)
	if err != nil {
		logging.LogErrorf("sql query [%s] failed: %s", stmt, err)
		return
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		count++
		if count <= (page-1)*pageSize {
			continue
		}

		var block Block
		if err := rows.Scan(&block.ID, &block.ParentID, &block.RootID, &block.Hash, &block.Box, &block.Path, &block.HPath, &block.Name, &block.Alias, &block.Memo, &block.Tag, &block.Content, &block.FContent, &block.Markdown, &block.Length, &block.Type, &block.SubType, &block.IAL, &block.Sort, &block.Created, &block.Updated); err != nil {
			logging.LogErrorf("query scan field failed: %s\n%s", err, logging.ShortStack())
			return
		}

		if matchRegexBlock(&block, exp, name, alias, memo, ial) {
			ret = append(ret, &block)
			if len(ret) >= pageSize {
				break
			}
		}
	}
	return
}

// matchRegexBlock 对 block 各字段做正则命中并就地高亮，命中返回 true。
func matchRegexBlock(block *Block, exp *regexp.Regexp, name, alias, memo, ial bool) bool {
	hitContent := exp.MatchString(block.Content)
	hitName := name && exp.MatchString(block.Name)
	hitAlias := alias && exp.MatchString(block.Alias)
	hitMemo := memo && exp.MatchString(block.Memo)
	hitIAL := ial && exp.MatchString(block.IAL)
	if hitContent || hitName || hitAlias || hitMemo || hitIAL {
		if hitContent {
			block.Content = exp.ReplaceAllString(block.Content, "__@mark__${0}__mark@__")
		}
		if hitName {
			block.Name = exp.ReplaceAllString(block.Name, "__@mark__${0}__mark@__")
		}
		if hitAlias {
			block.Alias = exp.ReplaceAllString(block.Alias, "__@mark__${0}__mark@__")
		}
		if hitMemo {
			block.Memo = exp.ReplaceAllString(block.Memo, "__@mark__${0}__mark@__")
		}
		if hitIAL {
			block.IAL = exp.ReplaceAllString(block.IAL, "__@mark__${0}__mark@__")
		}
		return true
	}
	return false
}

// QueryBlockNamesByRootIDInBox 按 rootID 在指定 box 的 db 里查块命名。
func QueryBlockNamesByRootIDInBox(rootID, boxID string) (ret []string) {
	sqlStmt := "SELECT DISTINCT name FROM blocks WHERE root_id = ? AND name != ''"
	rows, err := queryForBox(boxID, sqlStmt, rootID)
	if err != nil {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		rows.Scan(&name)
		ret = append(ret, name)
	}
	return
}

// QueryBlockAliasesInBox 按 rootID 在指定 box 的 db 里查块别名（按逗号拆分去重）。
func QueryBlockAliasesInBox(rootID, boxID string) (ret []string) {
	sqlStmt := "SELECT alias FROM blocks WHERE root_id = ? AND alias != ''"
	rows, err := queryForBox(boxID, sqlStmt, rootID)
	if err != nil {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	var aliasesRows []string
	for rows.Next() {
		var name string
		rows.Scan(&name)
		aliasesRows = append(aliasesRows, name)
	}

	for _, aliasStr := range aliasesRows {
		aliases := strings.SplitSeq(aliasStr, ",")
		for alias := range aliases {
			var exist bool
			for _, retAlias := range ret {
				if retAlias == alias {
					exist = true
				}
			}
			if !exist {
				ret = append(ret, alias)
			}
		}
	}
	return
}

// QueryRefsByDefIDRefIDInBox 按 defBlockID+refBlockID 在指定 box 的 db 里查引用。
func QueryRefsByDefIDRefIDInBox(defBlockID, refBlockID, boxID string) (ret []*Ref) {
	stmt := "SELECT * FROM refs WHERE def_block_id = ? AND block_id = ?"
	rows, err := queryForBox(boxID, stmt, defBlockID, refBlockID)
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		ref := scanRefRows(rows)
		ret = append(ret, ref)
	}
	return
}

// QueryRefsRecentInBox 按 boxID 路由查最近引用，用于加密笔记本内的块引搜索。
func QueryRefsRecentInBox(onlyDoc bool, typeFilter string, ignoreLines []string, boxID string) (ret []*Ref) {
	stmt := "SELECT r.* FROM refs AS r, blocks AS b WHERE b.id = r.def_block_id AND b.type IN " + typeFilter
	if onlyDoc {
		stmt = "SELECT r.* FROM refs AS r, blocks AS b WHERE b.id = r.def_block_id AND b.type = 'd'"
	}
	if 0 < len(ignoreLines) {
		buf := bytes.Buffer{}
		for _, line := range ignoreLines {
			buf.WriteString(" AND ")
			buf.WriteString(line)
		}
		stmt += buf.String()
	}
	stmt += " GROUP BY r.def_block_id ORDER BY r.id DESC LIMIT 32"
	rows, err := queryForBox(boxID, stmt)
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		ref := scanRefRows(rows)
		ret = append(ret, ref)
	}
	return
}

// QueryChildRefDefIDsByRootDefIDInBox 按 rootDefID 查子引用定义，按 boxID 路由。
func QueryChildRefDefIDsByRootDefIDInBox(rootDefID, boxID string) (ret map[string][]string) {
	ret = map[string][]string{}
	rows, err := queryForBox(boxID, "SELECT block_id, def_block_id FROM refs WHERE def_block_root_id = ?", rootDefID)
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var defID, refID string
		if err = rows.Scan(&defID, &refID); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		if nil == ret[defID] {
			ret[defID] = []string{refID}
		} else {
			ret[defID] = append(ret[defID], refID)
		}
	}
	return
}

// QueryRefIDsByDefIDInBox 按 defID 查引用 ID 列表，按 boxID 路由。
func QueryRefIDsByDefIDInBox(defID string, containChildren bool, boxID string) (refIDs []string) {
	refIDs = []string{}
	var rows *sql.Rows
	var err error
	if containChildren {
		rows, err = queryForBox(boxID, "SELECT DISTINCT block_id FROM refs WHERE def_block_root_id = ?", defID)
	} else {
		rows, err = queryForBox(boxID, "SELECT DISTINCT block_id FROM refs WHERE def_block_id = ?", defID)
	}
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		refIDs = append(refIDs, id)
	}
	return
}

// SelectBlocksRawStmtNoParseInBox 与 SelectBlocksRawStmtNoParse 一致，但按 boxID 路由。
func SelectBlocksRawStmtNoParseInBox(stmt string, limit int, boxID string) (ret []*Block) {
	rows, err := queryForBox(boxID, stmt)
	if err != nil {
		if strings.Contains(err.Error(), "syntax error") {
			return
		}
		return
	}
	defer rows.Close()

	noLimit := !containsLimitClause(stmt)
	var count, errCount int
	for rows.Next() {
		count++
		if block := scanBlockRows(rows); nil != block {
			ret = append(ret, block)
		} else {
			logging.LogWarnf("raw sql query [%s] failed", stmt)
			errCount++
		}

		if (noLimit && limit < count) || 0 < errCount {
			break
		}
	}
	return
}

// GetChildBlocksInBox 按 parentID 在指定 box 的 db 里查所有子块。
func GetChildBlocksInBox(parentID, condition string, limit int, boxID string) (ret []*Block) {
	blockIDs := queryBlockChildrenIDsForBox(parentID, boxID)
	var params []string
	for _, id := range blockIDs {
		params = append(params, "\""+id+"\"")
	}

	ret = []*Block{}
	sqlStmt := "SELECT * FROM blocks AS ref WHERE ref.id IN (" + strings.Join(params, ",") + ")"
	if "" != condition {
		sqlStmt += " AND " + condition
	}
	sqlStmt += " LIMIT " + itoa(limit)
	rows, err := queryForBox(boxID, sqlStmt)
	if err != nil {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		if block := scanBlockRows(rows); nil != block {
			ret = append(ret, block)
		}
	}
	return
}

// queryBlockChildrenIDsForBox 递归收集 parentID 及其全部子块 id，按 boxID 路由。
func queryBlockChildrenIDsForBox(id, boxID string) (ret []string) {
	ret = append(ret, id)
	childIDs := queryBlockIDByParentIDForBox(id, boxID)
	for _, childID := range childIDs {
		ret = append(ret, queryBlockChildrenIDsForBox(childID, boxID)...)
	}
	return
}

// queryBlockIDByParentIDForBox 按 parentID 查直接子块 id，按 boxID 路由。
func queryBlockIDByParentIDForBox(parentID, boxID string) (ret []string) {
	sqlStmt := "SELECT id FROM blocks WHERE parent_id = ?"
	rows, err := queryForBox(boxID, sqlStmt, parentID)
	if err != nil {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		rows.Scan(&id)
		ret = append(ret, id)
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

// queryRawStmtForBox 与 queryRawStmt 一致，但按 boxID 路由到加密 db 或全局 db。
func queryRawStmtForBox(boxID, stmt string, limit int) (ret []map[string]any, err error) {
	rows, err := queryForBox(boxID, stmt)
	if err != nil {
		if strings.Contains(err.Error(), "syntax error") {
			return
		}
		return
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil || nil == cols {
		return
	}

	noLimit := !containsLimitClause(stmt)
	var count int
	for rows.Next() {
		columns := make([]any, len(cols))
		columnPointers := make([]any, len(cols))
		for i := range columns {
			columnPointers[i] = &columns[i]
		}

		if err = rows.Scan(columnPointers...); err != nil {
			return
		}

		m := make(map[string]any)
		for i, colName := range cols {
			val := columnPointers[i].(*any)
			m[colName] = *val
		}

		ret = append(ret, m)
		count++
		if noLimit && limit < count {
			break
		}
	}
	return
}

// queryRawStmtArgsForBox 与 queryRawStmtArgs 一致，但按 boxID 路由到加密 db 或全局 db。
func queryRawStmtArgsForBox(boxID, stmt string, args []any, limit int) (ret []map[string]any, err error) {
	rows, err := queryForBox(boxID, stmt, args...)
	if err != nil {
		return
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil || nil == cols {
		return
	}

	noLimit := !containsLimitClause(stmt)
	var count int
	for rows.Next() {
		columns := make([]any, len(cols))
		columnPointers := make([]any, len(cols))
		for i := range columns {
			columnPointers[i] = &columns[i]
		}

		if err = rows.Scan(columnPointers...); err != nil {
			return
		}

		m := make(map[string]any)
		for i, colName := range cols {
			val := columnPointers[i].(*any)
			m[colName] = *val
		}

		ret = append(ret, m)
		count++
		if noLimit && limit < count {
			break
		}
	}
	return
}
