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
	gosql "database/sql"
	"testing"
	"text/template"
)

func TestSQLTemplateFuncsAllowReadonlyQueriesAndRejectWrites(t *testing.T) {
	testDB, err := gosql.Open("sqlite3_extended", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	testDB.SetMaxOpenConns(1)
	defer testDB.Close()
	if _, err = testDB.Exec("CREATE TABLE blocks (id TEXT)"); err != nil {
		t.Fatal(err)
	}
	if _, err = testDB.Exec("INSERT INTO blocks VALUES ('block-1')"); err != nil {
		t.Fatal(err)
	}
	if _, err = testDB.Exec("CREATE TABLE spans (id TEXT, block_id TEXT, root_id TEXT, box TEXT, path TEXT, content TEXT, markdown TEXT, type TEXT, ial TEXT)"); err != nil {
		t.Fatal(err)
	}
	if _, err = testDB.Exec("INSERT INTO spans VALUES ('span-1', 'block-1', 'root-1', 'box-1', '/doc.sy', 'content', 'markdown', 'text', '')"); err != nil {
		t.Fatal(err)
	}

	previousDB := db
	db = testDB
	defer func() {
		db = previousDB
	}()

	funcs := template.FuncMap{}
	SQLTemplateFuncs(&funcs)

	querySQL := funcs["querySQL"].(func(string) []map[string]any)
	rows := querySQL("SELECT id FROM blocks")
	if 1 != len(rows) || "block-1" != rows[0]["id"] {
		t.Fatalf("只读模板查询结果不正确：%v", rows)
	}

	querySpans := funcs["querySpans"].(func(string, ...string) []*Span)
	spans := querySpans("SELECT * FROM spans LIMIT ?", "1")
	if 1 != len(spans) || "span-1" != spans[0].ID {
		t.Fatalf("带参数的只读模板查询结果不正确：%v", spans)
	}

	queryBlocks := funcs["queryBlocks"].(func(string, ...string) []*Block)
	queryBlocks("SELECT * FROM blocks; DELETE FROM blocks")
	querySQL("DELETE FROM blocks RETURNING id")

	var count int
	if err = testDB.QueryRow("SELECT COUNT(*) FROM blocks").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if 1 != count {
		t.Fatalf("模板查询执行了写入语句，剩余块数量：%d", count)
	}
}
