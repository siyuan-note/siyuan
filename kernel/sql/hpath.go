package sql

import (
	"database/sql"
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
		var last sql.NullInt64
		if txErr = tx.QueryRow("SELECT MAX(rowid) FROM (SELECT rowid FROM blocks WHERE root_id = ? AND box = ? AND path = ? AND rowid > ? ORDER BY rowid LIMIT ?)", doc.ID, doc.BoxID, doc.Path, blockAfter, limit).Scan(&last); txErr != nil {
			return txErr
		}
		blockDone = !last.Valid
		if last.Valid {
			rows, queryErr := tx.Query("SELECT id FROM blocks WHERE root_id = ? AND box = ? AND path = ? AND rowid > ? AND rowid <= ? AND hpath != ?", doc.ID, doc.BoxID, doc.Path, blockAfter, last.Int64, doc.HPath)
			if queryErr != nil {
				return queryErr
			}
			var ids []string
			for rows.Next() {
				var id string
				if queryErr = rows.Scan(&id); queryErr != nil {
					rows.Close()
					return queryErr
				}
				ids = append(ids, id)
			}
			queryErr = rows.Err()
			rows.Close()
			if queryErr != nil {
				return queryErr
			}
			if len(ids) > 0 {
				if _, txErr = tx.Exec("UPDATE blocks SET hpath = ? WHERE root_id = ? AND box = ? AND path = ? AND rowid > ? AND rowid <= ? AND hpath != ?", doc.HPath, doc.ID, doc.BoxID, doc.Path, blockAfter, last.Int64, doc.HPath); txErr != nil {
					return txErr
				}
			}
			if txErr = tx.Commit(); txErr != nil {
				return txErr
			}
			for _, id := range ids {
				removeBlockCache(id)
			}
			nextBlock = last.Int64
			return nil
		}
		return tx.Commit()
	})
	if errors.Is(err, treenode.ErrHPathRefreshBusy) {
		return blockAfter, treeAfter, false, true, nil
	}
	return nextBlock, nextTree, blockDone && treeDone, false, err
}
