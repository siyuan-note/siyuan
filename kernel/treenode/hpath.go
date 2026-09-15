package treenode

import (
	"database/sql"
	"errors"
	"path"
	"strings"

	"github.com/88250/lute/parse"
)

var ErrHPathRefreshBusy = errors.New("blocktree writer is busy")

const blockHPathBatchQuery = "SELECT rowid FROM blocktrees WHERE root_id = ? AND box_id = ? AND path = ? AND rowid > ? ORDER BY rowid LIMIT ?"

func ensureHPathIndexes(database *sql.DB) error {
	for _, stmt := range []string{
		"CREATE INDEX IF NOT EXISTS idx_blocktrees_doc_path ON blocktrees(box_id, path) WHERE type = 'd'",
		"CREATE INDEX IF NOT EXISTS idx_blocktrees_root_box ON blocktrees(root_id, box_id)",
	} {
		if _, err := database.Exec(stmt); err != nil {
			return err
		}
	}
	return nil
}

// DocHPaths 返回文档及其后代的文档行，不加载正文或枚举内容块。
func DocHPaths(boxID, docPath string) (ret []*BlockTree, err error) {
	prefix := strings.TrimSuffix(docPath, ".sy") + "/"
	rows, err := queryForBox(boxID, "SELECT id, path, hpath FROM blocktrees WHERE box_id = ? AND type = 'd' AND (path = ? OR (path >= ? AND path < ?)) ORDER BY path", boxID, docPath, prefix, prefix+"\uffff")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		bt := &BlockTree{BoxID: boxID, Type: "d"}
		if err = rows.Scan(&bt.ID, &bt.Path, &bt.HPath); err != nil {
			return nil, err
		}
		bt.RootID = bt.ID
		ret = append(ret, bt)
	}
	return ret, rows.Err()
}

// RefreshDocHPaths 同步维护文档行，保证按可读路径定位、创建文档时不会命中过期的父路径。
// 内容块的路径副本由后台补齐，重命名不删除或重建块树。
func RefreshDocHPaths(tree *parse.Tree) (err error) {
	indexBlockTreeLock.Lock()
	defer indexBlockTreeLock.Unlock()
	current := GetBlockTreeInBox(tree.ID, tree.Box)
	if current == nil || current.BoxID != tree.Box || current.Path != tree.Path {
		return errors.New("document moved or was removed during hpath refresh")
	}
	docs, err := DocHPaths(tree.Box, tree.Path)
	if err != nil {
		return err
	}
	tx, err := beginTxForBox(tree.Box)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	depth := strings.Count(tree.Path, "/")
	for _, doc := range docs {
		hpath := tree.HPath
		if doc.Path != tree.Path {
			parts := strings.Split(doc.HPath, "/")
			if len(parts) <= depth+1 {
				return errors.New("invalid descendant document hpath")
			}
			hpath += "/" + strings.Join(parts[depth+1:], "/")
		}
		if _, err = tx.Exec("UPDATE blocktrees SET hpath = ? WHERE id = ? AND box_id = ? AND path = ? AND type = 'd' AND hpath != ?", hpath, doc.ID, tree.Box, doc.Path, hpath); err != nil {
			return err
		}
	}
	if _, err = tx.Exec("UPDATE blocktrees SET updated = ? WHERE id = ? AND box_id = ? AND type = 'd'", tree.Root.IALAttr("updated"), tree.ID, tree.Box); err != nil {
		return err
	}
	return tx.Commit()
}

// CurrentTreeHPath 使排队期间加载的树使用最新文档路径，避免旧索引操作写回重命名前的路径。
func CurrentTreeHPath(tree *parse.Tree) string {
	if doc := GetBlockTreeInBox(tree.ID, tree.Box); doc != nil && doc.BoxID == tree.Box && doc.Path == tree.Path {
		return doc.HPath
	}
	return tree.HPath
}

// CurrentParentHPath 保留本次编辑的标题，同时采用当前父文档路径。
func CurrentParentHPath(tree *parse.Tree) string {
	parent := path.Dir(tree.Path)
	if parent == "/" {
		return tree.HPath
	}
	if doc := GetBlockTreeInBox(path.Base(parent), tree.Box); doc != nil && doc.BoxID == tree.Box && doc.Path == parent+".sy" {
		return doc.HPath + "/" + tree.Root.IALAttr("title")
	}
	return tree.HPath
}

// RefreshBlockHPathsBatch 在块树写锁内校验文档快照，并提交一个有界批次。
// apply 在同一临界区更新内容库；两库任一提交失败时，由未清除的恢复任务重试。
func RefreshBlockHPathsBatch(doc *BlockTree, after int64, limit int, apply func() error) (next int64, done bool, err error) {
	if limit < 1 || limit > 512 {
		return after, false, errors.New("invalid hpath batch limit")
	}
	if !indexBlockTreeLock.TryLock() {
		return after, false, ErrHPathRefreshBusy
	}
	defer indexBlockTreeLock.Unlock()
	current := GetBlockTreeInBox(doc.ID, doc.BoxID)
	if current == nil || current.BoxID != doc.BoxID || current.Path != doc.Path || current.HPath != doc.HPath {
		return after, false, errors.New("document changed during hpath refresh")
	}
	tx, err := beginTxForBox(doc.BoxID)
	if err != nil {
		return after, false, err
	}
	defer tx.Rollback()
	// 多读取一行判断是否还有下一批，末批在当前事务中确认完成。
	rows, err := tx.Query(blockHPathBatchQuery, doc.ID, doc.BoxID, doc.Path, after, limit+1)
	if err != nil {
		return after, false, err
	}
	last, count, done := after, 0, true
	for rows.Next() {
		if count == limit {
			done = false
			break
		}
		if err = rows.Scan(&last); err != nil {
			rows.Close()
			return after, false, err
		}
		count++
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return after, false, err
	}
	if count > 0 {
		if _, err = tx.Exec("UPDATE blocktrees SET hpath = ? WHERE root_id = ? AND box_id = ? AND path = ? AND rowid > ? AND rowid <= ? AND hpath != ?", doc.HPath, doc.ID, doc.BoxID, doc.Path, after, last, doc.HPath); err != nil {
			return after, false, err
		}
	}
	if err = apply(); err != nil {
		return after, false, err
	}
	if err = tx.Commit(); err != nil {
		return after, false, err
	}
	return last, done, nil
}
