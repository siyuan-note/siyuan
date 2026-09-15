package sql

import (
	"errors"

	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// RefreshHPathsBatch 只在普通索引空闲时执行一个批次，不占用普通任务队列等待下一批。
func RefreshHPathsBatch(doc *treenode.BlockTree, blockAfter, treeAfter int64, limit int) (nextBlock, nextTree int64, done, busy bool, err error) {
	if !initDatabaseLock.TryLock() {
		return blockAfter, treeAfter, false, true, nil
	}
	defer initDatabaseLock.Unlock()
	dbQueueLock.Lock()
	pending := len(operationQueue) != 0
	dbQueueLock.Unlock()
	if pending || util.IsExiting.Load() {
		return blockAfter, treeAfter, false, true, nil
	}
	nextBlock, nextTree = blockAfter, treeAfter
	blockDone := false
	nextTree, treeDone, err := treenode.RefreshBlockHPathsBatch(doc, treeAfter, limit, func() error {
		tx, txErr := beginTxForBox(doc.BoxID)
		if txErr != nil {
			return txErr
		}
		defer tx.Rollback()
		// 同时取得游标和需要清理缓存的块，多读一行判断本批是否已经完成文档。
		rows, txErr := tx.Query("SELECT rowid, id, hpath FROM blocks WHERE root_id = ? AND box = ? AND path = ? AND rowid > ? ORDER BY rowid LIMIT ?", doc.ID, doc.BoxID, doc.Path, blockAfter, limit+1)
		if txErr != nil {
			return txErr
		}
		last, count := blockAfter, 0
		blockDone = true
		var ids []string
		for rows.Next() {
			if count == limit {
				blockDone = false
				break
			}
			var id, hpath string
			if txErr = rows.Scan(&last, &id, &hpath); txErr != nil {
				rows.Close()
				return txErr
			}
			count++
			if hpath != doc.HPath {
				ids = append(ids, id)
			}
		}
		txErr = rows.Err()
		rows.Close()
		if txErr != nil {
			return txErr
		}
		if len(ids) > 0 {
			if _, txErr = tx.Exec("UPDATE blocks SET hpath = ? WHERE root_id = ? AND box = ? AND path = ? AND rowid > ? AND rowid <= ? AND hpath != ?", doc.HPath, doc.ID, doc.BoxID, doc.Path, blockAfter, last, doc.HPath); txErr != nil {
				return txErr
			}
		}
		if txErr = tx.Commit(); txErr != nil {
			return txErr
		}
		for _, id := range ids {
			removeBlockCache(id)
		}
		nextBlock = last
		return nil
	})
	if errors.Is(err, treenode.ErrHPathRefreshBusy) {
		return blockAfter, treeAfter, false, true, nil
	}
	return nextBlock, nextTree, blockDone && treeDone, false, err
}
