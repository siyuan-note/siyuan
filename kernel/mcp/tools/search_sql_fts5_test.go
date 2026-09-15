//go:build fts5

package tools

import (
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSearchSQLQueries(t *testing.T) {
	// 子进程隔离数据库连接和全局路径，所有数据写入临时目录。
	const childEnv = "SIYUAN_TEST_MCP_SEARCH_SQL"
	if os.Getenv(childEnv) != "1" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestSearchSQLQueries$", "-test.v")
		cmd.Env = append(os.Environ(), childEnv+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("search SQL subprocess failed: %v\n%s", err, output)
		}
		return
	}
	util.TempDir = t.TempDir()
	util.DataDir = t.TempDir()
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath = filepath.Join(util.TempDir, "siyuan.db")
	util.BlockTreeDBPath = filepath.Join(util.TempDir, "blocktree.db")
	util.HistoryDBPath = filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath = filepath.Join(util.TempDir, "asset_content.db")
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	t.Cleanup(sql.CloseDatabase)
	if err := sql.Exec("INSERT INTO blocks (id, type, hpath) VALUES ('row-1', 'p', '/中文ABC'), ('row-2', 'h', '/Other'), ('row-3', 'd', '/Third')"); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, stmt, want string
		isError          bool
	}{
		{"projection", "SELECT id, type FROM blocks ORDER BY id LIMIT 3", "| row-1 | p |", false},
		{"all columns", "SELECT * FROM blocks LIMIT 3", "row-1", false},
		{"aggregate", "SELECT count(*) AS total FROM blocks", "| 3 |", false},
		{"literal", "SELECT id FROM blocks WHERE hpath = '/中文ABC'", "| row-1 |", false},
		{"offset", "SELECT id FROM blocks ORDER BY id LIMIT 1 OFFSET 1", "| row-2 |", false},
		{"default limit", "WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM numbers WHERE n<101) SELECT n FROM numbers", "Query results (100 rows;", false},
		{"empty", "SELECT id FROM blocks WHERE 0", "no results", false},
		{"invalid", "SELECT missing FROM blocks", "readonly SQL required:", true},
		{"write", "DELETE FROM blocks", "readonly SQL required:", true},
		{"multiple", "SELECT id FROM blocks; DELETE FROM blocks", "invalid SQL:", true},
		{"missing", "", "stmt is required", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			args := map[string]any{"action": "fulltext", "method": float64(2), "query": tc.stmt,
				"page": float64(9), "pageSize": float64(1), "type": "heading", "path": "/ignored", "groupBy": float64(1)}
			got, err := searchHandler(args)
			if err != nil {
				t.Fatal(err)
			}
			want, err := sqlHandler(map[string]any{"action": "query", "stmt": tc.stmt})
			if err != nil || !reflect.DeepEqual(got, want) {
				t.Fatalf("search and SQL differ: search=%+v SQL=%+v err=%v", got, want, err)
			}
			if got.IsError != tc.isError || len(got.Content) != 1 || !strings.Contains(got.Content[0].Text, tc.want) {
				t.Fatalf("unexpected result: %+v", got)
			}
		})
	}
	const boxID = "20260915000000-mcpsql1"
	boxDir := filepath.Join(util.DataDir, boxID, ".siyuan")
	if err := os.MkdirAll(boxDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(boxDir, "conf.json"), []byte(`{"encrypted":true}`), 0644); err != nil {
		t.Fatal(err)
	}
	for _, notebooks := range []string{boxID, boxID + ",20260915000000-normal1"} {
		got, err := searchHandler(map[string]any{"action": "fulltext", "method": float64(2), "query": "SELECT id FROM blocks", "notebook": notebooks})
		if err != nil || !got.IsError || len(got.Content) != 1 || !strings.Contains(got.Content[0].Text, "encrypted") {
			t.Fatalf("encrypted search was not rejected: %+v, %v", got, err)
		}
	}
}
