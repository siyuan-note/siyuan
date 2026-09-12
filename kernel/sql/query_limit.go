package sql

import (
	"errors"
	"math"
	"strings"
)

// QueryLimitInfo 描述服务端默认限制；Limit 为零表示使用 SQL 自身的限制。
type QueryLimitInfo struct {
	Limit     int  `json:"limit"`
	Truncated bool `json:"truncated"`
}

// QueryWithLimitInfo 在同一次查询中多读取一行，判断默认限制是否截断了结果。
func QueryWithLimitInfo(stmt string, limit int) (rows []map[string]any, info QueryLimitInfo, err error) {
	if limit < 1 || limit == math.MaxInt {
		return nil, info, errors.New("invalid default SQL limit")
	}
	info.Limit = limit
	rows, err = queryWithLimitInfo(stmt, limit+1, &info)
	if err != nil {
		return nil, QueryLimitInfo{}, err
	}
	if info.Limit > 0 && len(rows) > limit {
		info.Truncated = true
		rows = rows[:limit]
	}
	if rows == nil {
		rows = []map[string]any{}
	}
	return
}

// containsOuterLimitClause 检查最后一条非空语句的外层 LIMIT，跳过引号、注释和括号内的内容。
// 多语句查询由 SQLite 执行，返回结果对应最后一条语句。
func containsOuterLimitClause(stmt string) bool {
	depth, found, nextStatement := 0, false, false
	for i := 0; i < len(stmt); {
		ch := stmt[i]
		if ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n' || ch == '\f' {
			i++
			continue
		}
		if i+1 < len(stmt) && stmt[i:i+2] == "--" {
			i += 2
			for i < len(stmt) && stmt[i] != '\n' {
				i++
			}
			continue
		}
		if i+1 < len(stmt) && stmt[i:i+2] == "/*" {
			end := strings.Index(stmt[i+2:], "*/")
			if end < 0 {
				break
			}
			i += end + 4
			continue
		}
		if ch == ';' && depth == 0 {
			nextStatement = true
			i++
			continue
		}
		if nextStatement {
			found, nextStatement = false, false
		}
		if ch == '\'' || ch == '"' || ch == '`' || ch == '[' {
			end := ch
			if ch == '[' {
				end = ']'
			}
			i++
			for i < len(stmt) {
				if stmt[i] == end {
					i++
					if ch != '[' && i < len(stmt) && stmt[i] == end {
						i++
						continue
					}
					break
				}
				i++
			}
			continue
		}
		if ch == '(' {
			depth++
		} else if ch == ')' {
			depth--
		}
		if isSQLLimitWordByte(ch) {
			start := i
			for i < len(stmt) && isSQLLimitWordByte(stmt[i]) {
				i++
			}
			if depth == 0 && strings.EqualFold(stmt[start:i], "limit") {
				found = true
			}
			continue
		}
		i++
	}
	return found
}

func isSQLLimitWordByte(ch byte) bool {
	return ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9' || ch == '_' || ch == '$' || ch >= 0x80
}
