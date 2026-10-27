// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"database/sql"
	"strconv"
	"strings"

	"github.com/88250/vitess-sqlparser/sqlparser"
	"github.com/siyuan-note/logging"
)

// 标签候选条件使用确定性函数，部分索引不受搜索的 LIKE 大小写设置影响。
const tagSpanIndexPredicate = "instr(lower(type), 'tag') > 0"
const tagSpanPredicate = tagSpanIndexPredicate + " AND type LIKE '%tag%'"
const spanSelectColumns = "id, block_id, root_id, box, path, content, markdown, type, ial"

func escapeLikePattern(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if r == '%' || r == '_' || r == '\\' {
			b.WriteRune('\\')
		}
		b.WriteRune(r)
	}
	return b.String()
}

type Span struct {
	ID       string
	BlockID  string
	RootID   string
	Box      string
	Path     string
	Content  string
	Markdown string
	Type     string
	IAL      string
}

// QueryImageSpanMarkdowns 读取全局索引中的图片引用，保留同一段落内各图片的元数据归属。
func QueryImageSpanMarkdowns() (ret []string, err error) {
	rows, err := query("SELECT DISTINCT markdown FROM spans WHERE type = 'img'")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var markdown string
		if err = rows.Scan(&markdown); err != nil {
			return nil, err
		}
		ret = append(ret, markdown)
	}
	return ret, rows.Err()
}

func SelectSpansRawStmt(stmt string, limit int) (ret []*Span) {
	return selectSpansRawStmt(stmt, limit, "SelectSpansRawStmt", func(stmt string) (*sql.Rows, error) {
		return query(stmt)
	})
}

func SelectSpansRawStmtInBox(stmt string, limit int, boxID string) (ret []*Span) {
	return selectSpansRawStmt(stmt, limit, "SelectSpansRawStmtInBox", func(stmt string) (*sql.Rows, error) {
		return queryForBox(boxID, stmt)
	})
}

func selectSpansRawStmt(stmt string, limit int, source string, queryFn func(string) (*sql.Rows, error)) (ret []*Span) {
	parsedStmt, err := sqlparser.Parse(stmt)
	if err != nil {
		//logging.LogErrorf("select [%s] failed: %s", stmt, err)
		return
	}
	switch parsedStmt := parsedStmt.(type) {
	case *sqlparser.Select:
		if nil == parsedStmt.Limit {
			parsedStmt.Limit = &sqlparser.Limit{
				Rowcount: &sqlparser.SQLVal{
					Type: sqlparser.IntVal,
					Val:  []byte(strconv.Itoa(limit)),
				},
			}
		}

		stmt = sqlparser.String(parsedStmt)
	default:
		return
	}

	stmt = strings.ReplaceAll(stmt, "\\'", "''")
	stmt = strings.ReplaceAll(stmt, "\\\"", "\"")
	stmt = strings.ReplaceAll(stmt, "\\\\*", "\\*")
	stmt = strings.ReplaceAll(stmt, "from dual", "")
	rows, err := queryFn(stmt)
	if err != nil {
		if strings.Contains(err.Error(), "syntax error") {
			return
		}
		logging.LogWarnf("sql query [%s] failed: %s", stmt, err)
		return
	}
	return scanSpans(rows, source)
}

func QueryTagSpansByLabel(label string) (ret []*Span) {
	var stmt string
	var args []any
	if "" != label {
		stmt = "SELECT " + spanSelectColumns + " FROM spans WHERE " + tagSpanPredicate + " AND content LIKE ? ESCAPE '\\' GROUP BY block_id"
		args = append(args, "%"+escapeLikePattern(label)+"%")
	} else {
		stmt = "SELECT " + spanSelectColumns + " FROM spans WHERE " + tagSpanPredicate + " AND content = '' GROUP BY block_id"
	}
	rows, err := query(stmt, args...)
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	return scanSpans(rows, "QueryTagSpansByLabel")
}

func QueryTagSpansByKeyword(keyword string, limit int) (ret []*Span) {
	// 标签搜索支持空格分隔关键字 Tag search supports space-separated keywords https://github.com/siyuan-note/siyuan/issues/14580
	keywords := strings.Fields(keyword)
	var stmt string
	var args []any
	if len(keywords) == 0 {
		stmt = "SELECT " + spanSelectColumns + " FROM spans WHERE " + tagSpanPredicate + " AND content != '' GROUP BY markdown LIMIT " + strconv.Itoa(limit)
	} else {
		var likes []string
		for _, k := range keywords {
			likes = append(likes, "content LIKE ? ESCAPE '\\'")
			args = append(args, "%"+escapeLikePattern(k)+"%")
		}
		stmt = "SELECT " + spanSelectColumns + " FROM spans WHERE " + tagSpanPredicate + " AND (" + strings.Join(likes, " AND ") + ") GROUP BY markdown LIMIT " + strconv.Itoa(limit)
	}
	rows, err := query(stmt, args...)
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	return scanSpans(rows, "QueryTagSpansByKeyword")
}

func QueryTagSpans(p string) (ret []*Span) {
	stmt := "SELECT " + spanSelectColumns + " FROM spans WHERE " + tagSpanPredicate
	var args []any
	if "" != p {
		stmt += " AND path = ?"
		args = append(args, p)
	}
	rows, err := query(stmt, args...)
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	return scanSpans(rows, "QueryTagSpans")
}

func scanSpans(rows *sql.Rows, source string) (ret []*Span) {
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		logging.LogErrorf("span query [%s] columns failed: %s", source, err)
		return
	}
	// 自定义查询仍按 Span 的九个字段位置读取，不改写 SQL 或猜测字段映射。
	if len(columns) != 9 {
		logging.LogErrorf("span query [%s] expected 9 columns, got %d", source, len(columns))
		return
	}
	var firstScanErr error
	var skipped int
	for rows.Next() {
		var span Span
		if err = rows.Scan(&span.ID, &span.BlockID, &span.RootID, &span.Box, &span.Path, &span.Content, &span.Markdown, &span.Type, &span.IAL); err != nil {
			if firstScanErr == nil {
				firstScanErr = err
			}
			skipped++
			continue
		}
		ret = append(ret, &span)
	}
	if firstScanErr != nil {
		logging.LogErrorf("span query [%s] skipped %d invalid rows: %s", source, skipped, firstScanErr)
	}
	if err = rows.Err(); err != nil {
		logging.LogErrorf("span query [%s] iteration failed: %s", source, err)
	}
	return
}
