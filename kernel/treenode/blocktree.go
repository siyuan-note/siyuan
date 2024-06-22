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

package treenode

import (
	"bytes"
	"database/sql"
	"errors"
	"os"
	"runtime"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type BlockTree struct {
	ID       string // 块 ID
	RootID   string // 根 ID
	ParentID string // 父 ID
	BoxID    string // 笔记本 ID
	Path     string // 文档数据路径
	HPath    string // 文档可读路径
	Updated  string // 更新时间
	Type     string // 类型
}

var (
	db *sql.DB
)

func initDatabase(forceRebuild bool) (err error) {
	initDBConnection()

	if !forceRebuild {
		if !gulu.File.IsExist(util.BlockTreeDBPath) {
			forceRebuild = true
		}
	}
	if !forceRebuild {
		return
	}

	closeDatabase()
	if gulu.File.IsExist(util.BlockTreeDBPath) {
		if err = removeDatabaseFile(); nil != err {
			logging.LogErrorf("remove database file [%s] failed: %s", util.BlockTreeDBPath, err)
			err = nil
		}
	}

	initDBConnection()
	initDBTables()

	logging.LogInfof("reinitialized database [%s]", util.BlockTreeDBPath)
	return
}

func initDBTables() {
	_, err := db.Exec("DROP TABLE IF EXISTS blocktrees")
	if nil != err {
		logging.LogFatalf(logging.ExitCodeReadOnlyDatabase, "drop table [blocks] failed: %s", err)
	}
	_, err = db.Exec("CREATE TABLE blocktrees (id, root_id, parent_id, box_id, path, hpath, updated, type)")
	if nil != err {
		logging.LogFatalf(logging.ExitCodeReadOnlyDatabase, "create table [blocktrees] failed: %s", err)
	}
}

func initDBConnection() {
	if nil != db {
		closeDatabase()
	}
	dsn := util.BlockTreeDBPath + "?_journal_mode=WAL" +
		"&_synchronous=OFF" +
		"&_mmap_size=2684354560" +
		"&_secure_delete=OFF" +
		"&_cache_size=-20480" +
		"&_page_size=32768" +
		"&_busy_timeout=7000" +
		"&_ignore_check_constraints=ON" +
		"&_temp_store=MEMORY" +
		"&_case_sensitive_like=OFF"
	var err error
	db, err = sql.Open("sqlite3_extended", dsn)
	if nil != err {
		logging.LogFatalf(logging.ExitCodeReadOnlyDatabase, "create database failed: %s", err)
	}
	db.SetMaxIdleConns(7)
	db.SetMaxOpenConns(7)
	db.SetConnMaxLifetime(365 * 24 * time.Hour)
}

func CloseDatabase() {
	closeDatabase()
}

func closeDatabase() {
	if nil == db {
		return
	}

	if err := db.Close(); nil != err {
		logging.LogErrorf("close database failed: %s", err)
	}
	debug.FreeOSMemory()
	runtime.GC() // 没有这句的话文件句柄不会释放，后面就无法删除文件
	return
}

func removeDatabaseFile() (err error) {
	err = os.RemoveAll(util.BlockTreeDBPath)
	if nil != err {
		return
	}
	err = os.RemoveAll(util.BlockTreeDBPath + "-shm")
	if nil != err {
		return
	}
	err = os.RemoveAll(util.BlockTreeDBPath + "-wal")
	if nil != err {
		return
	}
	return
}

func GetBlockTreesByType(typ string) (ret []*BlockTree) {
	sqlStmt := "SELECT * FROM blocktrees WHERE type = ?"
	rows, err := db.Query(sqlStmt)
	if nil != err {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var block BlockTree
		if err = rows.Scan(&block.ID, &block.RootID, &block.ParentID, &block.BoxID, &block.Path, &block.HPath, &block.Updated, &block.Type); nil != err {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret = append(ret, &block)
	}
	return
}

func GetBlockTreeByPath(path string) (ret *BlockTree) {
	ret = &BlockTree{}
	sqlStmt := "SELECT * FROM blocktrees WHERE path = ?"
	err := db.QueryRow(sqlStmt, path).Scan(&ret.ID, &ret.RootID, &ret.ParentID, &ret.BoxID, &ret.Path, &ret.HPath, &ret.Updated, &ret.Type)
	if nil != err {
		ret = nil
		if errors.Is(err, sql.ErrNoRows) {
			return
		}
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	return
}

func CountTrees() (ret int) {
	sqlStmt := "SELECT COUNT(*) FROM blocktrees WHERE type = 'd'"
	err := db.QueryRow(sqlStmt).Scan(&ret)
	if nil != err {
		if errors.Is(err, sql.ErrNoRows) {
			return 0
		}
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
	}
	return
}

func CountBlocks() (ret int) {
	sqlStmt := "SELECT COUNT(*) FROM blocktrees"
	err := db.QueryRow(sqlStmt).Scan(&ret)
	if nil != err {
		if errors.Is(err, sql.ErrNoRows) {
			return 0
		}
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
	}
	return
}

func GetBlockTreeRootByPath(boxID, path string) (ret *BlockTree) {
	ret = &BlockTree{}
	sqlStmt := "SELECT * FROM blocktrees WHERE box_id = ? AND path = ? AND type = 'd'"
	err := db.QueryRow(sqlStmt, boxID, path).Scan(&ret.ID, &ret.RootID, &ret.ParentID, &ret.BoxID, &ret.Path, &ret.HPath, &ret.Updated, &ret.Type)
	if nil != err {
		ret = nil
		if errors.Is(err, sql.ErrNoRows) {
			return
		}
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	return
}

func GetBlockTreeRootByHPath(boxID, hPath string) (ret *BlockTree) {
	ret = &BlockTree{}
	hPath = gulu.Str.RemoveInvisible(hPath)
	sqlStmt := "SELECT * FROM blocktrees WHERE box_id = ? AND hpath = ? AND type = 'd'"
	err := db.QueryRow(sqlStmt, boxID, hPath).Scan(&ret.ID, &ret.RootID, &ret.ParentID, &ret.BoxID, &ret.Path, &ret.HPath, &ret.Updated, &ret.Type)
	if nil != err {
		ret = nil
		if errors.Is(err, sql.ErrNoRows) {
			return
		}
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	return
}

func GetBlockTreeRootsByHPath(boxID, hPath string) (ret []*BlockTree) {
	hPath = gulu.Str.RemoveInvisible(hPath)
	sqlStmt := "SELECT * FROM blocktrees WHERE box_id = ? AND hpath = ? AND type = 'd'"
	rows, err := db.Query(sqlStmt, boxID, hPath)
	if nil != err {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var block BlockTree
		if err = rows.Scan(&block.ID, &block.RootID, &block.ParentID, &block.BoxID, &block.Path, &block.HPath, &block.Updated, &block.Type); nil != err {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret = append(ret, &block)
	}
	return
}

func GetBlockTreeRootByHPathPreferredParentID(boxID, hPath, preferredParentID string) (ret *BlockTree) {
	hPath = gulu.Str.RemoveInvisible(hPath)
	var roots []*BlockTree
	sqlStmt := "SELECT * FROM blocktrees WHERE box_id = ? AND hpath = ? AND parent_id = ? AND type = 'd'"
	rows, err := db.Query(sqlStmt, boxID, hPath, preferredParentID)
	if nil != err {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var block BlockTree
		if err = rows.Scan(&block.ID, &block.RootID, &block.ParentID, &block.BoxID, &block.Path, &block.HPath, &block.Updated, &block.Type); nil != err {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		if "" == preferredParentID {
			ret = &block
			return
		}
		roots = append(roots, &block)
	}

	if 1 > len(roots) {
		return
	}

	for _, root := range roots {
		if root.ID == preferredParentID {
			ret = root
			return
		}
	}
	ret = roots[0]
	return
}

func ExistBlockTree(id string) bool {
	sqlStmt := "SELECT COUNT(*) FROM blocktrees WHERE id = ?"
	var count int
	err := db.QueryRow(sqlStmt, id).Scan(&count)
	if nil != err {
		if errors.Is(err, sql.ErrNoRows) {
			return false
		}
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return false
	}
	return 0 < count
}

func GetBlockTrees(ids []string) (ret map[string]*BlockTree) {
	ret = map[string]*BlockTree{}
	sqlStmt := "SELECT * FROM blocktrees WHERE id IN ('" + strings.Join(ids, "','") + "')"
	rows, err := db.Query(sqlStmt)
	if nil != err {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var block BlockTree
		if err = rows.Scan(&block.ID, &block.RootID, &block.ParentID, &block.BoxID, &block.Path, &block.HPath, &block.Updated, &block.Type); nil != err {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret[block.ID] = &block
	}
	return
}

func GetBlockTree(id string) (ret *BlockTree) {
	if "" == id {
		return
	}

	ret = &BlockTree{}
	sqlStmt := "SELECT * FROM blocktrees WHERE id = ?"
	err := db.QueryRow(sqlStmt, id).Scan(&ret.ID, &ret.RootID, &ret.ParentID, &ret.BoxID, &ret.Path, &ret.HPath, &ret.Updated, &ret.Type)
	if nil != err {
		ret = nil
		if errors.Is(err, sql.ErrNoRows) {
			return
		}
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, logging.ShortStack())
		return
	}
	return
}

func SetBlockTreePath(tree *parse.Tree) {
	RemoveBlockTreesByRootID(tree.ID)
	IndexBlockTree(tree)
}

func RemoveBlockTreesByRootID(rootID string) {
	sqlStmt := "DELETE FROM blocktrees WHERE root_id = ?"
	_, err := db.Exec(sqlStmt, rootID)
	if nil != err {
		logging.LogErrorf("sql exec [%s] failed: %s", sqlStmt, err)
		return
	}
}

func GetBlockTreesByPathPrefix(pathPrefix string) (ret []*BlockTree) {
	sqlStmt := "SELECT * FROM blocktrees WHERE path LIKE ?"
	rows, err := db.Query(sqlStmt, pathPrefix+"%")
	if nil != err {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var block BlockTree
		if err = rows.Scan(&block.ID, &block.RootID, &block.ParentID, &block.BoxID, &block.Path, &block.HPath, &block.Updated, &block.Type); nil != err {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret = append(ret, &block)
	}
	return
}

func GetBlockTreesByRootID(rootID string) (ret []*BlockTree) {
	sqlStmt := "SELECT * FROM blocktrees WHERE root_id = ?"
	rows, err := db.Query(sqlStmt, rootID)
	if nil != err {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var block BlockTree
		if err = rows.Scan(&block.ID, &block.RootID, &block.ParentID, &block.BoxID, &block.Path, &block.HPath, &block.Updated, &block.Type); nil != err {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret = append(ret, &block)
	}
	return
}

func RemoveBlockTreesByPathPrefix(pathPrefix string) {
	sqlStmt := "DELETE FROM blocktrees WHERE path LIKE ?"
	_, err := db.Exec(sqlStmt, pathPrefix+"%")
	if nil != err {
		logging.LogErrorf("sql exec [%s] failed: %s", sqlStmt, err)
		return
	}
}

func GetBlockTreesByBoxID(boxID string) (ret []*BlockTree) {
	sqlStmt := "SELECT * FROM blocktrees WHERE box_id = ?"
	rows, err := db.Query(sqlStmt, boxID)
	if nil != err {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var block BlockTree
		if err = rows.Scan(&block.ID, &block.RootID, &block.ParentID, &block.BoxID, &block.Path, &block.HPath, &block.Updated, &block.Type); nil != err {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret = append(ret, &block)
	}
	return
}

func RemoveBlockTreesByBoxID(boxID string) (ids []string) {
	sqlStmt := "SELECT id FROM blocktrees WHERE box_id = ?"
	rows, err := db.Query(sqlStmt, boxID)
	if nil != err {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); nil != err {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ids = append(ids, id)
	}

	sqlStmt = "DELETE FROM blocktrees WHERE box_id = ?"
	_, err = db.Exec(sqlStmt, boxID)
	if nil != err {
		logging.LogErrorf("sql exec [%s] failed: %s", sqlStmt, err)
		return
	}
	return
}

func RemoveBlockTree(id string) {
	sqlStmt := "DELETE FROM blocktrees WHERE id = ?"
	_, err := db.Exec(sqlStmt, id)
	if nil != err {
		logging.LogErrorf("sql exec [%s] failed: %s", sqlStmt, err)
		return
	}
}

var indexBlockTreeLock = sync.Mutex{}

func IndexBlockTree(tree *parse.Tree) {
	var changedNodes []*ast.Node
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !n.IsBlock() || "" == n.ID {
			return ast.WalkContinue
		}

		changedNodes = append(changedNodes, n)
		return ast.WalkContinue
	})

	indexBlockTreeLock.Lock()
	defer indexBlockTreeLock.Unlock()

	tx, err := db.Begin()
	if nil != err {
		logging.LogErrorf("begin transaction failed: %s", err)
		return
	}

	sqlStmt := "INSERT INTO blocktrees (id, root_id, parent_id, box_id, path, hpath, updated, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
	for _, n := range changedNodes {
		var parentID string
		if nil != n.Parent {
			parentID = n.Parent.ID
		}
		if _, err = tx.Exec(sqlStmt, n.ID, tree.ID, parentID, tree.Box, tree.Path, tree.HPath, n.IALAttr("updated"), TypeAbbr(n.Type.String())); nil != err {
			tx.Rollback()
			logging.LogErrorf("sql exec [%s] failed: %s", sqlStmt, err)
			return
		}
	}
	if err = tx.Commit(); nil != err {
		logging.LogErrorf("commit transaction failed: %s", err)
	}
}

func UpsertBlockTree(tree *parse.Tree) {
	oldBts := map[string]*BlockTree{}
	bts := GetBlockTreesByRootID(tree.ID)
	for _, bt := range bts {
		oldBts[bt.ID] = bt
	}

	var changedNodes []*ast.Node
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !n.IsBlock() || "" == n.ID {
			return ast.WalkContinue
		}

		if oldBt, found := oldBts[n.ID]; found {
			if oldBt.Updated != n.IALAttr("updated") || oldBt.Type != TypeAbbr(n.Type.String()) || oldBt.Path != tree.Path || oldBt.BoxID != tree.Box || oldBt.HPath != tree.HPath {
				children := ChildBlockNodes(n) // 需要考虑子块，因为一些操作（比如移动块）后需要同时更新子块
				changedNodes = append(changedNodes, children...)
			}
		} else {
			children := ChildBlockNodes(n)
			changedNodes = append(changedNodes, children...)
		}
		return ast.WalkContinue
	})

	ids := bytes.Buffer{}
	for i, n := range changedNodes {
		ids.WriteString("'")
		ids.WriteString(n.ID)
		ids.WriteString("'")
		if i < len(changedNodes)-1 {
			ids.WriteString(",")
		}
	}

	indexBlockTreeLock.Lock()
	defer indexBlockTreeLock.Unlock()

	tx, err := db.Begin()
	if nil != err {
		logging.LogErrorf("begin transaction failed: %s", err)
		return
	}

	sqlStmt := "DELETE FROM blocktrees WHERE id IN (" + ids.String() + ")"

	_, err = tx.Exec(sqlStmt)
	if nil != err {
		tx.Rollback()
		logging.LogErrorf("sql exec [%s] failed: %s", sqlStmt, err)
		return
	}
	sqlStmt = "INSERT INTO blocktrees (id, root_id, parent_id, box_id, path, hpath, updated, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
	for _, n := range changedNodes {
		var parentID string
		if nil != n.Parent {
			parentID = n.Parent.ID
		}
		if _, err = tx.Exec(sqlStmt, n.ID, tree.ID, parentID, tree.Box, tree.Path, tree.HPath, n.IALAttr("updated"), TypeAbbr(n.Type.String())); nil != err {
			tx.Rollback()
			logging.LogErrorf("sql exec [%s] failed: %s", sqlStmt, err)
			return
		}
	}
	if err = tx.Commit(); nil != err {
		logging.LogErrorf("commit transaction failed: %s", err)
	}
}

func InitBlockTree(force bool) {
	err := initDatabase(force)
	if nil != err {
		logging.LogErrorf("init database failed: %s", err)
		os.Exit(logging.ExitCodeReadOnlyDatabase)
		return
	}
	return
}

func CeilTreeCount(count int) int {
	if 100 > count {
		return 100
	}

	for i := 1; i < 40; i++ {
		if count < i*500 {
			return i * 500
		}
	}
	return 500*40 + 1
}

func CeilBlockCount(count int) int {
	if 5000 > count {
		return 5000
	}

	for i := 1; i < 100; i++ {
		if count < i*10000 {
			return i * 10000
		}
	}
	return 10000*100 + 1
}
