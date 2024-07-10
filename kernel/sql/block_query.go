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
	"sort"
	"strconv"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/vitess-sqlparser/sqlparser"
	"github.com/emirpasic/gods/sets/hashset"
	sqlparser2 "github.com/rqlite/sql"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func QueryEmptyContentEmbedBlocks() (ret []*Block) {
	stmt := "SELECT * FROM blocks WHERE type = 'query_embed' AND content = ''"
	rows, err := query(stmt)
	if nil != err {
		logging.LogErrorf("sql query [%s] failed: %s", stmt, err)
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

func queryBlockHashes(rootID string) (ret map[string]string) {
	stmt := "SELECT id, hash FROM blocks WHERE root_id = ?"
	rows, err := query(stmt, rootID)
	if nil != err {
		logging.LogErrorf("sql query [%s] failed: %s", stmt, err)
		return
	}
	defer rows.Close()
	ret = map[string]string{}
	for rows.Next() {
		var id, hash string
		if err = rows.Scan(&id, &hash); nil != err {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret[id] = hash
	}
	return
}

func QueryRootBlockByCondition(condition string) (ret []*Block) {
	sqlStmt := "SELECT *, length(hpath) - length(replace(hpath, '/', '')) AS lv FROM blocks WHERE type = 'd' AND " + condition + " ORDER BY box DESC,lv ASC LIMIT 128"
	rows, err := query(sqlStmt)
	if nil != err {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var block Block
		var sepCount int
		if err = rows.Scan(&block.ID, &block.ParentID, &block.RootID, &block.Hash, &block.Box, &block.Path, &block.HPath, &block.Name, &block.Alias, &block.Memo, &block.Tag, &block.Content, &block.FContent, &block.Markdown, &block.Length, &block.Type, &block.SubType, &block.IAL, &block.Sort, &block.Created, &block.Updated, &sepCount); nil != err {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret = append(ret, &block)
	}
	return
}

func (block *Block) IsContainerBlock() bool {
	switch block.Type {
	case "d", "b", "l", "i", "s":
		return true
	}
	return false
}

func queryBlockChildrenIDs(id string) (ret []string) {
	ret = append(ret, id)
	childIDs := queryBlockIDByParentID(id)
	for _, childID := range childIDs {
		ret = append(ret, queryBlockChildrenIDs(childID)...)
	}
	return
}

func queryBlockIDByParentID(parentID string) (ret []string) {
	sqlStmt := "SELECT id FROM blocks WHERE parent_id = ?"
	rows, err := query(sqlStmt, parentID)
	if nil != err {
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

func QueryRecentUpdatedBlocks() (ret []*Block) {
	sqlStmt := "SELECT * FROM blocks WHERE type = 'p' AND length > 1 ORDER BY updated DESC LIMIT 16"
	if util.ContainerIOS == util.Container || util.ContainerAndroid == util.Container {
		sqlStmt = "SELECT * FROM blocks WHERE type = 'd' ORDER BY updated DESC LIMIT 16"
	}
	rows, err := query(sqlStmt)
	if nil != err {
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

func QueryBlockByNameOrAlias(rootID, text string) (ret *Block) {
	sqlStmt := "SELECT * FROM blocks WHERE root_id = ? AND (alias LIKE ? OR name = ?)"
	row := queryRow(sqlStmt, rootID, "%"+text+"%", text)
	ret = scanBlockRow(row)
	return
}

func QueryBlockAliases(rootID string) (ret []string) {
	sqlStmt := "SELECT alias FROM blocks WHERE root_id = ? AND alias != ''"
	rows, err := query(sqlStmt, rootID)
	if nil != err {
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
		aliases := strings.Split(aliasStr, ",")
		for _, alias := range aliases {
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

func queryNames(searchIgnoreLines []string) (ret []string) {
	ret = []string{}
	sqlStmt := "SELECT name FROM blocks WHERE name != ''"
	buf := bytes.Buffer{}
	for _, line := range searchIgnoreLines {
		buf.WriteString(" AND ")
		buf.WriteString(line)
	}
	sqlStmt += buf.String()
	sqlStmt += " LIMIT ?"
	rows, err := query(sqlStmt, 10240)
	if nil != err {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()

	var namesRows []string
	for rows.Next() {
		var name string
		rows.Scan(&name)
		namesRows = append(namesRows, name)
	}

	set := hashset.New()
	for _, namesStr := range namesRows {
		names := strings.Split(namesStr, ",")
		for _, name := range names {
			if "" == strings.TrimSpace(name) {
				continue
			}
			set.Add(name)
		}
	}
	for _, v := range set.Values() {
		ret = append(ret, v.(string))
	}
	return
}

func queryAliases(searchIgnoreLines []string) (ret []string) {
	ret = []string{}
	sqlStmt := "SELECT alias FROM blocks WHERE alias != ''"
	buf := bytes.Buffer{}
	for _, line := range searchIgnoreLines {
		buf.WriteString(" AND ")
		buf.WriteString(line)
	}
	sqlStmt += buf.String()
	sqlStmt += " LIMIT ?"
	rows, err := query(sqlStmt, 10240)
	if nil != err {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()

	var aliasesRows []string
	for rows.Next() {
		var alias string
		rows.Scan(&alias)
		aliasesRows = append(aliasesRows, alias)
	}

	set := hashset.New()
	for _, aliasStr := range aliasesRows {
		aliases := strings.Split(aliasStr, ",")
		for _, alias := range aliases {
			if "" == strings.TrimSpace(alias) {
				continue
			}
			set.Add(alias)
		}
	}
	for _, v := range set.Values() {
		ret = append(ret, v.(string))
	}
	return
}

func queryDocIDsByTitle(title string, excludeIDs []string) (ret []string) {
	ret = []string{}
	notIn := "('" + strings.Join(excludeIDs, "','") + "')"

	sqlStmt := "SELECT id FROM blocks WHERE type = 'd' AND content LIKE ? AND id NOT IN " + notIn + " LIMIT ?"
	if caseSensitive {
		sqlStmt = "SELECT id FROM blocks WHERE type = 'd' AND content = ? AND id NOT IN " + notIn + " LIMIT ?"
	}
	rows, err := query(sqlStmt, title, 32)
	if nil != err {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()

	set := hashset.New()
	for rows.Next() {
		var id string
		rows.Scan(&id)
		set.Add(id)
	}

	for _, v := range set.Values() {
		ret = append(ret, v.(string))
	}
	return
}

func queryDocTitles(searchIgnoreLines []string) (ret []string) {
	ret = []string{}
	sqlStmt := "SELECT content FROM blocks WHERE type = 'd'"
	buf := bytes.Buffer{}
	for _, line := range searchIgnoreLines {
		buf.WriteString(" AND ")
		buf.WriteString(line)
	}
	sqlStmt += buf.String()
	rows, err := query(sqlStmt)
	if nil != err {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()

	var docNamesRows []string
	for rows.Next() {
		var name string
		rows.Scan(&name)
		docNamesRows = append(docNamesRows, name)
	}

	set := hashset.New()
	for _, nameStr := range docNamesRows {
		names := strings.Split(nameStr, ",")
		for _, name := range names {
			if "" == strings.TrimSpace(name) {
				continue
			}
			set.Add(name)
		}
	}
	for _, v := range set.Values() {
		ret = append(ret, v.(string))
	}
	return
}

func QueryBlockNamesByRootID(rootID string) (ret []string) {
	sqlStmt := "SELECT DISTINCT name FROM blocks WHERE root_id = ? AND name != ''"
	rows, err := query(sqlStmt, rootID)
	if nil != err {
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

func QueryBookmarkBlocksByKeyword(bookmark string) (ret []*Block) {
	sqlStmt := "SELECT * FROM blocks WHERE ial LIKE ?"
	rows, err := query(sqlStmt, "%bookmark=%")
	if nil != err {
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

func QueryBookmarkBlocks() (ret []*Block) {
	sqlStmt := "SELECT * FROM blocks WHERE ial LIKE ?"
	rows, err := query(sqlStmt, "%bookmark=%")
	if nil != err {
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

func QueryBookmarkLabels() (ret []string) {
	ret = []string{}
	sqlStmt := "SELECT * FROM blocks WHERE ial LIKE ?"
	rows, err := query(sqlStmt, "%bookmark=%")
	if nil != err {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	labels := map[string]bool{}
	for rows.Next() {
		if block := scanBlockRows(rows); nil != block {
			if v := ialAttr(block.IAL, "bookmark"); "" != v {
				labels[v] = true
			}
		}
	}

	for label := range labels {
		ret = append(ret, label)
	}
	sort.Strings(ret)
	return
}

func QueryNoLimit(stmt string) (ret []map[string]interface{}, err error) {
	return queryRawStmt(stmt, math.MaxInt)
}

func Query(stmt string, limit int) (ret []map[string]interface{}, err error) {
	// Kernel API `/api/query/sql` support `||` operator https://github.com/siyuan-note/siyuan/issues/9662
	// 这里为了支持 || 操作符，使用了另一个 sql 解析器，但是这个解析器无法处理 UNION https://github.com/siyuan-note/siyuan/issues/8226
	// 考虑到 UNION 的使用场景不多，这里还是以支持 || 操作符为主
	p := sqlparser2.NewParser(strings.NewReader(stmt))
	parsedStmt2, err := p.ParseStatement()
	if nil != err {
		if !strings.Contains(stmt, "||") {
			// 这个解析器无法处理 || 连接字符串操作符
			parsedStmt, err2 := sqlparser.Parse(stmt)
			if nil != err2 {
				return queryRawStmt(stmt, limit)
			}

			switch parsedStmt.(type) {
			case *sqlparser.Select:
				limitClause := getLimitClause(parsedStmt, limit)
				slct := parsedStmt.(*sqlparser.Select)
				slct.Limit = limitClause
				stmt = sqlparser.String(slct)
			case *sqlparser.Union:
				// Kernel API `/api/query/sql` support `UNION` statement https://github.com/siyuan-note/siyuan/issues/8226
				limitClause := getLimitClause(parsedStmt, limit)
				union := parsedStmt.(*sqlparser.Union)
				union.Limit = limitClause
				stmt = sqlparser.String(union)
			default:
				return queryRawStmt(stmt, limit)
			}
		} else {
			return queryRawStmt(stmt, limit)
		}
	} else {
		switch parsedStmt2.(type) {
		case *sqlparser2.SelectStatement:
			slct := parsedStmt2.(*sqlparser2.SelectStatement)
			if nil == slct.LimitExpr {
				slct.LimitExpr = &sqlparser2.NumberLit{Value: strconv.Itoa(limit)}
			}
			stmt = slct.String()
		default:
			return queryRawStmt(stmt, limit)
		}
	}

	ret = []map[string]interface{}{}
	rows, err := query(stmt)
	if nil != err {
		logging.LogWarnf("sql query [%s] failed: %s", stmt, err)
		return
	}
	defer rows.Close()

	cols, _ := rows.Columns()
	if nil == cols {
		return
	}

	for rows.Next() {
		columns := make([]interface{}, len(cols))
		columnPointers := make([]interface{}, len(cols))
		for i := range columns {
			columnPointers[i] = &columns[i]
		}

		if err = rows.Scan(columnPointers...); nil != err {
			return
		}

		m := make(map[string]interface{})
		for i, colName := range cols {
			val := columnPointers[i].(*interface{})
			m[colName] = *val
		}
		ret = append(ret, m)
	}
	return
}

func getLimitClause(parsedStmt sqlparser.Statement, limit int) (ret *sqlparser.Limit) {
	switch parsedStmt.(type) {
	case *sqlparser.Select:
		slct := parsedStmt.(*sqlparser.Select)
		if nil != slct.Limit {
			ret = slct.Limit
		}
	case *sqlparser.Union:
		union := parsedStmt.(*sqlparser.Union)
		if nil != union.Limit {
			ret = union.Limit
		}
	}

	if nil == ret || nil == ret.Rowcount {
		ret = &sqlparser.Limit{
			Rowcount: &sqlparser.SQLVal{
				Type: sqlparser.IntVal,
				Val:  []byte(strconv.Itoa(limit)),
			},
		}
	}
	return
}

func queryRawStmt(stmt string, limit int) (ret []map[string]interface{}, err error) {
	rows, err := query(stmt)
	if nil != err {
		if strings.Contains(err.Error(), "syntax error") {
			return
		}
		return
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if nil != err || nil == cols {
		return
	}

	noLimit := !containsLimitClause(stmt)
	var count, errCount int
	for rows.Next() {
		columns := make([]interface{}, len(cols))
		columnPointers := make([]interface{}, len(cols))
		for i := range columns {
			columnPointers[i] = &columns[i]
		}

		if err = rows.Scan(columnPointers...); nil != err {
			return
		}

		m := make(map[string]interface{})
		for i, colName := range cols {
			val := columnPointers[i].(*interface{})
			m[colName] = *val
		}

		ret = append(ret, m)
		count++
		if (noLimit && limit < count) || 0 < errCount {
			break
		}
	}
	return
}

func SelectBlocksRawStmtNoParse(stmt string, limit int) (ret []*Block) {
	return selectBlocksRawStmt(stmt, limit)
}

func SelectBlocksRawStmt(stmt string, page, limit int) (ret []*Block) {
	parsedStmt, err := sqlparser.Parse(stmt)
	if nil != err {
		return selectBlocksRawStmt(stmt, limit)
	}

	switch parsedStmt.(type) {
	case *sqlparser.Select:
		slct := parsedStmt.(*sqlparser.Select)
		if nil == slct.Limit {
			slct.Limit = &sqlparser.Limit{
				Rowcount: &sqlparser.SQLVal{
					Type: sqlparser.IntVal,
					Val:  []byte(strconv.Itoa(limit)),
				},
			}
			slct.Limit.Offset = &sqlparser.SQLVal{
				Type: sqlparser.IntVal,
				Val:  []byte(strconv.Itoa((page - 1) * limit)),
			}
		} else {
			if nil != slct.Limit.Rowcount && 0 < len(slct.Limit.Rowcount.(*sqlparser.SQLVal).Val) {
				limit, _ = strconv.Atoi(string(slct.Limit.Rowcount.(*sqlparser.SQLVal).Val))
				if 0 >= limit {
					limit = 32
				}
			}

			slct.Limit.Rowcount = &sqlparser.SQLVal{
				Type: sqlparser.IntVal,
				Val:  []byte(strconv.Itoa(limit)),
			}
			slct.Limit.Offset = &sqlparser.SQLVal{
				Type: sqlparser.IntVal,
				Val:  []byte(strconv.Itoa((page - 1) * limit)),
			}
		}

		stmt = sqlparser.String(slct)
	default:
		return
	}

	stmt = strings.ReplaceAll(stmt, "\\'", "''")
	stmt = strings.ReplaceAll(stmt, "\\\"", "\"")
	stmt = strings.ReplaceAll(stmt, "\\\\*", "\\*")
	stmt = strings.ReplaceAll(stmt, "from dual", "")
	rows, err := query(stmt)
	if nil != err {
		if strings.Contains(err.Error(), "syntax error") {
			return
		}
		logging.LogWarnf("sql query [%s] failed: %s", stmt, err)
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

func selectBlocksRawStmt(stmt string, limit int) (ret []*Block) {
	rows, err := query(stmt)
	if nil != err {
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

func scanBlockRows(rows *sql.Rows) (ret *Block) {
	var block Block
	if err := rows.Scan(&block.ID, &block.ParentID, &block.RootID, &block.Hash, &block.Box, &block.Path, &block.HPath, &block.Name, &block.Alias, &block.Memo, &block.Tag, &block.Content, &block.FContent, &block.Markdown, &block.Length, &block.Type, &block.SubType, &block.IAL, &block.Sort, &block.Created, &block.Updated); nil != err {
		logging.LogErrorf("query scan field failed: %s\n%s", err, logging.ShortStack())
		return
	}
	ret = &block
	putBlockCache(ret)
	return
}

func scanBlockRow(row *sql.Row) (ret *Block) {
	var block Block
	if err := row.Scan(&block.ID, &block.ParentID, &block.RootID, &block.Hash, &block.Box, &block.Path, &block.HPath, &block.Name, &block.Alias, &block.Memo, &block.Tag, &block.Content, &block.FContent, &block.Markdown, &block.Length, &block.Type, &block.SubType, &block.IAL, &block.Sort, &block.Created, &block.Updated); nil != err {
		if sql.ErrNoRows != err {
			logging.LogErrorf("query scan field failed: %s\n%s", err, logging.ShortStack())
		}
		return
	}
	ret = &block
	putBlockCache(ret)
	return
}

func GetChildBlocks(parentID, condition string) (ret []*Block) {
	blockIDs := queryBlockChildrenIDs(parentID)
	var params []string
	for _, id := range blockIDs {
		params = append(params, "\""+id+"\"")
	}

	ret = []*Block{}
	sqlStmt := "SELECT * FROM blocks AS ref WHERE ref.id IN (" + strings.Join(params, ",") + ")"
	if "" != condition {
		sqlStmt += " AND " + condition
	}
	rows, err := query(sqlStmt)
	if nil != err {
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

func GetAllChildBlocks(rootIDs []string, condition string) (ret []*Block) {
	ret = []*Block{}
	sqlStmt := "SELECT * FROM blocks AS ref WHERE ref.root_id IN ('" + strings.Join(rootIDs, "','") + "')"
	if "" != condition {
		sqlStmt += " AND " + condition
	}
	rows, err := query(sqlStmt)
	if nil != err {
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

func GetBlock(id string) (ret *Block) {
	ret = getBlockCache(id)
	if nil != ret {
		return
	}
	row := queryRow("SELECT * FROM blocks WHERE id = ?", id)
	ret = scanBlockRow(row)
	if nil != ret {
		putBlockCache(ret)
	}
	return
}

func GetRootUpdated() (ret map[string]string, err error) {
	rows, err := query("SELECT root_id, updated FROM `blocks` WHERE type = 'd'")
	if nil != err {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()

	ret = map[string]string{}
	for rows.Next() {
		var rootID, updated string
		rows.Scan(&rootID, &updated)
		ret[rootID] = updated
	}
	return
}

func GetDuplicatedRootIDs(blocksTable string) (ret []string) {
	rows, err := query("SELECT DISTINCT root_id FROM `" + blocksTable + "` GROUP BY id HAVING COUNT(*) > 1")
	if nil != err {
		logging.LogErrorf("sql query failed: %s", err)
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

func GetAllRootBlocks() (ret []*Block) {
	stmt := "SELECT * FROM blocks WHERE type = 'd'"
	rows, err := query(stmt)
	if nil != err {
		logging.LogErrorf("sql query [%s] failed: %s", stmt, err)
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

func GetBlocks(ids []string) (ret []*Block) {
	var notHitIDs []string
	cached := map[string]*Block{}
	for _, id := range ids {
		b := getBlockCache(id)
		if nil != b {
			cached[id] = b
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

	length := len(notHitIDs)
	stmtBuilder := bytes.Buffer{}
	stmtBuilder.WriteString("SELECT * FROM blocks WHERE id IN (")
	var args []interface{}
	for i, id := range notHitIDs {
		args = append(args, id)
		stmtBuilder.WriteByte('?')
		if i < length-1 {
			stmtBuilder.WriteByte(',')
		}
	}
	stmtBuilder.WriteString(")")
	sqlStmt := stmtBuilder.String()
	rows, err := query(sqlStmt, args...)
	if nil != err {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		if block := scanBlockRows(rows); nil != block {
			putBlockCache(block)
			cached[block.ID] = block
		}
	}
	for _, id := range ids {
		ret = append(ret, cached[id])
	}
	return
}

func GetContainerText(container *ast.Node) string {
	buf := &bytes.Buffer{}
	buf.Grow(4096)
	leaf := treenode.FirstLeafBlock(container)
	if nil == leaf {
		return ""
	}

	ast.Walk(leaf, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		switch n.Type {
		case ast.NodeText, ast.NodeLinkText, ast.NodeFileAnnotationRefText, ast.NodeCodeBlockCode, ast.NodeMathBlockContent:
			buf.Write(n.Tokens)
		case ast.NodeTextMark:
			buf.WriteString(n.Content())
		case ast.NodeBlockRef:
			if anchor := n.ChildByType(ast.NodeBlockRefText); nil != anchor {
				buf.WriteString(anchor.Text())
			} else if anchor = n.ChildByType(ast.NodeBlockRefDynamicText); nil != anchor {
				buf.WriteString(anchor.Text())
			} else {
				text := GetRefText(n.TokensStr())
				buf.WriteString(text)
			}
			return ast.WalkSkipChildren
		}
		return ast.WalkContinue
	})
	return buf.String()
}

func containsLimitClause(stmt string) bool {
	return strings.Contains(strings.ToLower(stmt), " limit ") ||
		strings.Contains(strings.ToLower(stmt), "\nlimit ") ||
		strings.Contains(strings.ToLower(stmt), "\tlimit ")
}
