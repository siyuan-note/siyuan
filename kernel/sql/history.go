// SiYuan - Build Your Eternal Digital Garden
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
	"fmt"
	"strings"
)

type History struct {
	Type    int
	Op      string
	Title   string
	Content string
	Created string
	Path    string
}

const (
	HistoriesFTSCaseInsensitiveInsert = "INSERT INTO histories_fts_case_insensitive (type, op, title, content, path, created) VALUES %s"
	HistoriesPlaceholder              = "(?, ?, ?, ?, ?, ?)"
)

func InsertHistories(tx *sql.Tx, histories []*History) (err error) {
	if 1 > len(histories) {
		return
	}

	var bulk []*History
	for _, history := range histories {
		bulk = append(bulk, history)
		if 512 > len(bulk) {
			continue
		}

		if err = insertHistories0(tx, bulk); nil != err {
			return
		}
		bulk = []*History{}
	}
	if 0 < len(bulk) {
		if err = insertHistories0(tx, bulk); nil != err {
			return
		}
	}
	return
}

func insertHistories0(tx *sql.Tx, bulk []*History) (err error) {
	valueStrings := make([]string, 0, len(bulk))
	valueArgs := make([]interface{}, 0, len(bulk)*strings.Count(HistoriesPlaceholder, "?"))
	for _, b := range bulk {
		valueStrings = append(valueStrings, HistoriesPlaceholder)
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
	return
}
