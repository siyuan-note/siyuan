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
	"fmt"
	"strings"

	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/logging"
)

type History struct {
	ID      string
	Type    int
	Op      string
	Title   string
	Content string
	Created string
	Path    string
}

func QueryHistory(stmt string) (ret []map[string]interface{}, err error) {
	ret = []map[string]interface{}{}
	rows, err := queryHistory(stmt)
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

func SelectHistoriesRawStmt(stmt string) (ret []*History) {
	rows, err := historyDB.Query(stmt)
	if nil != err {
		logging.LogWarnf("sql query [%s] failed: %s", stmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		if history := scanHistoryRows(rows); nil != history {
			ret = append(ret, history)
		}
	}
	return
}

func scanHistoryRows(rows *sql.Rows) (ret *History) {
	var history History
	if err := rows.Scan(&history.ID, &history.Type, &history.Op, &history.Title, &history.Content, &history.Path, &history.Created); nil != err {
		logging.LogErrorf("query scan field failed: %s\n%s", err, logging.ShortStack())
		return
	}
	ret = &history
	return
}

func queryHistory(query string, args ...interface{}) (*sql.Rows, error) {
	query = strings.TrimSpace(query)
	if "" == query {
		return nil, errors.New("statement is empty")
	}
	return historyDB.Query(query, args...)
}

func deleteOutdatedHistories(tx *sql.Tx, before int64, context map[string]interface{}) (err error) {
	stmt := "DELETE FROM histories_fts_case_insensitive WHERE CAST(created AS INTEGER) < ?"
	if err = execStmtTx(tx, stmt, before); nil != err {
		return
	}
	return
}

const (
	HistoriesFTSCaseInsensitiveInsert = "INSERT INTO histories_fts_case_insensitive (id, type, op, title, content, path, created) VALUES %s"
	HistoriesPlaceholder              = "(?, ?, ?, ?, ?, ?, ?)"
)

func insertHistories(tx *sql.Tx, histories []*History, context map[string]interface{}) (err error) {
	if 1 > len(histories) {
		return
	}

	var bulk []*History
	for _, history := range histories {
		bulk = append(bulk, history)
		if 512 > len(bulk) {
			continue
		}

		if err = insertHistories0(tx, bulk, context); nil != err {
			return
		}
		bulk = []*History{}
	}
	if 0 < len(bulk) {
		if err = insertHistories0(tx, bulk, context); nil != err {
			return
		}
	}
	return
}

func insertHistories0(tx *sql.Tx, bulk []*History, context map[string]interface{}) (err error) {
	valueStrings := make([]string, 0, len(bulk))
	valueArgs := make([]interface{}, 0, len(bulk)*strings.Count(HistoriesPlaceholder, "?"))
	for _, b := range bulk {
		valueStrings = append(valueStrings, HistoriesPlaceholder)
		valueArgs = append(valueArgs, b.ID)
		valueArgs = append(valueArgs, b.Type)
		valueArgs = append(valueArgs, b.Op)
		valueArgs = append(valueArgs, b.Title)
		valueArgs = append(valueArgs, b.Content)
		valueArgs = append(valueArgs, b.Path)
		valueArgs = append(valueArgs, b.Created)
	}

	stmt := fmt.Sprintf(HistoriesFTSCaseInsensitiveInsert, strings.Join(valueStrings, ","))
	if err = prepareExecInsertTx(tx, stmt, valueArgs); nil != err {
		return
	}

	eventbus.Publish(eventbus.EvtSQLInsertHistory, context)
	return
}
