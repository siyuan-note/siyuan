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
	"errors"
	"math"
	"strconv"
	"strings"

	"github.com/88250/vitess-sqlparser/sqlparser"
	"github.com/siyuan-note/logging"
)

func QueryAssetContentNoLimit(stmt string) (ret []map[string]interface{}, err error) {
	return queryAssetContentRawStmt(stmt, math.MaxInt)
}

func queryAssetContentRawStmt(stmt string, limit int) (ret []map[string]interface{}, err error) {
	rows, err := queryAssetContent(stmt)
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

	noLimit := !strings.Contains(strings.ToLower(stmt), " limit ")
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

func SelectAssetContentsRawStmt(stmt string, page, limit int) (ret []*AssetContent) {
	parsedStmt, err := sqlparser.Parse(stmt)
	if nil != err {
		return selectAssetContentsRawStmt(stmt, limit)
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
	rows, err := queryAssetContent(stmt)
	if nil != err {
		if strings.Contains(err.Error(), "syntax error") {
			return
		}
		logging.LogWarnf("sql query [%s] failed: %s", stmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		if ac := scanAssetContentRows(rows); nil != ac {
			ret = append(ret, ac)
		}
	}
	return
}

func SelectAssetContentsRawStmtNoParse(stmt string, limit int) (ret []*AssetContent) {
	return selectAssetContentsRawStmt(stmt, limit)
}

func selectAssetContentsRawStmt(stmt string, limit int) (ret []*AssetContent) {
	rows, err := queryAssetContent(stmt)
	if nil != err {
		if strings.Contains(err.Error(), "syntax error") {
			return
		}
		return
	}
	defer rows.Close()

	noLimit := !strings.Contains(strings.ToLower(stmt), " limit ")
	var count, errCount int
	for rows.Next() {
		count++
		if ac := scanAssetContentRows(rows); nil != ac {
			ret = append(ret, ac)
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

func scanAssetContentRows(rows *sql.Rows) (ret *AssetContent) {
	var ac AssetContent
	if err := rows.Scan(&ac.ID, &ac.Name, &ac.Ext, &ac.Path, &ac.Size, &ac.Updated, &ac.Content); nil != err {
		logging.LogErrorf("query scan field failed: %s\n%s", err, logging.ShortStack())
		return
	}
	ret = &ac
	return
}

func queryAssetContent(query string, args ...interface{}) (*sql.Rows, error) {
	query = strings.TrimSpace(query)
	if "" == query {
		return nil, errors.New("statement is empty")
	}
	return assetContentDB.Query(query, args...)
}
