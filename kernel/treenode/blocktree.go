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
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"runtime"
	"runtime/debug"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// DocumentIdentitySetGuard proves that the caller owns the exclusive side of
// documentIdentityLock. The private marker makes this interface impossible to
// implement outside treenode, while still allowing model transactions to pass
// the opaque token back to IdentityLocked mutation APIs.
type DocumentIdentitySetGuard interface {
	Unlock()
	documentIdentitySetGuard()
}

type documentIdentitySetGuard struct {
	active atomic.Bool
}

func (*documentIdentitySetGuard) documentIdentitySetGuard() {}

// DocumentIdentityMutationGuard proves that the caller owns the shared,
// ordinary-mutation side of documentIdentityLock. Its private marker prevents
// callers outside treenode from manufacturing a token and bypassing the lock.
// A model/filesystem transaction may pass this opaque token to MutationLocked
// helpers so one shared lock covers both blocktree and .sy publication.
type DocumentIdentityMutationGuard interface {
	Unlock()
	documentIdentityMutationGuard()
}

type documentIdentityMutationGuard struct {
	active atomic.Bool
}

func (*documentIdentityMutationGuard) documentIdentityMutationGuard() {}

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

	initDatabaseLock     = sync.RWMutex{}
	documentIdentityLock sync.RWMutex
	rootIdentityLocks    [256]sync.Mutex
)

// LockDocumentIdentitySet serializes raw document publication with index
// upsert/removal. Writers do not know nested block IDs until after staging a
// payload under the workspace lock, so taking per-block locks at that point
// would invert the indexer's identity-lock -> filelock order. This coarse lock
// deliberately trades document-index throughput for a simple deadlock-free
// global identity invariant.
func LockDocumentIdentitySet() DocumentIdentitySetGuard {
	documentIdentityLock.Lock()
	guard := &documentIdentitySetGuard{}
	guard.active.Store(true)
	return guard
}

// Unlock releases the exclusive document-identity domain. A guard is
// single-use; double release is a programming error.
func (guard *documentIdentitySetGuard) Unlock() {
	if guard == nil || !guard.active.CompareAndSwap(true, false) {
		panic("treenode: invalid document identity guard unlock")
	}
	documentIdentityLock.Unlock()
}

func requireDocumentIdentitySetGuard(guard DocumentIdentitySetGuard) error {
	concrete, ok := guard.(*documentIdentitySetGuard)
	if !ok || concrete == nil || !concrete.active.Load() {
		return errors.New("document identity set guard is not active")
	}
	return nil
}

// ValidateDocumentIdentitySetGuard lets transaction layers reject a missing
// or already released exclusive identity token before preparing mutations.
func ValidateDocumentIdentitySetGuard(guard DocumentIdentitySetGuard) error {
	return requireDocumentIdentitySetGuard(guard)
}

// LockDocumentIdentityMutation joins an ordinary editor/index transaction to
// the same identity domain as raw document publication. Ordinary transactions
// may proceed concurrently, while an exclusive raw .sy publication waits for
// the complete blocktree + filesystem transaction to finish.
func LockDocumentIdentityMutation() DocumentIdentityMutationGuard {
	documentIdentityLock.RLock()
	guard := &documentIdentityMutationGuard{}
	guard.active.Store(true)
	return guard
}

// Unlock releases the shared document-identity domain. A guard is single-use;
// double release is a programming error.
func (guard *documentIdentityMutationGuard) Unlock() {
	if guard == nil || !guard.active.CompareAndSwap(true, false) {
		panic("treenode: invalid document identity mutation guard unlock")
	}
	documentIdentityLock.RUnlock()
}

func requireDocumentIdentityMutationGuard(guard DocumentIdentityMutationGuard) error {
	concrete, ok := guard.(*documentIdentityMutationGuard)
	if !ok || concrete == nil || !concrete.active.Load() {
		return errors.New("document identity mutation guard is not active")
	}
	return nil
}

// ValidateDocumentIdentityMutationGuard allows the filesystem layer to reject
// a missing or expired opaque token before publishing document bytes.
func ValidateDocumentIdentityMutationGuard(guard DocumentIdentityMutationGuard) error {
	return requireDocumentIdentityMutationGuard(guard)
}

func lockDocumentIdentityMutation() func() {
	guard := LockDocumentIdentityMutation()
	return guard.Unlock
}

// LockRootIdentity serializes operations which move or publish the same
// document root across different notebook paths. The fixed stripe table keeps
// lock identity stable for the process lifetime without an unbounded map or an
// unsafe delete/recreate race. Hash collisions only add harmless contention.
func LockRootIdentity(rootID string) func() {
	index := rootIdentityLockIndex(rootID)
	lock := &rootIdentityLocks[index]
	lock.Lock()
	return lock.Unlock
}

func rootIdentityLockIndex(rootID string) uint32 {
	hash := uint32(2166136261)
	for index := 0; index < len(rootID); index++ {
		hash ^= uint32(rootID[index])
		hash *= 16777619
	}
	return hash % uint32(len(rootIdentityLocks))
}

// LockRootIdentities acquires the unique root-identity stripes for a batch in
// stable order. Deduplicating stripes is required because distinct root IDs
// can hash to the same non-reentrant mutex.
func LockRootIdentities(rootIDs []string) func() {
	indices := make([]int, 0, len(rootIDs))
	seen := map[uint32]struct{}{}
	for _, rootID := range rootIDs {
		index := rootIdentityLockIndex(rootID)
		if _, exists := seen[index]; exists {
			continue
		}
		seen[index] = struct{}{}
		indices = append(indices, int(index))
	}
	sort.Ints(indices)
	for _, index := range indices {
		rootIdentityLocks[index].Lock()
	}
	return func() {
		for index := len(indices) - 1; index >= 0; index-- {
			rootIdentityLocks[indices[index]].Unlock()
		}
	}
}

func initDatabase(forceRebuild bool) {
	initDatabaseLock.Lock()
	defer initDatabaseLock.Unlock()

	initDBConnection()

	if !forceRebuild {
		if !gulu.File.IsExist(util.BlockTreeDBPath) {
			forceRebuild = true
		}
	}
	if !forceRebuild {
		// 校验块树表是否可用，避免因上次重建被中断导致数据库文件存在但表缺失
		var table string
		if err := db.QueryRow("SELECT name FROM sqlite_master WHERE type = ? AND name = ?", "table", "blocktrees").Scan(&table); nil != err {
			logging.LogWarnf("blocktrees table missing or unreadable [%s], will rebuild blocktree database", err)
			forceRebuild = true
		}
	}
	if !forceRebuild {
		return
	}

	initDBTables()
	vacuum()

	logging.LogInfof("reinitialized database [%s]", util.BlockTreeDBPath)
}

func initDBTables() {
	_, err := db.Exec("DROP TABLE IF EXISTS blocktrees")
	if err != nil {
		logging.LogFatalf(logging.ExitCodeUnavailableDatabase, "drop table [blocks] failed: %s", err)
	}
	_, err = db.Exec("CREATE TABLE blocktrees (id, root_id, parent_id, box_id, path, hpath, updated, type)")
	if err != nil {
		logging.LogFatalf(logging.ExitCodeUnavailableDatabase, "create table [blocktrees] failed: %s", err)
	}

	_, err = db.Exec("CREATE INDEX idx_blocktrees_id ON blocktrees(id)")
	if err != nil {
		logging.LogFatalf(logging.ExitCodeUnavailableDatabase, "create index [idx_blocktrees_id] failed: %s", err)
	}

	_, err = db.Exec("CREATE INDEX idx_blocktrees_root_id ON blocktrees(root_id)")
	if err != nil {
		logging.LogFatalf(logging.ExitCodeUnavailableDatabase, "create index [idx_blocktrees_root_id] failed: %s", err)
	}
}

func initDBConnection() {
	closeDatabase()

	util.LogDatabaseSize(util.BlockTreeDBPath)
	dsn := util.BlockTreeDBPath + "?_journal_mode=WAL" +
		"&_synchronous=OFF" +
		"&_mmap_size=4294967296" +
		"&_secure_delete=OFF" +
		"&_cache_size=-128000" +
		"&_page_size=32768" +
		"&_busy_timeout=7000" +
		"&_ignore_check_constraints=ON" +
		"&_temp_store=MEMORY" +
		"&_case_sensitive_like=OFF"
	var err error
	db, err = sql.Open("sqlite3_extended", dsn)
	if err != nil {
		logging.LogFatalf(logging.ExitCodeUnavailableDatabase, "create database failed: %s", err)
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

	if err := db.Close(); err != nil {
		logging.LogErrorf("close database failed: %s", err)
	}
	debug.FreeOSMemory()
	db = nil
	runtime.GC()
	return
}

func GetBlockTreesByType(typ string) (ret []*BlockTree) {
	sqlStmt := "SELECT * FROM blocktrees WHERE type = ?"
	rows, err := query(sqlStmt, typ)
	if err != nil {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var block BlockTree
		if err = rows.Scan(&block.ID, &block.RootID, &block.ParentID, &block.BoxID, &block.Path, &block.HPath, &block.Updated, &block.Type); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret = append(ret, &block)
	}
	return
}

func GetBlockTreeByBoxPath(boxID, path string) (ret *BlockTree) {
	ret = &BlockTree{}
	sqlStmt := "SELECT * FROM blocktrees WHERE box_id = ? AND path = ?"
	row := queryRowForBox(boxID, sqlStmt, boxID, path)
	if row == nil {
		return
	}
	err := row.Scan(&ret.ID, &ret.RootID, &ret.ParentID, &ret.BoxID, &ret.Path, &ret.HPath, &ret.Updated, &ret.Type)
	if err != nil {
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
	err := queryRow(sqlStmt).Scan(&ret)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0
		}
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
	}
	return
}

func CountBlocks() (ret int) {
	sqlStmt := "SELECT COUNT(*) FROM blocktrees"
	err := queryRow(sqlStmt).Scan(&ret)
	if err != nil {
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
	row := queryRowForBox(boxID, sqlStmt, boxID, path)
	if row == nil {
		return
	}
	err := row.Scan(&ret.ID, &ret.RootID, &ret.ParentID, &ret.BoxID, &ret.Path, &ret.HPath, &ret.Updated, &ret.Type)
	if err != nil {
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
	row := queryRowForBox(boxID, sqlStmt, boxID, hPath)
	if row == nil {
		return
	}
	err := row.Scan(&ret.ID, &ret.RootID, &ret.ParentID, &ret.BoxID, &ret.Path, &ret.HPath, &ret.Updated, &ret.Type)
	if err != nil {
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
	rows, err := queryForBox(boxID, sqlStmt, boxID, hPath)
	if err != nil {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var block BlockTree
		if err = rows.Scan(&block.ID, &block.RootID, &block.ParentID, &block.BoxID, &block.Path, &block.HPath, &block.Updated, &block.Type); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret = append(ret, &block)
	}
	return
}

func GetBlockTreeByHPathPreferredParentID(boxID, hPath, preferredParentID string) (ret *BlockTree) {
	hPath = gulu.Str.RemoveInvisible(hPath)
	var roots []*BlockTree
	sqlStmt := "SELECT * FROM blocktrees WHERE box_id = ? AND hpath = ? AND parent_id = ? LIMIT 1"
	rows, err := queryForBox(boxID, sqlStmt, boxID, hPath, preferredParentID)
	if err != nil {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var block BlockTree
		if err = rows.Scan(&block.ID, &block.RootID, &block.ParentID, &block.BoxID, &block.Path, &block.HPath, &block.Updated, &block.Type); err != nil {
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
	err := queryRow(sqlStmt, id).Scan(&count)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// 全局未命中，遍历加密 box
			for _, encBoxID := range GetOpenedEncryptedBoxIDs() {
				if ExistBlockTreeInBox(id, encBoxID) {
					return true
				}
			}
			return false
		}
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return false
	}
	if 0 < count {
		return true
	}
	// 全局未命中，遍历加密 box
	for _, encBoxID := range GetOpenedEncryptedBoxIDs() {
		if ExistBlockTreeInBox(id, encBoxID) {
			return true
		}
	}
	return false
}

func ExistBlockTrees(ids []string) (ret map[string]bool) {
	ret = map[string]bool{}
	if 1 > len(ids) {
		return
	}

	for _, id := range ids {
		ret[id] = false
	}

	// 先查全局 blocktree
	sqlStmt := "SELECT id FROM blocktrees WHERE id IN ('" + strings.Join(ids, "','") + "')"
	rows, err := query(sqlStmt)
	if err != nil {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret[id] = true
	}

	// 全局 blocktree 未命中的 id，遍历已打开的加密笔记本查找
	var missing []string
	for id, found := range ret {
		if !found {
			missing = append(missing, id)
		}
	}
	if len(missing) > 0 {
		for _, encBoxID := range GetOpenedEncryptedBoxIDs() {
			if len(missing) == 0 {
				break
			}
			encRet := ExistBlockTreesInBox(missing, encBoxID)
			var stillMissing []string
			for _, id := range missing {
				if encRet[id] {
					ret[id] = true
				} else {
					stillMissing = append(stillMissing, id)
				}
			}
			missing = stillMissing
		}
	}
	return
}

func GetBlockTrees(ids []string) (ret map[string]*BlockTree) {
	ret = map[string]*BlockTree{}
	if 1 > len(ids) {
		return
	}

	stmtBuf := bytes.Buffer{}
	stmtBuf.WriteString("SELECT * FROM blocktrees WHERE id IN (")
	for i := range ids {
		stmtBuf.WriteString("?")
		if i == len(ids)-1 {
			stmtBuf.WriteString(")")
		} else {
			stmtBuf.WriteString(",")
		}
	}
	var args []any
	for _, id := range ids {
		args = append(args, id)
	}
	stmt := stmtBuf.String()
	rows, err := query(stmt, args...)
	if err != nil {
		logging.LogErrorf("sql query [%s] failed: %s", stmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var block BlockTree
		if err = rows.Scan(&block.ID, &block.RootID, &block.ParentID, &block.BoxID, &block.Path, &block.HPath, &block.Updated, &block.Type); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret[block.ID] = &block
	}

	// 全局未命中的 id，遍历已打开的加密笔记本查找
	var missing []string
	for _, id := range ids {
		if _, ok := ret[id]; !ok {
			missing = append(missing, id)
		}
	}
	if len(missing) > 0 {
		for _, encBoxID := range GetOpenedEncryptedBoxIDs() {
			if len(missing) == 0 {
				break
			}
			encRet := GetBlockTreesInBox(missing, encBoxID)
			var stillMissing []string
			for _, id := range missing {
				if bt, ok := encRet[id]; ok {
					ret[id] = bt
				} else {
					stillMissing = append(stillMissing, id)
				}
			}
			missing = stillMissing
		}
	}
	return
}

func GetBlockTree(id string) (ret *BlockTree) {
	if "" == id {
		return
	}

	ret = &BlockTree{}
	sqlStmt := "SELECT * FROM blocktrees WHERE id = ?"
	err := queryRow(sqlStmt, id).Scan(&ret.ID, &ret.RootID, &ret.ParentID, &ret.BoxID, &ret.Path, &ret.HPath, &ret.Updated, &ret.Type)
	if err != nil {
		ret = nil
		if errors.Is(err, sql.ErrNoRows) {
			// 全局 blocktree 未命中，遍历已打开的加密笔记本查找
			for _, encBoxID := range GetOpenedEncryptedBoxIDs() {
				if encBT := GetBlockTreeInBox(id, encBoxID); nil != encBT {
					return encBT
				}
			}
			return
		}
		logging.LogErrorf("sql query [%s] failed: %v\n\t%s", sqlStmt, err, logging.ShortStack())
		return
	}
	return
}

// IsContainerType 按主类型缩写判断块是否为容器块（可合法接收子块）。
// 入参 abbrType 对应 BlockTree.Type（如 "d"/"h"/"p"），由 TypeAbbr 写入。
func IsContainerType(abbrType string) bool {
	switch abbrType {
	case "d", "b", "l", "i", "s", "callout":
		return true
	}
	return false
}

// CheckContainerParent 校验 parentID 指向的块是否允许接收子块。
// 仅在“通过 parentID 定位插入/移动目标”（即不依赖 previousID/nextID）的场景下调用，
// 因为一旦带 previousID/nextID，事务层走的是兄弟级 InsertAfter/InsertBefore，天然合法。
// 返回 nil 表示合法；返回 error 时调用方应拒绝本次操作。
func CheckContainerParent(parentID string) error {
	bt := GetBlockTree(parentID)
	if nil == bt {
		return fmt.Errorf("parent block not found: %s", parentID)
	}
	if IsContainerType(bt.Type) {
		return nil
	}
	if "h" == bt.Type {
		// 标题是叶子块，其“子内容”在数据结构上实为后续兄弟节点（由 HeadingChildren 按层级推算）。
		// 把块挂成标题的 AST 子节点属于非法嵌套，应改用 previousID 定位。
		return fmt.Errorf("heading [%s] is a leaf block and cannot have children; to place a block below this heading, pass previousID=<heading id> or previousID=<last block below the heading> instead of parentID", parentID)
	}
	return fmt.Errorf("block [%s] type %q is a leaf block and cannot have children; use previousID to place the block as its sibling instead", parentID, bt.Type)
}

// CheckListItemNesting 校验 parentID 和 childID 是否形成“列表项直含列表项”的非法嵌套。
// 嵌套列表的正确结构是 ListItem > List > ListItem，列表项不能直接作为另一个列表项的子块。
// 仅在 move 场景调用（源和目标类型均已知）。
func CheckListItemNesting(parentID, childID string) error {
	parentBt := GetBlockTree(parentID)
	childBt := GetBlockTree(childID)
	if nil == parentBt || nil == childBt {
		return nil // 查不到就放行，不阻塞未知场景
	}
	if "i" == parentBt.Type && "i" == childBt.Type {
		return fmt.Errorf("a list-item cannot directly contain another list-item; to nest, first create a list (NodeList) under the outer list-item, then add the inner list-items to that list")
	}
	return nil
}

func SetBlockTreePath(tree *parse.Tree) {
	guard := LockDocumentIdentityMutation()
	defer guard.Unlock()
	_ = SetBlockTreePathMutationLocked(guard, tree)
}

// SetBlockTreePathMutationLocked updates one tree while reusing the caller's
// ordinary document-identity transaction.
func SetBlockTreePathMutationLocked(guard DocumentIdentityMutationGuard, tree *parse.Tree) error {
	if err := requireDocumentIdentityMutationGuard(guard); err != nil {
		return err
	}
	removeBlockTreesByRootID(tree.Box, tree.ID)
	indexBlockTree(tree)
	return nil
}

func RemoveBlockTreesByRootID(boxID, rootID string) {
	guard := LockDocumentIdentityMutation()
	defer guard.Unlock()
	_ = RemoveBlockTreesByRootIDMutationLocked(guard, boxID, rootID)
}

func RemoveBlockTreesByRootIDMutationLocked(guard DocumentIdentityMutationGuard, boxID, rootID string) error {
	if err := requireDocumentIdentityMutationGuard(guard); err != nil {
		return err
	}
	removeBlockTreesByRootID(boxID, rootID)
	return nil
}

func removeBlockTreesByRootID(boxID, rootID string) {
	sqlStmt := "DELETE FROM blocktrees WHERE root_id = ? AND box_id = ?"
	_, err := execForBox(boxID, sqlStmt, rootID, boxID)
	if err != nil {
		logging.LogErrorf("sql exec [%s] failed: %s", sqlStmt, err)
		return
	}
}

// RemoveBlockTreesByRootPath deletes one exact indexed document location and
// reports storage failures to security-sensitive raw index callers. The
// legacy root-only helper remains for model operations which intentionally
// remove every location for a root.
func RemoveBlockTreesByRootPath(boxID, rootID, documentPath string) error {
	unlockIdentity := lockDocumentIdentityMutation()
	defer unlockIdentity()
	return removeBlockTreesByRootPathIdentityLocked(boxID, rootID, documentPath)
}

// RemoveBlockTreesByRootPathIdentityLocked is the raw-publication variant of
// RemoveBlockTreesByRootPath. The caller MUST already hold the exclusive lock
// returned by LockDocumentIdentitySet for the complete validation/mutation
// transaction.
func RemoveBlockTreesByRootPathIdentityLocked(guard DocumentIdentitySetGuard, boxID, rootID, documentPath string) error {
	if err := requireDocumentIdentitySetGuard(guard); err != nil {
		return err
	}
	return removeBlockTreesByRootPathIdentityLocked(boxID, rootID, documentPath)
}

func removeBlockTreesByRootPathIdentityLocked(boxID, rootID, documentPath string) error {
	sqlStmt := "DELETE FROM blocktrees WHERE root_id = ? AND box_id = ? AND path = ?"
	if _, err := execForBox(boxID, sqlStmt, rootID, boxID, documentPath); err != nil {
		return fmt.Errorf("remove exact blocktree location: %w", err)
	}
	return nil
}

func CountBlockTreesByPathPrefix(boxID, pathPrefix string) (ret int) {
	sqlStmt := "SELECT COUNT(*) FROM blocktrees WHERE path LIKE ? AND box_id = ?"
	row := queryRowForBox(boxID, sqlStmt, pathPrefix+"%", boxID)
	if row == nil {
		return
	}
	err := row.Scan(&ret)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0
		}
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
	}
	return
}

func GetBlockTreesByPathPrefix(boxID, pathPrefix string) (ret []*BlockTree) {
	sqlStmt := "SELECT * FROM blocktrees WHERE path LIKE ? AND box_id = ?"
	rows, err := queryForBox(boxID, sqlStmt, pathPrefix+"%", boxID)
	if err != nil {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var block BlockTree
		if err = rows.Scan(&block.ID, &block.RootID, &block.ParentID, &block.BoxID, &block.Path, &block.HPath, &block.Updated, &block.Type); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret = append(ret, &block)
	}
	return
}

func GetBlockTreesByRootID(rootID string) (ret []*BlockTree) {
	sqlStmt := "SELECT * FROM blocktrees WHERE root_id = ?"
	rows, err := query(sqlStmt, rootID)
	if err != nil {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var block BlockTree
		if err = rows.Scan(&block.ID, &block.RootID, &block.ParentID, &block.BoxID, &block.Path, &block.HPath, &block.Updated, &block.Type); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret = append(ret, &block)
	}
	return
}

// LookupRootBlockTreeLocations returns every currently indexed location for a
// document root across the global blocktree database and all opened encrypted
// notebook databases. Unlike the legacy convenience getters it propagates
// database errors, allowing security-sensitive callers to fail closed.
func LookupRootBlockTreeLocations(rootID string) (ret []*BlockTree, err error) {
	if rootID == "" {
		return nil, errors.New("root ID is empty")
	}
	appendRows := func(rows *sql.Rows) error {
		defer rows.Close()
		for rows.Next() {
			block := &BlockTree{}
			if scanErr := rows.Scan(&block.ID, &block.RootID, &block.BoxID, &block.Path); scanErr != nil {
				return scanErr
			}
			ret = append(ret, block)
		}
		return rows.Err()
	}
	rows, err := query("SELECT DISTINCT id, root_id, box_id, path FROM blocktrees WHERE root_id = ? OR id = ?", rootID, rootID)
	if err != nil {
		return nil, err
	}
	if err = appendRows(rows); err != nil {
		return nil, err
	}
	for _, boxID := range GetOpenedEncryptedBoxIDs() {
		rows, queryErr := queryForBox(boxID, "SELECT DISTINCT id, root_id, box_id, path FROM blocktrees WHERE root_id = ? OR id = ?", rootID, rootID)
		if queryErr != nil {
			return nil, queryErr
		}
		if err = appendRows(rows); err != nil {
			return nil, err
		}
	}
	return ret, nil
}

// LookupBlockTreeIdentityLocations returns indexed identities for the supplied
// block IDs in bounded SQL batches. It is used before publishing a raw .sy so
// nested IDs cannot silently steal definitions from another document.
func LookupBlockTreeIdentityLocations(blockIDs []string) (ret []*BlockTree, err error) {
	const batchSize = 256
	appendRows := func(rows *sql.Rows) error {
		defer rows.Close()
		for rows.Next() {
			block := &BlockTree{}
			if scanErr := rows.Scan(&block.ID, &block.RootID, &block.BoxID, &block.Path); scanErr != nil {
				return scanErr
			}
			ret = append(ret, block)
		}
		return rows.Err()
	}
	queryBatch := func(boxID string, ids []string) error {
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
		args := make([]any, len(ids))
		for index, id := range ids {
			args[index] = id
		}
		rows, queryErr := queryForBox(boxID, "SELECT DISTINCT id, root_id, box_id, path FROM blocktrees WHERE id IN ("+placeholders+")", args...)
		if queryErr != nil {
			return queryErr
		}
		return appendRows(rows)
	}
	boxIDs := append([]string{""}, GetOpenedEncryptedBoxIDs()...)
	for start := 0; start < len(blockIDs); start += batchSize {
		end := start + batchSize
		if end > len(blockIDs) {
			end = len(blockIDs)
		}
		for _, boxID := range boxIDs {
			if err = queryBatch(boxID, blockIDs[start:end]); err != nil {
				return nil, err
			}
		}
	}
	return ret, nil
}

func RemoveBlockTreesByPathPrefix(boxID, pathPrefix string) {
	guard := LockDocumentIdentityMutation()
	defer guard.Unlock()
	_ = RemoveBlockTreesByPathPrefixMutationLocked(guard, boxID, pathPrefix)
}

func RemoveBlockTreesByPathPrefixMutationLocked(guard DocumentIdentityMutationGuard, boxID, pathPrefix string) error {
	if err := requireDocumentIdentityMutationGuard(guard); err != nil {
		return err
	}
	sqlStmt := "DELETE FROM blocktrees WHERE path LIKE ? AND box_id = ?"
	_, err := execForBox(boxID, sqlStmt, pathPrefix+"%", boxID)
	if err != nil {
		logging.LogErrorf("sql exec [%s] failed: %s", sqlStmt, err)
		return err
	}
	return nil
}

func GetBlockTreesByBoxID(boxID string) (ret []*BlockTree) {
	sqlStmt := "SELECT * FROM blocktrees WHERE box_id = ?"
	rows, err := queryForBox(boxID, sqlStmt, boxID)
	if err != nil {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var block BlockTree
		if err = rows.Scan(&block.ID, &block.RootID, &block.ParentID, &block.BoxID, &block.Path, &block.HPath, &block.Updated, &block.Type); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret = append(ret, &block)
	}
	return
}

func RemoveBlockTreesByBoxID(boxID string) (ids []string) {
	unlockIdentity := lockDocumentIdentityMutation()
	defer unlockIdentity()
	sqlStmt := "SELECT id FROM blocktrees WHERE box_id = ?"
	rows, err := queryForBox(boxID, sqlStmt, boxID)
	if err != nil {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ids = append(ids, id)
	}

	sqlStmt = "DELETE FROM blocktrees WHERE box_id = ?"
	_, err = execForBox(boxID, sqlStmt, boxID)
	if err != nil {
		logging.LogErrorf("sql exec [%s] failed: %s", sqlStmt, err)
		return
	}
	return
}

func RemoveBlockTreesByIDs(boxID string, ids []string) {
	guard := LockDocumentIdentityMutation()
	defer guard.Unlock()
	_ = RemoveBlockTreesByIDsMutationLocked(guard, boxID, ids)
}

// RemoveBlockTreesByIDsMutationLocked removes the supplied block IDs while
// reusing an ordinary document-identity transaction. Transaction processing
// uses this form so an exclusive raw document publication cannot be admitted
// between an index deletion and the corresponding .sy publication.
func RemoveBlockTreesByIDsMutationLocked(guard DocumentIdentityMutationGuard, boxID string, ids []string) error {
	if err := requireDocumentIdentityMutationGuard(guard); err != nil {
		return err
	}
	if len(ids) == 0 {
		return nil
	}

	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
	args := make([]any, len(ids))
	for index, id := range ids {
		args[index] = id
	}
	sqlStmt := "DELETE FROM blocktrees WHERE id IN (" + placeholders + ")"
	_, err := execForBox(boxID, sqlStmt, args...)
	if err != nil {
		logging.LogErrorf("sql exec [%s] failed: %s", sqlStmt, err)
		return err
	}
	return nil
}

func RemoveBlockTree(boxID, id string) {
	unlockIdentity := lockDocumentIdentityMutation()
	defer unlockIdentity()
	sqlStmt := "DELETE FROM blocktrees WHERE id = ?"
	_, err := execForBox(boxID, sqlStmt, id)
	if err != nil {
		logging.LogErrorf("sql exec [%s] failed: %s", sqlStmt, err)
		return
	}
}

var indexBlockTreeLock = sync.Mutex{}

func IndexBlockTree(tree *parse.Tree) {
	guard := LockDocumentIdentityMutation()
	defer guard.Unlock()
	_ = IndexBlockTreeMutationLocked(guard, tree)
}

// IndexBlockTreeMutationLocked indexes a complete tree while reusing the
// caller's ordinary document-identity transaction.
func IndexBlockTreeMutationLocked(guard DocumentIdentityMutationGuard, tree *parse.Tree) error {
	if err := requireDocumentIdentityMutationGuard(guard); err != nil {
		return err
	}
	indexBlockTree(tree)
	return nil
}

func indexBlockTree(tree *parse.Tree) {
	var changedNodes []*ast.Node
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !n.IsBlock() || "" == n.ID {
			return ast.WalkContinue
		}

		changedNodes = append(changedNodes, n)
		return ast.WalkContinue
	})

	if 1 > len(changedNodes) {
		return
	}

	indexBlockTreeLock.Lock()
	defer indexBlockTreeLock.Unlock()

	// 加密笔记本用独立 blocktree db；非加密笔记本用全局 db（两者都可能为 nil——重建过程中）
	if nil == db && getEncryptedBlockTreeDB(tree.Box) == nil {
		logging.LogErrorf("database is nil")
		return
	}

	tx, err := beginTxForBox(tree.Box)
	if err != nil {
		logging.LogErrorf("begin transaction failed: %s", err)
		return
	}

	execInsertBlocktrees(tx, tree, changedNodes)

	if err = tx.Commit(); err != nil {
		logging.LogErrorf("commit transaction failed: %s", err)
	}
}

func UpsertBlockTree(tree *parse.Tree) {
	guard := LockDocumentIdentityMutation()
	defer guard.Unlock()
	_ = UpsertBlockTreeMutationLocked(guard, tree)
}

// UpsertBlockTreeMutationLocked incrementally updates a tree while reusing the
// caller's ordinary document-identity transaction.
func UpsertBlockTreeMutationLocked(guard DocumentIdentityMutationGuard, tree *parse.Tree) error {
	if err := requireDocumentIdentityMutationGuard(guard); err != nil {
		return err
	}
	upsertBlockTree(tree)
	return nil
}

func upsertBlockTree(tree *parse.Tree) {
	oldBts := map[string]*BlockTree{}
	bts := GetBlockTreesByRootIDInBox(tree.ID, tree.Box)
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

	if 1 > len(changedNodes) {
		return
	}

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

	if nil == db && getEncryptedBlockTreeDB(tree.Box) == nil {
		logging.LogErrorf("database is nil")
		return
	}

	tx, err := beginTxForBox(tree.Box)
	if err != nil {
		logging.LogErrorf("begin transaction failed: %s", err)
		return
	}

	sqlStmt := "DELETE FROM blocktrees WHERE id IN (" + ids.String() + ")"
	_, err = tx.Exec(sqlStmt)
	if err != nil {
		tx.Rollback()
		logging.LogErrorf("sql exec [%s] failed: %s", sqlStmt, err)
		return
	}

	execInsertBlocktrees(tx, tree, changedNodes)

	if err = tx.Commit(); err != nil {
		logging.LogErrorf("commit transaction failed: %s", err)
	}
}

// ReplaceBlockTree atomically replaces the complete blocktree rows for one
// exact document. Unlike the incremental editor-oriented upsert above, this
// removes nested block IDs which disappeared from a raw .sy payload and
// propagates begin/insert/commit failures to the caller.
func ReplaceBlockTree(tree *parse.Tree) error {
	guard := LockDocumentIdentityMutation()
	defer guard.Unlock()
	return ReplaceBlockTreeMutationLocked(guard, tree)
}

// ReplaceBlockTreeMutationLocked replaces one complete tree while reusing the
// caller's ordinary document-identity transaction.
func ReplaceBlockTreeMutationLocked(guard DocumentIdentityMutationGuard, tree *parse.Tree) error {
	if err := requireDocumentIdentityMutationGuard(guard); err != nil {
		return err
	}
	return replaceBlockTreeIdentityLocked(tree)
}

// ReplaceBlockTreeIdentityLocked is the raw-publication variant of
// ReplaceBlockTree. The caller MUST already hold the exclusive lock returned
// by LockDocumentIdentitySet for the complete validation/mutation transaction.
func ReplaceBlockTreeIdentityLocked(guard DocumentIdentitySetGuard, tree *parse.Tree) error {
	if err := requireDocumentIdentitySetGuard(guard); err != nil {
		return err
	}
	return replaceBlockTreeIdentityLocked(tree)
}

// RawDocumentIndexMutation 描述一次原始文档发布对应的块树替换或删除。
// Tree 非空时执行替换，否则删除指定的精确文档位置。
type RawDocumentIndexMutation struct {
	Tree         *parse.Tree
	BoxID        string
	RootID       string
	DocumentPath string
}

// ApplyRawDocumentIndexBatchIdentityLocked 在同一个块树数据库事务中提交一批原始文档索引变更。
// 原始同步拒绝加密笔记本，因此所有变更都落在全局 blocktree.db，可以获得真正的批量原子性。
func ApplyRawDocumentIndexBatchIdentityLocked(guard DocumentIdentitySetGuard, mutations []RawDocumentIndexMutation) error {
	if err := requireDocumentIdentitySetGuard(guard); err != nil {
		return err
	}
	if len(mutations) == 0 {
		return nil
	}

	type preparedMutation struct {
		mutation RawDocumentIndexMutation
		nodes    []*ast.Node
	}
	prepared := make([]preparedMutation, 0, len(mutations))
	for _, mutation := range mutations {
		if mutation.Tree != nil {
			tree := mutation.Tree
			if tree.Root == nil || tree.ID == "" || tree.Box == "" || tree.Path == "" {
				return errors.New("invalid blocktree replacement")
			}
			if IsEncryptedBoxFn != nil && IsEncryptedBoxFn(tree.Box) {
				return errors.New("raw document index batch does not support encrypted notebooks")
			}
			var nodes []*ast.Node
			ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
				if entering && node.IsBlock() && node.ID != "" {
					nodes = append(nodes, node)
				}
				return ast.WalkContinue
			})
			if len(nodes) == 0 {
				return errors.New("blocktree replacement contains no block IDs")
			}
			mutation.BoxID, mutation.RootID, mutation.DocumentPath = tree.Box, tree.ID, tree.Path
			prepared = append(prepared, preparedMutation{mutation: mutation, nodes: nodes})
			continue
		}
		if mutation.BoxID == "" || mutation.RootID == "" || mutation.DocumentPath == "" {
			return errors.New("invalid blocktree removal")
		}
		if IsEncryptedBoxFn != nil && IsEncryptedBoxFn(mutation.BoxID) {
			return errors.New("raw document index batch does not support encrypted notebooks")
		}
		prepared = append(prepared, preparedMutation{mutation: mutation})
	}

	indexBlockTreeLock.Lock()
	defer indexBlockTreeLock.Unlock()
	if db == nil {
		return errors.New("blocktree database is nil")
	}
	tx, err := db.Begin()
	if err != nil {
		return fmt.Errorf("begin blocktree batch: %w", err)
	}
	defer tx.Rollback()
	for _, item := range prepared {
		mutation := item.mutation
		if _, err = tx.Exec("DELETE FROM blocktrees WHERE root_id = ? AND box_id = ? AND path = ?", mutation.RootID, mutation.BoxID, mutation.DocumentPath); err != nil {
			return fmt.Errorf("delete previous blocktree location: %w", err)
		}
		if mutation.Tree != nil {
			if err = execInsertBlocktreesChecked(tx, mutation.Tree, item.nodes); err != nil {
				return err
			}
		}
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit blocktree batch: %w", err)
	}
	return nil
}

func replaceBlockTreeIdentityLocked(tree *parse.Tree) error {
	if tree == nil || tree.Root == nil || tree.ID == "" || tree.Box == "" || tree.Path == "" {
		return errors.New("invalid blocktree replacement")
	}
	var nodes []*ast.Node
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && node.IsBlock() && node.ID != "" {
			nodes = append(nodes, node)
		}
		return ast.WalkContinue
	})
	if len(nodes) == 0 {
		return errors.New("blocktree replacement contains no block IDs")
	}

	indexBlockTreeLock.Lock()
	defer indexBlockTreeLock.Unlock()
	if db == nil && getEncryptedBlockTreeDB(tree.Box) == nil {
		return errors.New("blocktree database is nil")
	}
	tx, err := beginTxForBox(tree.Box)
	if err != nil {
		return fmt.Errorf("begin blocktree replacement: %w", err)
	}
	defer tx.Rollback()
	if _, err = tx.Exec("DELETE FROM blocktrees WHERE root_id = ? AND box_id = ? AND path = ?", tree.ID, tree.Box, tree.Path); err != nil {
		return fmt.Errorf("delete previous blocktree location: %w", err)
	}
	if err = execInsertBlocktreesChecked(tx, tree, nodes); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("commit blocktree replacement: %w", err)
	}
	return nil
}

func execInsertBlocktreesChecked(tx *sql.Tx, tree *parse.Tree, nodes []*ast.Node) error {
	const sqlStmt = "INSERT INTO blocktrees (id, root_id, parent_id, box_id, path, hpath, updated, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
	stmt, err := tx.Prepare(sqlStmt)
	if err != nil {
		return fmt.Errorf("prepare blocktree insert: %w", err)
	}
	defer stmt.Close()
	for _, node := range nodes {
		parentID := ""
		if node.Parent != nil {
			parentID = node.Parent.ID
		}
		if _, err = stmt.Exec(node.ID, tree.ID, parentID, tree.Box, tree.Path, tree.HPath, node.IALAttr("updated"), TypeAbbr(node.Type.String())); err != nil {
			return fmt.Errorf("insert blocktree %s: %w", node.ID, err)
		}
	}
	return nil
}

func execInsertBlocktrees(tx *sql.Tx, tree *parse.Tree, changedNodes []*ast.Node) {
	sqlStmt := "INSERT INTO blocktrees (id, root_id, parent_id, box_id, path, hpath, updated, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
	stmt, err := tx.Prepare(sqlStmt)
	if err != nil {
		tx.Rollback()
		logging.LogErrorf("exec database stmt [%s] failed: %s\n  %s", sqlStmt, err, logging.ShortStack())

		if strings.Contains(err.Error(), "database disk image is malformed") {
			closeDatabase()
			util.RemoveDatabaseFile(util.BlockTreeDBPath)
			initDatabase(true)
			logging.LogFatalf(logging.ExitCodeUnavailableDatabase, "database disk image [%s] is malformed, please restart SiYuan kernel to rebuild it\n\t%s", util.BlockTreeDBPath, err)
		}
		return
	}
	defer stmt.Close()

	for _, n := range changedNodes {
		var parentID string
		if nil != n.Parent {
			parentID = n.Parent.ID
		}
		if _, err = tx.Exec(sqlStmt, n.ID, tree.ID, parentID, tree.Box, tree.Path, tree.HPath, n.IALAttr("updated"), TypeAbbr(n.Type.String())); err != nil {
			tx.Rollback()
			logging.LogErrorf("exec database stmt [%s] failed: %s\n  %s", sqlStmt, err, logging.ShortStack())

			if strings.Contains(err.Error(), "database disk image is malformed") {
				closeDatabase()
				util.RemoveDatabaseFile(util.BlockTreeDBPath)
				initDatabase(true)
				logging.LogFatalf(logging.ExitCodeUnavailableDatabase, "database disk image [%s] is malformed, please restart SiYuan kernel to rebuild it\n\t%s", util.BlockTreeDBPath, err)
			}
			return
		}
	}
}

func InitBlockTree(force bool) {
	initDatabase(force)
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

func queryRow(query string, args ...any) *sql.Row {
	query = strings.TrimSpace(query)
	if "" == query {
		logging.LogErrorf("statement is empty")
		return nil
	}

	if nil == db {
		return nil
	}
	return db.QueryRow(query, args...)
}

func query(query string, args ...any) (*sql.Rows, error) {
	query = strings.TrimSpace(query)
	if "" == query {
		return nil, errors.New("statement is empty")
	}

	if nil == db {
		return nil, errors.New("database is nil")
	}
	return db.Query(query, args...)
}

func exec(stmt string, args ...any) (sql.Result, error) {
	stmt = strings.TrimSpace(stmt)
	if "" == stmt {
		return nil, errors.New("statement is empty")
	}

	if nil == db {
		return nil, errors.New("database is nil")
	}
	return db.Exec(stmt, args...)
}

func vacuum() {
	if nil != db {
		if _, err := db.Exec("VACUUM"); nil != err {
			logging.LogErrorf("vacuum database failed: %s", err)
		}
	}
}

// 加密笔记本的独立 blocktree db 注册表。boxID -> *sql.DB。
var encryptedBlockTreeDBs = &sync.Map{}

// IsEncryptedBoxFn 由 model 层注入，用于判断 boxID 是否为加密笔记本。
// treenode 包不直接 import model（循环依赖），路由函数据此 fail-closed：
// 加密笔记本未解锁时绝不回退全局库，避免加密笔记本块树元数据污染全局明文 blocktree.db。
var IsEncryptedBoxFn func(boxID string) bool

// OpenEncryptedBlockTreeDB 打开加密笔记本的独立 SQLCipher blocktree db。
// 与 sql.OpenEncryptedDB 配对，UnlockBox 时调用。dek 为该 box 的 32 字节 DEK；
// 先用 HKDF 派生 blocktree 子密钥（与 content 子密钥分离）。
func OpenEncryptedBlockTreeDB(boxID string, dek []byte) (err error) {
	if _, loaded := encryptedBlockTreeDBs.Load(boxID); loaded {
		return nil
	}
	dbPath := util.EncryptedBlockTreeDBPath(boxID)
	blocktreeKey := util.DeriveSubKey(dek, "siyuan/sqlcipher/blocktree")
	dsn := dbPath + "?_journal_mode=WAL&_synchronous=OFF&_mmap_size=4294967296&_secure_delete=OFF" +
		"&_cache_size=-128000&_page_size=32768&_busy_timeout=7000&_ignore_check_constraints=ON" +
		"&_temp_store=MEMORY&_case_sensitive_like=OFF&_key=x'" + hex.EncodeToString(blocktreeKey) + "'"
	boxDB, err := sql.Open("sqlite3_extended", dsn)
	if err != nil {
		return err
	}
	boxDB.SetMaxOpenConns(7)
	boxDB.SetMaxIdleConns(3)
	boxDB.SetConnMaxLifetime(365 * 24 * time.Hour)
	if err = initEncryptedBlockTreeTables(boxDB); err != nil {
		boxDB.Close()
		return err
	}
	encryptedBlockTreeDBs.Store(boxID, boxDB)
	return nil
}

// CloseEncryptedBlockTreeDB 仅关闭加密 blocktree db 连接（不删文件）。
// 被 RemoveEncryptedBlockTreeDBFile 复用作为底层关连接实现。
func CloseEncryptedBlockTreeDB(boxID string) {
	if v, ok := encryptedBlockTreeDBs.LoadAndDelete(boxID); ok {
		if boxDB, ok := v.(*sql.DB); ok {
			boxDB.Close()
		}
	}
}

// GetOpenedEncryptedBoxIDs 返回所有已打开的加密 blocktree db 对应的 boxID。
// 供 boxID 未知时遍历查找（如通用打开入口 openFileById）。
func GetOpenedEncryptedBoxIDs() (ret []string) {
	encryptedBlockTreeDBs.Range(func(key, value any) bool {
		if boxID, ok := key.(string); ok {
			ret = append(ret, boxID)
		}
		return true
	})
	return
}

// RemoveEncryptedBlockTreeDBFile 关闭连接并删除加密 blocktree db 文件。删笔记本、关闭加密笔记本时调用。
func RemoveEncryptedBlockTreeDBFile(boxID string) {
	CloseEncryptedBlockTreeDB(boxID)
	dbPath := util.EncryptedBlockTreeDBPath(boxID)
	for _, suffix := range []string{"", "-wal", "-shm"} {
		if err := os.Remove(dbPath + suffix); err != nil && !os.IsNotExist(err) {
			logging.LogErrorf("remove encrypted blocktree db file [%s] failed: %s", dbPath+suffix, err)
		}
	}
}

// RemoveAllEncryptedBlockTreeDBFiles 关闭所有已打开的加密 blocktree db 连接并删除其文件（含 WAL/SHM）。
// 进程退出（CloseDatabase）时调用，避免重启后残留旧索引数据。
func RemoveAllEncryptedBlockTreeDBFiles() {
	for _, boxID := range GetOpenedEncryptedBoxIDs() {
		RemoveEncryptedBlockTreeDBFile(boxID)
	}
}

// getEncryptedBlockTreeDB 返回加密笔记本的 blocktree db 句柄；未打开返回 nil。
func getEncryptedBlockTreeDB(boxID string) *sql.DB {
	if v, ok := encryptedBlockTreeDBs.Load(boxID); ok {
		if boxDB, ok := v.(*sql.DB); ok {
			return boxDB
		}
	}
	return nil
}

// initEncryptedBlockTreeTables 在加密 blocktree db 上建表（幂等）。
func initEncryptedBlockTreeTables(boxDB *sql.DB) (err error) {
	stmts := []string{
		"CREATE TABLE IF NOT EXISTS blocktrees (id, root_id, parent_id, box_id, path, hpath, updated, type)",
		"CREATE INDEX IF NOT EXISTS idx_blocktrees_id ON blocktrees(id)",
		"CREATE INDEX IF NOT EXISTS idx_blocktrees_root_id ON blocktrees(root_id)",
	}
	for _, s := range stmts {
		if _, err = boxDB.Exec(s); err != nil {
			return
		}
	}
	return
}

// --- box-scoped wrapper（加密笔记本用独立 db，否则用全局 db）---
// 加密笔记本未解锁（db 未打开）时 fail-closed：绝不回退全局库，避免加密笔记本块树操作污染全局 blocktree.db。

func queryForBox(box, stmt string, args ...any) (*sql.Rows, error) {
	if boxDB := getEncryptedBlockTreeDB(box); boxDB != nil {
		return boxDB.Query(stmt, args...)
	}
	if IsEncryptedBoxFn != nil && IsEncryptedBoxFn(box) {
		return nil, errors.New("encrypted blocktree db not opened for box " + box)
	}
	return query(stmt, args...)
}

func queryRowForBox(box, stmt string, args ...any) *sql.Row {
	if boxDB := getEncryptedBlockTreeDB(box); boxDB != nil {
		return boxDB.QueryRow(stmt, args...)
	}
	if IsEncryptedBoxFn != nil && IsEncryptedBoxFn(box) {
		return nil
	}
	return queryRow(stmt, args...)
}

func execForBox(box, stmt string, args ...any) (sql.Result, error) {
	if boxDB := getEncryptedBlockTreeDB(box); boxDB != nil {
		return boxDB.Exec(stmt, args...)
	}
	if IsEncryptedBoxFn != nil && IsEncryptedBoxFn(box) {
		return nil, errors.New("encrypted blocktree db not opened for box " + box)
	}
	return exec(stmt, args...)
}

func beginTxForBox(box string) (tx *sql.Tx, err error) {
	if boxDB := getEncryptedBlockTreeDB(box); boxDB != nil {
		return boxDB.Begin()
	}
	if IsEncryptedBoxFn != nil && IsEncryptedBoxFn(box) {
		return nil, errors.New("encrypted blocktree db not opened for box " + box)
	}
	return db.Begin()
}

// --- InBox 读函数（加密笔记本内浏览时调用方传 boxID，路由到加密 db） ---

// GetBlockTreeInBox 按 id 在指定 box 的 db 里查块树。boxID 为空则查全局 db。
func GetBlockTreeInBox(id, boxID string) (ret *BlockTree) {
	if boxID == "" {
		return GetBlockTree(id)
	}
	ret = &BlockTree{}
	sqlStmt := "SELECT * FROM blocktrees WHERE id = ?"
	row := queryRowForBox(boxID, sqlStmt, id)
	if row == nil {
		return nil // 加密笔记本未解锁，视作不存在
	}
	err := row.Scan(&ret.ID, &ret.RootID, &ret.ParentID, &ret.BoxID, &ret.Path, &ret.HPath, &ret.Updated, &ret.Type)
	if err != nil {
		ret = nil
		if !errors.Is(err, sql.ErrNoRows) {
			logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		}
		return
	}
	return
}

// GetBlockTreesInBox 按 ids 在指定 box 的 db 里批量查块树。
func GetBlockTreesInBox(ids []string, boxID string) (ret map[string]*BlockTree) {
	ret = map[string]*BlockTree{}
	if 1 > len(ids) {
		return
	}
	sqlStmt := "SELECT * FROM blocktrees WHERE id IN (" + strings.Repeat("?,", len(ids)-1) + "?)"
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	rows, err := queryForBox(boxID, sqlStmt, args...)
	if err != nil {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var block BlockTree
		if err = rows.Scan(&block.ID, &block.RootID, &block.ParentID, &block.BoxID, &block.Path, &block.HPath, &block.Updated, &block.Type); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret[block.ID] = &block
	}
	return
}

// ExistBlockTreeInBox 判断指定 box 的 db 里是否存在该 id 的块树。
func ExistBlockTreeInBox(id, boxID string) bool {
	sqlStmt := "SELECT 1 FROM blocktrees WHERE id = ? LIMIT 1"
	row := queryRowForBox(boxID, sqlStmt, id)
	if row == nil {
		return false // 加密笔记本未解锁，视作不存在
	}
	var tmp any
	return row.Scan(&tmp) == nil
}

// ExistBlockTreesInBox 按 ids 在指定 box 的 db 里批量查块是否存在。
func ExistBlockTreesInBox(ids []string, boxID string) (ret map[string]bool) {
	ret = map[string]bool{}
	if 1 > len(ids) {
		return
	}
	for _, id := range ids {
		ret[id] = false
	}
	sqlStmt := "SELECT id FROM blocktrees WHERE id IN ('" + strings.Join(ids, "','") + "')"
	rows, err := queryForBox(boxID, sqlStmt)
	if err != nil {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret[id] = true
	}
	return
}

// GetBlockTreesByRootIDInBox 按 rootID 在指定 box 的 db 里查块树。
func GetBlockTreesByRootIDInBox(rootID, boxID string) (ret []*BlockTree) {
	sqlStmt := "SELECT * FROM blocktrees WHERE root_id = ? AND box_id = ?"
	rows, err := queryForBox(boxID, sqlStmt, rootID, boxID)
	if err != nil {
		logging.LogErrorf("sql query [%s] failed: %s", sqlStmt, err)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var block BlockTree
		if err = rows.Scan(&block.ID, &block.RootID, &block.ParentID, &block.BoxID, &block.Path, &block.HPath, &block.Updated, &block.Type); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret = append(ret, &block)
	}
	return
}
