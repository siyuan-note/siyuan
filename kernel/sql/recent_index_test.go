package sql

import (
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func TestRecentUpdatedBlocksIndexesPreserveResults(t *testing.T) {
	database := createGraphTestBlocksTable(t)
	previous := db
	db = database
	t.Cleanup(func() { db = previous })
	insert := func(id, blockType, updated string, length int) {
		t.Helper()
		if _, err := database.Exec("INSERT INTO blocks VALUES (?, '', 'root', '', 'box', '/doc.sy', '/doc', '', '', '', '', 'content', '', 'markdown', ?, ?, '', '', 0, '2026', ?)", id, length, blockType, updated); err != nil {
			t.Fatal(err)
		}
	}
	for _, blockType := range []string{"p", "d"} {
		for i := 0; i < 40; i++ {
			insert(fmt.Sprintf("%s-%02d", blockType, i), blockType, fmt.Sprintf("20261008%06d", i), 8)
		}
	}
	insert("short", "p", "20991231235959", 1)
	insert("heading", "h", "20991231235959", 8)
	ids := func(blocks []*Block) []string {
		ret := make([]string, 0, len(blocks))
		for _, block := range blocks {
			ret = append(ret, block.ID)
		}
		return ret
	}
	conditions := []string{"type = 'p' AND length > 1", "type = 'd'"}
	var before [][]string
	for _, condition := range conditions {
		before = append(before, ids(SelectBlocksRawStmt("SELECT * FROM blocks WHERE "+condition+" ORDER BY updated DESC", 1, 16)))
		before = append(before, ids(SelectBlocksRawStmt("SELECT * FROM blocks WHERE "+condition+" AND id NOT LIKE '%-39' ORDER BY updated DESC", 1, 16)))
	}
	for i := 0; i < 2; i++ {
		if err := ensureRecentUpdatedBlocksIndexes(database); err != nil {
			t.Fatal(err)
		}
	}
	var after [][]string
	for i, condition := range conditions {
		for _, ignore := range []string{"", " AND id NOT LIKE '%-39'"} {
			stmt := "SELECT * FROM blocks WHERE " + condition + ignore + " ORDER BY updated DESC"
			after = append(after, ids(SelectBlocksRawStmt(stmt, 1, 16)))
			index := "idx_blocks_recent_p"
			if i == 1 {
				index = "idx_blocks_recent_d"
			}
			plan := queryPlanDetails(t, database, stmt+" LIMIT 16 OFFSET 0")
			if !strings.Contains(plan, index) || strings.Contains(plan, "TEMP B-TREE") {
				t.Fatalf("recent query scans or sorts without its index: %s", plan)
			}
		}
	}
	if !reflect.DeepEqual(before, after) || len(after[0]) != 16 || after[0][0] != "p-39" || after[2][0] != "d-39" {
		t.Fatalf("recent results changed: before=%v after=%v", before, after)
	}
	// 更新时间和展示条件改变后，索引同步反映新结果，无需失效缓存。
	if _, err := database.Exec("UPDATE blocks SET updated = '20991231235959' WHERE id IN ('p-00', 'd-00')"); err != nil {
		t.Fatal(err)
	}
	for i, condition := range conditions {
		results := ids(SelectBlocksRawStmt("SELECT * FROM blocks WHERE "+condition+" ORDER BY updated DESC", 1, 16))
		if results[0] != []string{"p-00", "d-00"}[i] {
			t.Fatalf("updated block missing from recent results: %v", results)
		}
	}
	if _, err := database.Exec("UPDATE blocks SET length = 1 WHERE id = 'p-00'"); err != nil {
		t.Fatal(err)
	}
	results := ids(SelectBlocksRawStmt("SELECT * FROM blocks WHERE type = 'p' AND length > 1 ORDER BY updated DESC", 1, 16))
	if results[0] != "p-39" {
		t.Fatalf("short paragraph still in recent results: %v", results)
	}
}
