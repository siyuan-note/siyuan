// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
)

// testSQLContractQueries 使用契约测试进程的独立数据库，避免修改运行中的工作空间。
func testSQLContractQueries(t *testing.T) {
	t.Helper()
	limit := model.Conf.Search.Load().Limit
	model.Conf.Search.Load().Limit = 2
	defer func() { model.Conf.Search.Load().Limit = limit }()
	engine := gin.New()
	engine.POST("/api/query/sql", SQL)
	for _, entry := range []struct {
		body               string
		code, count, limit int
		truncated          bool
	}{
		{`{"stmt":" SELECT 1 AS n UNION SELECT 2 UNION SELECT 3 "}`, 0, 2, 2, true},
		{`{"stmt":"SELECT 1 AS n UNION SELECT 2 UNION SELECT 3 LIMIT 3","mode":"readonly"}`, 0, 3, 0, false},
		{`{"stmt":"SELECT 1 AS n WHERE 0","mode":null}`, 0, 0, 2, false},
		{`{"stmt":"SELECT 1; SELECT 2 AS n","mode":"multiple"}`, 0, 1, 2, false},
		{`{"stmt":"SELECT * FROM missing_contract_table"}`, 1, 0, 0, false},
		{`{"stmt":"SELECT 1; SELECT 2"}`, -1, 0, 0, false},
		{`{"stmt":"DELETE FROM blocks","mode":"readonly"}`, -1, 0, 0, false},
		{`{"stmt":"SELECT 1","mode":" readonly "}`, -1, 0, 0, false},
		{`{"stmt":null}`, -1, 0, 0, false},
	} {
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/query/sql", strings.NewReader(entry.body)))
		requireAPIContract(t, "POST", "/api/query/sql", recorder)
		var response struct {
			Code      int                          `json:"code"`
			Data      []map[string]json.RawMessage `json:"data"`
			Limit     *int                         `json:"limit"`
			Truncated *bool                        `json:"truncated"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil || response.Code != entry.code {
			t.Fatalf("query response changed: %s, %v", recorder.Body.String(), err)
		}
		if entry.code != 0 {
			if response.Limit != nil || response.Truncated != nil || response.Data != nil {
				t.Fatalf("query failure leaked success metadata: %s", recorder.Body.String())
			}
		} else if response.Data == nil || len(response.Data) != entry.count || response.Limit == nil || *response.Limit != entry.limit || response.Truncated == nil || *response.Truncated != entry.truncated {
			t.Fatalf("query limit behavior changed: %s", recorder.Body.String())
		}
	}
	t.Run("SQL write modes", func(t *testing.T) { testSQLContractWriteModes(t, engine) })
}

func testSQLContractWriteModes(t *testing.T, engine *gin.Engine) {
	t.Helper()
	if err := sql.Exec("CREATE TABLE contract_sql_writes (id INTEGER PRIMARY KEY, n INTEGER NOT NULL)"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := sql.Exec("DROP TABLE contract_sql_writes"); err != nil {
			t.Error(err)
		}
	})
	type response struct {
		Code int                          `json:"code"`
		Data []map[string]json.RawMessage `json:"data"`
	}
	request := func(stmt, mode string, wantCode, wantRows int) response {
		t.Helper()
		encodedStmt, err := json.Marshal(stmt)
		if err != nil {
			t.Fatal(err)
		}
		body := map[string]json.RawMessage{"stmt": encodedStmt}
		if mode != "" {
			body["mode"] = json.RawMessage(mode)
		}
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		recorder := httptest.NewRecorder()
		engine.ServeHTTP(recorder, httptest.NewRequest("POST", "/api/query/sql", strings.NewReader(string(data))))
		requireAPIContract(t, "POST", "/api/query/sql", recorder)
		var result response
		if err = json.Unmarshal(recorder.Body.Bytes(), &result); err != nil || result.Code != wantCode || len(result.Data) != wantRows {
			t.Fatalf("stmt=%s mode=%s: %s, %v", stmt, mode, recorder.Body.String(), err)
		}
		if wantCode == 0 && result.Data == nil {
			t.Fatalf("successful write returned null: %s", recorder.Body.String())
		}
		return result
	}
	checkValue := func(want int) {
		t.Helper()
		rows, err := sql.QueryNoLimit("SELECT n FROM contract_sql_writes WHERE id = 1")
		if err != nil || len(rows) != 1 || rows[0]["n"] != int64(want) {
			t.Fatalf("stored value differs: rows=%v, want=%d, err=%v", rows, want, err)
		}
	}
	for _, mode := range []string{"", "null", `""`, `"readonly"`, `"multiple"`} {
		t.Run("mode="+mode, func(t *testing.T) {
			if err := sql.Exec("DELETE FROM contract_sql_writes; INSERT INTO contract_sql_writes VALUES (1, 1)"); err != nil {
				t.Fatal(err)
			}
			writeCode, returningRows, want := 0, 1, 3
			if mode == `"readonly"` {
				writeCode, returningRows, want = -1, 0, 1
			}
			request("UPDATE contract_sql_writes SET n = n + 1 WHERE id = 1", mode, writeCode, 0)
			returned := request("UPDATE contract_sql_writes SET n = n + 1 WHERE id = 1 RETURNING n", mode, writeCode, returningRows)
			if returningRows > 0 && string(returned.Data[0]["n"]) != "3" {
				t.Fatalf("RETURNING result changed: %v", returned.Data)
			}
			checkValue(want)
			failureCode := 1
			if mode == `"readonly"` {
				failureCode = -1
			}
			request("UPDATE contract_sql_writes SET n = NULL WHERE id = 1", mode, failureCode, 0)
			checkValue(want)
			request("INSERT INTO contract_sql_writes VALUES (2, 9)", mode, writeCode, 0)
			request("DELETE FROM contract_sql_writes WHERE id = 2", mode, writeCode, 0)
			multipleCode, multipleRows := -1, 0
			if mode == `"multiple"` {
				multipleCode, multipleRows, want = 0, 1, want+2
			}
			returned = request("UPDATE contract_sql_writes SET n = n + 1 WHERE id = 1; UPDATE contract_sql_writes SET n = n + 1 WHERE id = 1 RETURNING n; SELECT n FROM contract_sql_writes WHERE id = 1", mode, multipleCode, multipleRows)
			if multipleRows > 0 && string(returned.Data[0]["n"]) != "5" {
				t.Fatalf("last statement result changed: %v", returned.Data)
			}
			checkValue(want)
			request("SELECT 1; DELETE FROM contract_sql_writes", `"readonly"`, -1, 0)
			request("DELETE FROM contract_sql_writes RETURNING n", `"readonly"`, -1, 0)
			checkValue(want)
		})
	}
	request("UPDATE contract_sql_writes SET n = 8", `"unknown"`, -1, 0)
	checkValue(5)
	request("SELECT 1; UPDATE contract_sql_writes SET n = n + 1 WHERE id = 1", `"multiple"`, 0, 0)
	checkValue(6)
	request("UPDATE contract_sql_writes SET n = 7; INSERT INTO contract_sql_writes VALUES (1, 8); DELETE FROM contract_sql_writes", `"multiple"`, 1, 0)
	checkValue(7)
}
