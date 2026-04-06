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
	"strconv"
	"strings"

	"github.com/88250/vitess-sqlparser/sqlparser"
	"github.com/siyuan-note/logging"
)

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

func SelectSpansRawStmt(stmt string, limit int) (ret []*Span) {
	parsedStmt, err := sqlparser.Parse(stmt)
	if err != nil {
		//logging.LogErrorf("select [%s] failed: %s", stmt, err)
		return
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
	if err != nil {
		if strings.Contains(err.Error(), "syntax error") {
			return
		}
		logging.LogWarnf("sql query [%s] failed: %s", stmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		span := scanSpanRows(rows)
		ret = append(ret, span)
	}
	return
}

func QueryTagSpansByLabel(label string) (ret []*Span) {
	var stmt string
	var args []any
	if "" != label {
		stmt = "SELECT * FROM spans WHERE type LIKE '%tag%' AND content LIKE ? ESCAPE '\\' GROUP BY block_id"
		args = append(args, "%"+escapeLikePattern(label)+"%")
	} else {
		stmt = "SELECT * FROM spans WHERE type LIKE '%tag%' AND content = '' GROUP BY block_id"
	}
	rows, err := query(stmt, args...)
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		span := scanSpanRows(rows)
		ret = append(ret, span)
	}
	return
}

func QueryTagSpansByKeyword(keyword string, limit int) (ret []*Span) {
	// 标签搜索支持空格分隔关键字 Tag search supports space-separated keywords https://github.com/siyuan-note/siyuan/issues/14580
	keywords := strings.Fields(keyword)
	var stmt string
	var args []any
	if len(keywords) == 0 {
		stmt = "SELECT * FROM spans WHERE type LIKE '%tag%' AND content != '' GROUP BY markdown LIMIT " + strconv.Itoa(limit)
	} else {
		var likes []string
		for _, k := range keywords {
			likes = append(likes, "content LIKE ? ESCAPE '\\'")
			args = append(args, "%"+escapeLikePattern(k)+"%")
		}
		stmt = "SELECT * FROM spans WHERE type LIKE '%tag%' AND (" + strings.Join(likes, " AND ") + ") GROUP BY markdown LIMIT " + strconv.Itoa(limit)
	}
	rows, err := query(stmt, args...)
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		span := scanSpanRows(rows)
		ret = append(ret, span)
	}
	return
}

func QueryTagSpans(p string) (ret []*Span) {
	stmt := "SELECT * FROM spans WHERE type LIKE '%tag%'"
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
	defer rows.Close()
	for rows.Next() {
		span := scanSpanRows(rows)
		ret = append(ret, span)
	}
	return
}

func scanSpanRows(rows *sql.Rows) (ret *Span) {
	var span Span
	if err := rows.Scan(&span.ID, &span.BlockID, &span.RootID, &span.Box, &span.Path, &span.Content, &span.Markdown, &span.Type, &span.IAL); err != nil {
		logging.LogErrorf("query scan field failed: %s", err)
		return
	}
	ret = &span
	return
}
