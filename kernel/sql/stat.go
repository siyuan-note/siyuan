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
	"github.com/siyuan-note/siyuan/kernel/util"
)

type Stat struct {
	Key string `json:"key"`
	Val string `json:"value"`
}

func getDatabaseVer() (ret string) {
	key := "siyuan_database_ver"
	stmt := "SELECT value FROM stat WHERE `key` = ?"
	row := db.QueryRow(stmt, key)
	if err := row.Scan(&ret); nil != err {
		if !strings.Contains(err.Error(), "no such table") {
			logging.LogErrorf("query database version failed: %s", err)
		}
	}
	return
}

func setDatabaseVer() {
	key := "siyuan_database_ver"
	tx, err := beginTx()
	if nil != err {
		return
	}
	if err = putStat(tx, key, util.DatabaseVer); nil != err {
		return
	}
	commitTx(tx)
}

func putStat(tx *sql.Tx, key, value string) (err error) {
	stmt := "DELETE FROM stat WHERE `key` = '" + key + "'"
	if err = execStmtTx(tx, stmt); nil != err {
		return
	}

	stmt = "INSERT INTO stat VALUES ('" + key + "', '" + value + "')"
	err = execStmtTx(tx, stmt)
	return
}

func getStat(key string) (ret string) {
	stmt := "SELECT value FROM stat WHERE `key` = '" + key + "'"
	row := queryRow(stmt)
	row.Scan(&ret)
	return
}
