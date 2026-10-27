// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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
	if err := row.Scan(&ret); err != nil {
		if !strings.Contains(err.Error(), "no such table") {
			logging.LogErrorf("query database version failed: %s", err)
		}
	}
	return
}

func setDatabaseVer() {
	key := "siyuan_database_ver"
	tx, err := beginTx()
	if err != nil {
		return
	}
	if err = putStat(tx, key, util.DatabaseVer); err != nil {
		return
	}
	commitTx(tx)
}

func putStat(tx *sql.Tx, key, value string) (err error) {
	stmt := "DELETE FROM stat WHERE `key` = ?"
	if err = execStmtTx(tx, stmt, key); err != nil {
		return
	}

	stmt = "INSERT INTO stat VALUES (?, ?)"
	err = execStmtTx(tx, stmt, key, value)
	return
}
