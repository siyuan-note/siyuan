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
	tx, err := BeginTx()
	if nil != err {
		return
	}
	if err = putStat(tx, key, util.DatabaseVer); nil != err {
		RollbackTx(tx)
		return
	}
	CommitTx(tx)
}

func ClearBoxHash(tx *sql.Tx) {
	stmt := "DELETE FROM stat WHERE `key` LIKE '%_hash'"
	execStmtTx(tx, stmt)
}

func RemoveBoxHash(tx *sql.Tx, box string) {
	key := box + "_hash"
	stmt := "DELETE FROM stat WHERE `key` = '" + key + "'"
	execStmtTx(tx, stmt)
}

func PutBoxHash(tx *sql.Tx, box, hash string) {
	key := box + "_hash"
	putStat(tx, key, hash)
}

func GetBoxHash(box string) string {
	key := box + "_hash"
	return getStat(key)
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

func CountAllDoc() (ret int) {
	sqlStmt := "SELECT COUNT(*) FROM blocks WHERE type = 'd'"
	row := queryRow(sqlStmt)
	row.Scan(&ret)
	return
}
