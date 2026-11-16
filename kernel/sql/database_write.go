// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"database/sql"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func handleDatabaseWriteError(tx *sql.Tx, stmt string, args []any, err error) {
	// 回滚会释放事务连接，库路径必须在回滚前读取；识别失败时不能推定为全局主库。
	dbPath := transactionDatabasePath(tx)
	tx.Rollback()
	closeTxPreparedStmts(tx)
	logPath := dbPath
	if logPath == "" {
		logPath = "unknown"
	}
	logging.LogErrorf("exec database [%s] stmt [%s] failed: %s\n  %s", logPath, stmt, err, logging.ShortStack())

	// 资源和历史索引由各自队列调度重建，加密笔记本保留待处理操作与恢复材料。
	if !isRecoverableDBFileError(err) || !isMainDatabasePath(dbPath) {
		return
	}
	closeDatabase()
	util.RemoveDatabaseFile(util.DBPath)
	time.Sleep(time.Second)
	initDatabase(true)
	logging.LogFatalf(logging.ExitCodeUnavailableDatabase,
		"database [%s] is unavailable: %s, please restart SiYuan kernel to rebuild it\n\t%s\n\t%v",
		dbPath, err, stmt, args)
}

func transactionDatabasePath(tx *sql.Tx) string {
	var sequence int
	var name, path string
	if err := tx.QueryRow("PRAGMA database_list").Scan(&sequence, &name, &path); err != nil || name != "main" {
		return ""
	}
	if path == "" {
		return ":memory:"
	}
	return path
}

func isMainDatabasePath(path string) bool {
	if path == "" || path == ":memory:" || util.DBPath == "" {
		return false
	}
	actual, err := filepath.Abs(path)
	if err != nil {
		return false
	}
	expected, err := filepath.Abs(util.DBPath)
	if err != nil {
		return false
	}
	if actual == expected || runtime.GOOS == "windows" && strings.EqualFold(actual, expected) {
		return true
	}
	actualInfo, actualErr := os.Stat(actual)
	expectedInfo, expectedErr := os.Stat(expected)
	return actualErr == nil && expectedErr == nil && os.SameFile(actualInfo, expectedInfo)
}
