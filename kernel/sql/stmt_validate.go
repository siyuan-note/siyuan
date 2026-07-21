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
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"unicode"

	"github.com/mattn/go-sqlite3"
)

// tailIsOnlyWhitespaceOrSQLComments 判断分号之后的片段是否仅由空白、行注释（-- 至换行或 EOF）、
// 块注释（/* … */，含未闭合则吞至 EOF）构成。与 SQLite 解析对齐：分号后若只有这些内容，不会被视为另一条可执行的 SQL 语句。
func tailIsOnlyWhitespaceOrSQLComments(s string) bool {
	runes := []rune(s)
	for i := 0; i < len(runes); {
		if unicode.IsSpace(runes[i]) {
			i++
			continue
		}
		ch := runes[i]
		var next rune
		if i+1 < len(runes) {
			next = runes[i+1]
		}
		if '-' == ch && '-' == next {
			i += 2
			for i < len(runes) && '\n' != runes[i] {
				i++
			}
			continue
		}
		if '/' == ch && '*' == next {
			i += 2
			for i < len(runes) {
				if '*' == runes[i] && i+1 < len(runes) && '/' == runes[i+1] {
					i += 2
					break
				}
				i++
			}
			continue
		}
		return false
	}
	return true
}

func containsMultipleStatements(stmt string) bool {
	stmt = strings.TrimSpace(stmt)
	for strings.HasSuffix(stmt, ";") {
		stmt = strings.TrimRight(stmt, ";")
		stmt = strings.TrimSpace(stmt)
	}

	inSingleQuote := false
	inDoubleQuote := false
	inBacktickQuote := false
	inBracketQuote := false
	inLineComment := false
	inBlockComment := false
	runes := []rune(stmt)
	for i := 0; i < len(runes); i++ {
		ch := runes[i]
		var next rune
		if i+1 < len(runes) {
			next = runes[i+1]
		}

		if inLineComment {
			if '\n' == ch {
				inLineComment = false
			}
			continue
		}
		if inBlockComment {
			if '*' == ch && '/' == next {
				inBlockComment = false
				i++
			}
			continue
		}
		if inSingleQuote {
			if '\'' == ch {
				inSingleQuote = false
			}
			continue
		}
		if inDoubleQuote {
			if '"' == ch {
				inDoubleQuote = false
			}
			continue
		}
		if inBacktickQuote {
			if '`' == ch {
				inBacktickQuote = false
			}
			continue
		}
		if inBracketQuote {
			if ']' == ch {
				inBracketQuote = false
			}
			continue
		}

		switch {
		case '\'' == ch:
			inSingleQuote = true
		case '"' == ch:
			inDoubleQuote = true
		case '`' == ch:
			inBacktickQuote = true
		case '[' == ch:
			inBracketQuote = true
		case '-' == ch && next == '-':
			inLineComment = true
			i++
		case '/' == ch && next == '*':
			inBlockComment = true
			i++
		case ';' == ch:
			tail := string(runes[i+1:])
			if tailIsOnlyWhitespaceOrSQLComments(tail) {
				// 分号后仅有空白与 SQL 注释时，SQLite 仍视为同一条语句末尾，不应判为多语句。
				continue
			}
			return true
		}
	}
	return false
}

func CheckSingleStatement(stmt string) error {
	if containsMultipleStatements(stmt) {
		return errors.New("SQL statement is not single")
	}
	return nil
}

// CheckReadonlyStatement 对整段 SQL 做 prepare（不执行），用 sqlite3_stmt_readonly 判断首条语句是否只读。
// 见 https://sqlite.org/c3ref/stmt_readonly.html
//
// 注意：若字符串里在语法上还有第二条及以后的语句，本函数只针对「首条」对应的 stmt 做判断，
// 不会拒绝多语句。与 CheckSingleStatement 组合即可得到「单条 + 只读」策略。
// 仅允许 SELECT 和 WITH 查询，避免 SQLite 将 ATTACH、DETACH 和事务控制语句标记为只读后放行。
func CheckReadonlyStatement(stmt string) error {
	return checkReadonlyStatement(stmt, db)
}

// CheckAssetContentReadonlyStatement 在资源文件内容数据库连接上检查 SQL 是否只读。
func CheckAssetContentReadonlyStatement(stmt string) error {
	return checkReadonlyStatement(stmt, assetContentDB)
}

// CheckReadonlyStatementInBox 在指定笔记本对应的数据库连接上检查 SQL 是否只读。
func CheckReadonlyStatementInBox(stmt, boxID string) error {
	targetDB := db
	if boxDB := GetEncryptedDB(boxID); nil != boxDB {
		targetDB = boxDB
	} else if IsEncryptedBoxFn != nil && IsEncryptedBoxFn(boxID) {
		return errors.New("encrypted box db not opened for box " + boxID)
	}
	return checkReadonlyStatement(stmt, targetDB)
}

func checkReadonlyStatement(stmt string, targetDB *sql.DB) error {
	if strings.TrimSpace(stmt) == "" {
		return errors.New("SQL statement is empty")
	}
	if !isReadonlyQueryStatement(stmt) {
		return errors.New("SQL statement is not a read-only query")
	}
	if nil == targetDB {
		return errors.New("database is nil")
	}
	ctx := context.Background()
	conn, err := targetDB.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()

	return conn.Raw(func(dc any) error {
		sqliteConn, ok := dc.(*sqlite3.SQLiteConn)
		if !ok {
			return fmt.Errorf("SQL driver connection type is unexpected: %T", dc)
		}
		ds, err := sqliteConn.Prepare(stmt)
		if err != nil {
			return err
		}
		defer ds.Close()

		sst, ok := ds.(*sqlite3.SQLiteStmt)
		if !ok {
			return fmt.Errorf("SQL driver statement type is unexpected: %T", ds)
		}
		if !sst.Readonly() {
			return errors.New("SQL statement is not read-only")
		}
		return nil
	})
}

// isReadonlyQueryStatement 仅允许查询语句进入 SQLite prepare，提前拒绝会被 sqlite3_stmt_readonly
// 视为只读的 ATTACH、DETACH 和事务控制语句。WITH 中的写操作仍由 sqlite3_stmt_readonly 拒绝。
func isReadonlyQueryStatement(stmt string) bool {
	stmt = strings.TrimSpace(stmt)
	for "" != stmt {
		switch {
		case strings.HasPrefix(stmt, "--"):
			if lineEnd := strings.IndexByte(stmt, '\n'); 0 <= lineEnd {
				stmt = strings.TrimSpace(stmt[lineEnd+1:])
				continue
			}
			return false
		case strings.HasPrefix(stmt, "/*"):
			if commentEnd := strings.Index(stmt[2:], "*/"); 0 <= commentEnd {
				stmt = strings.TrimSpace(stmt[commentEnd+4:])
				continue
			}
			return false
		}
		break
	}

	keywordEnd := strings.IndexFunc(stmt, func(r rune) bool {
		return !unicode.IsLetter(r)
	})
	if 0 > keywordEnd {
		keywordEnd = len(stmt)
	}
	switch strings.ToUpper(stmt[:keywordEnd]) {
	case "SELECT", "WITH":
		return true
	}
	return false
}
