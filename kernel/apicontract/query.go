package apicontract

import (
	"bytes"
	"encoding/json"
	"fmt"
)

type SQLQueryRequest struct {
	Stmt string `json:"stmt" api:"trim"`
	Mode string `json:"mode" api:"optional,nullable"`
}

// SQLValue 保留数据库标量的 JSON 表示，包括整数精度和二进制值的 Base64 文本。
type SQLValue struct{ raw json.RawMessage }

func (v SQLValue) MarshalJSON() ([]byte, error) {
	if len(v.raw) == 0 {
		return []byte("null"), nil
	}
	return v.raw, nil
}

func (v *SQLValue) UnmarshalJSON(data []byte) error {
	data = bytes.TrimSpace(data)
	if !json.Valid(data) || data[0] == '{' || data[0] == '[' {
		return fmt.Errorf("SQL value must be a JSON scalar")
	}
	v.raw = append(v.raw[:0], data...)
	return nil
}

type SQLRows []map[string]SQLValue

type SQLQueryLimit struct {
	Limit     int  `json:"limit"`
	Truncated bool `json:"truncated"`
}

// SuccessSQL 将限额信息保留在信封顶层，查询结果仍位于 data。
func SuccessSQL(rows SQLRows, limit int, truncated bool) Response[SQLRows] {
	return Response[SQLRows]{data: rows, queryLimit: &SQLQueryLimit{Limit: limit, Truncated: truncated}}
}
