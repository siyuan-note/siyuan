//go:build fts5

package model

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestFileOperationFixtureDropsPendingIndexAfterDatabaseClose(t *testing.T) {
	oldQueueDir := util.QueueDir
	queueDir := t.TempDir()
	t.Cleanup(func() { util.QueueDir = oldQueueDir })
	t.Run("fixture", func(t *testing.T) {
		fixture := setupFileOperationTest(t)
		// 数据库夹具关闭后追加索引，模拟未初始化数据库的用例留下待处理文档。
		t.Cleanup(func() {
			util.QueueDir = queueDir
			tree, err := filesys.LoadTree(fixture.box.ID, fixture.sourcePath, util.NewLute())
			if err != nil {
				t.Fatal(err)
			}
			sql.IndexTreeQueue(tree)
		})
		setupFoldTransactionDatabase(t, fixture)
	})
	data, err := os.ReadFile(filepath.Join(queueDir, "index.queue"))
	if err != nil && !os.IsNotExist(err) {
		t.Fatal(err)
	}
	if len(data) != 0 {
		t.Fatalf("deleted fixture retained pending index data: %s", data)
	}
	// 后续用例清理密钥时刷新队列，不应访问已关闭的数据库或已释放的配置。
	sql.FlushQueue()
}
