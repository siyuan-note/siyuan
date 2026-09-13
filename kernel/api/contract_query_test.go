package api

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/model"
)

// testSQLContractQueries 使用契约测试进程的独立数据库，避免修改运行中的工作空间。
func testSQLContractQueries(t *testing.T) {
	t.Helper()
	limit := model.Conf.Search.Limit
	model.Conf.Search.Limit = 2
	defer func() { model.Conf.Search.Limit = limit }()
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
}
