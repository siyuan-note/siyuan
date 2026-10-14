//go:build fts5

package model

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// closeModelTestDatabases 在删除临时工作区之前停止后台刷新并清除其待处理索引。
func closeModelTestDatabases() {
	FlushTxQueue()
	backgroundRefreshWaitGroup.Wait()
	sql.ClearQueue()
	sql.CloseDatabase()
}

func TestNotebookDocumentImportFixtureDropsPendingIndex(t *testing.T) {
	const boxID = "20261013000000-box0001"
	root := t.TempDir()
	queuePath := filepath.Join(root, "queue", "index.queue")
	originalConf, originalQueueDir := Conf, util.QueueDir
	t.Run("database", func(t *testing.T) {
		setupExportRelatedTest(t, boxID)
		// 队列放在父用例的临时目录中，以便数据库夹具释放后检查持久化内容。
		util.TempDir = root
		setupNotebookDocumentImportDatabase(t)
		tree := treenode.NewTree(boxID, "/20261013000001-doc0001.sy", "/Queued", "Queued")
		writeExportRelatedTestTree(t, tree)
		sql.IndexTreeQueue(tree)
		data, err := os.ReadFile(queuePath)
		if err != nil || len(data) == 0 {
			t.Fatalf("fixture did not persist pending index: %q, %v", data, err)
		}
		// 模拟清理开始后才完成的后台刷新，它也必须在关库前被回收。
		runBackgroundRefresh(10*time.Millisecond, func() { sql.IndexTreeQueue(tree) })
	})
	data, err := os.ReadFile(queuePath)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) != 0 {
		t.Fatalf("closed fixture retained pending index: %s", data)
	}
	if Conf != originalConf || util.QueueDir != originalQueueDir {
		t.Fatal("database fixture did not restore configuration and queue path")
	}
	// 空队列的刷新不依赖已关闭的数据库，密钥清理也不能访问先前夹具的索引。
	sql.FlushQueue()
	t.Run("encrypted clipboard", TestPrepareRichClipboardAssetsDecryptsEncryptedNotebook)
}
