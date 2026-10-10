//go:build fts5

package model

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestSQLSearchPreservesCommentsAndLiteralCase(t *testing.T) {
	const childEnv = "SIYUAN_TEST_SQL_SEARCH_COMMENTS"
	if os.Getenv(childEnv) != "1" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestSQLSearchPreservesCommentsAndLiteralCase$", "-test.timeout=30s")
		cmd.Env = append(os.Environ(), childEnv+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("SQL search regression failed: %v\n%s", err, output)
		}
		return
	}
	util.TempDir, util.DataDir = t.TempDir(), t.TempDir()
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.DBPath = filepath.Join(util.TempDir, "siyuan.db")
	util.BlockTreeDBPath = filepath.Join(util.TempDir, "blocktree.db")
	util.HistoryDBPath = filepath.Join(util.TempDir, "history.db")
	util.AssetContentDBPath = filepath.Join(util.TempDir, "asset_content.db")
	Conf = NewAppConf()
	Conf.Search, Conf.FileTree = conf.NewSearch(), conf.NewFileTree()
	sql.InitDatabase(true)
	sql.InitHistoryDatabase(true)
	sql.InitAssetContentDatabase(true)
	t.Cleanup(sql.CloseDatabase)
	const id = "20261010120000-sqltest"
	if err := sql.Exec("INSERT INTO blocks VALUES ('" + id + "', '', '" + id + "', '', '', '', '/Document', '', '', '', '', 'ABC', '', 'ABC', 3, 'p', '', '', 0, '20261010120000', '20261010120000')"); err != nil {
		t.Fatal(err)
	}
	for _, stmt := range []string{
		"SELECT * FROM blocks WHERE content='ABC'",
		"SELECT b.* FROM blocks b WHERE b.content='ABC'",
		"-- first comment\nSELECT b.* FROM blocks b -- second comment\nWHERE b.content='ABC'",
		"WITH RECURSIVE selected(id) AS (SELECT id FROM blocks WHERE content='ABC')\nSELECT b.* FROM blocks b JOIN selected s ON s.id=b.id -- trailing comment",
	} {
		t.Run(stmt, func(t *testing.T) {
			blocks, count, roots, pages, _ := FullTextSearchBlock(BlockSearchOptions{
				Query: stmt, Method: 2, Page: 1, PageSize: 10,
			})
			if len(blocks) != 1 || blocks[0].ID != id || count != 1 || roots != 1 || pages != 1 {
				t.Fatalf("SQL search returned blocks=%+v, count=%d roots=%d pages=%d", blocks, count, roots, pages)
			}
		})
	}
}
