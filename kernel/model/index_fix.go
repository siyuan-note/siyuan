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

package model

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	checkIndexOnce = sync.Once{}
)

// checkIndex 自动校验数据库索引，仅在数据同步执行完成后执行一次。
func checkIndex() {
	checkIndexOnce.Do(func() {
		logging.LogInfof("start checking index...")

		task.AppendTask(task.DatabaseIndexFix, removeDuplicateDatabaseIndex)
		sql.WaitForWritingDatabase()

		task.AppendTask(task.DatabaseIndexFix, resetDuplicateBlocksOnFileSys)

		task.AppendTask(task.DatabaseIndexFix, fixBlockTreeByFileSys)
		sql.WaitForWritingDatabase()

		task.AppendTask(task.DatabaseIndexFix, fixDatabaseIndexByBlockTree)
		sql.WaitForWritingDatabase()

		task.AppendTask(task.DatabaseIndexFix, removeDuplicateDatabaseRefs)

		// 后面要加任务的话记得修改推送任务栏的进度 util.PushStatusBar(fmt.Sprintf(Conf.Language(58), 1, 5))

		task.AppendTask(task.DatabaseIndexFix, func() {
			util.PushStatusBar(Conf.Language(185))
		})
		debug.FreeOSMemory()
		logging.LogInfof("finish checking index")
	})
}

var autoFixLock = sync.Mutex{}

// removeDuplicateDatabaseRefs 删除重复的数据库引用关系。
func removeDuplicateDatabaseRefs() {
	defer logging.Recover()

	autoFixLock.Lock()
	defer autoFixLock.Unlock()

	util.PushStatusBar(fmt.Sprintf(Conf.Language(58), 5, 5))
	duplicatedRootIDs := sql.GetRefDuplicatedDefRootIDs()
	for _, rootID := range duplicatedRootIDs {
		refreshRefsByDefID(rootID)
	}

	for _, rootID := range duplicatedRootIDs {
		logging.LogWarnf("exist more than one ref duplicated [%s], reindex it", rootID)
	}
}

// removeDuplicateDatabaseIndex 删除重复的数据库索引。
func removeDuplicateDatabaseIndex() {
	defer logging.Recover()

	autoFixLock.Lock()
	defer autoFixLock.Unlock()

	util.PushStatusBar(fmt.Sprintf(Conf.Language(58), 1, 5))
	duplicatedRootIDs := sql.GetDuplicatedRootIDs("blocks")
	if 1 > len(duplicatedRootIDs) {
		duplicatedRootIDs = sql.GetDuplicatedRootIDs("blocks_fts")
		if 1 > len(duplicatedRootIDs) && !Conf.Search.CaseSensitive {
			duplicatedRootIDs = sql.GetDuplicatedRootIDs("blocks_fts_case_insensitive")
		}
	}

	roots := sql.GetBlocks(duplicatedRootIDs)
	rootMap := map[string]*sql.Block{}
	for _, root := range roots {
		if nil == root {
			continue
		}
		rootMap[root.ID] = root
	}

	var toRemoveRootIDs []string
	var deletes int
	for _, rootID := range duplicatedRootIDs {
		root := rootMap[rootID]
		if nil == root {
			continue
		}
		deletes++
		toRemoveRootIDs = append(toRemoveRootIDs, rootID)
		if util.IsExiting.Load() {
			break
		}
	}
	toRemoveRootIDs = gulu.Str.RemoveDuplicatedElem(toRemoveRootIDs)
	sql.BatchRemoveTreeQueue(toRemoveRootIDs)

	if 0 < deletes {
		logging.LogWarnf("exist more than one tree duplicated [%d], reindex it", deletes)
	}
}

// resetDuplicateBlocksOnFileSys 重置重复 ID 的块。 https://github.com/siyuan-note/siyuan/issues/7357
func resetDuplicateBlocksOnFileSys() {
	defer logging.Recover()

	autoFixLock.Lock()
	defer autoFixLock.Unlock()

	util.PushStatusBar(fmt.Sprintf(Conf.Language(58), 2, 5))
	boxes := Conf.GetBoxes()
	luteEngine := lute.New()
	blockIDs := map[string]bool{}
	needRefreshUI := false
	for _, box := range boxes {
		// 校验索引阶段自动删除历史遗留的笔记本 history 文件夹
		legacyHistory := filepath.Join(util.DataDir, box.ID, ".siyuan", "history")
		if gulu.File.IsDir(legacyHistory) {
			if removeErr := os.RemoveAll(legacyHistory); nil != removeErr {
				logging.LogErrorf("remove legacy history failed: %s", removeErr)
			} else {
				logging.LogInfof("removed legacy history [%s]", legacyHistory)
			}
		}

		boxPath := filepath.Join(util.DataDir, box.ID)
		var duplicatedTrees []*parse.Tree
		filelock.Walk(boxPath, func(path string, info os.FileInfo, err error) error {
			if nil == info {
				return nil
			}

			if info.IsDir() {
				if boxPath == path {
					// 跳过笔记本文件夹
					return nil
				}

				if strings.HasPrefix(info.Name(), ".") {
					return filepath.SkipDir
				}

				if !ast.IsNodeIDPattern(info.Name()) {
					return nil
				}
				return nil
			}

			if filepath.Ext(path) != ".sy" || strings.Contains(filepath.ToSlash(path), "/assets/") {
				return nil
			}

			if !ast.IsNodeIDPattern(strings.TrimSuffix(info.Name(), ".sy")) {
				logging.LogWarnf("invalid .sy file name [%s]", path)
				box.moveCorruptedData(path)
				return nil
			}

			p := path[len(boxPath):]
			p = filepath.ToSlash(p)
			tree, loadErr := filesys.LoadTree(box.ID, p, luteEngine)
			if nil != loadErr {
				logging.LogErrorf("load tree [%s] failed: %s", p, loadErr)
				return nil
			}

			needOverwrite := false
			ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if !entering || !n.IsBlock() {
					return ast.WalkContinue
				}

				if "" == n.ID {
					needOverwrite = true
					n.ID = ast.NewNodeID()
					n.SetIALAttr("id", n.ID)
					return ast.WalkContinue
				}

				if !blockIDs[n.ID] {
					blockIDs[n.ID] = true
					return ast.WalkContinue
				}

				// 存在重复的块 ID

				if ast.NodeDocument == n.Type {
					// 如果是文档根节点，则重置这颗树
					// 这里不能在迭代中重置，因为如果这个文档存在子文档的话，重置时会重命名子文档文件夹，后续迭代可能会导致子文档 ID 重复
					duplicatedTrees = append(duplicatedTrees, tree)
					return ast.WalkStop
				}

				// 其他情况，重置节点 ID
				needOverwrite = true
				n.ID = ast.NewNodeID()
				n.SetIALAttr("id", n.ID)
				needRefreshUI = true
				return ast.WalkContinue
			})

			if needOverwrite {
				logging.LogWarnf("exist more than one node with the same id in tree [%s], reset it", box.ID+p)
				if writeErr := filesys.WriteTree(tree); nil != writeErr {
					logging.LogErrorf("write tree [%s] failed: %s", p, writeErr)
				}
			}
			return nil
		})

		for _, tree := range duplicatedTrees {
			absPath := filepath.Join(boxPath, tree.Path)
			logging.LogWarnf("exist more than one tree with the same id [%s], reset it", absPath)
			recreateTree(tree, absPath)
			needRefreshUI = true
		}
	}

	if needRefreshUI {
		util.ReloadUI()
		go func() {
			time.Sleep(time.Second * 3)
			util.PushMsg(Conf.Language(190), 5000)
		}()
	}
}

func recreateTree(tree *parse.Tree, absPath string) {
	// 删除关于该树的所有块树数据，后面会调用 fixBlockTreeByFileSys() 进行订正补全
	treenode.RemoveBlockTreesByPathPrefix(strings.TrimSuffix(tree.Path, ".sy"))
	treenode.RemoveBlockTreesByRootID(tree.ID)

	resetTree(tree, "", true)
	if err := filesys.WriteTree(tree); nil != err {
		logging.LogWarnf("write tree [%s] failed: %s", tree.Path, err)
		return
	}

	if gulu.File.IsDir(strings.TrimSuffix(absPath, ".sy")) {
		// 重命名子文档文件夹
		from := strings.TrimSuffix(absPath, ".sy")
		to := filepath.Join(filepath.Dir(absPath), tree.ID)
		if renameErr := os.Rename(from, to); nil != renameErr {
			logging.LogWarnf("rename [%s] failed: %s", from, renameErr)
			return
		}
	}

	if err := filelock.Remove(absPath); nil != err {
		logging.LogWarnf("remove [%s] failed: %s", absPath, err)
		return
	}
}

// fixBlockTreeByFileSys 通过文件系统订正块树。
func fixBlockTreeByFileSys() {
	defer logging.Recover()

	autoFixLock.Lock()
	defer autoFixLock.Unlock()

	util.PushStatusBar(fmt.Sprintf(Conf.Language(58), 3, 5))
	boxes := Conf.GetOpenedBoxes()
	luteEngine := lute.New()
	for _, box := range boxes {
		boxPath := filepath.Join(util.DataDir, box.ID)
		var paths []string
		filelock.Walk(boxPath, func(path string, info os.FileInfo, err error) error {
			if boxPath == path {
				// 跳过根路径（笔记本文件夹）
				return nil
			}

			if nil == info {
				return nil
			}

			if info.IsDir() {
				if strings.HasPrefix(info.Name(), ".") {
					return filepath.SkipDir
				}
				return nil
			}

			if filepath.Ext(path) != ".sy" || strings.Contains(filepath.ToSlash(path), "/assets/") {
				return nil
			}

			p := path[len(boxPath):]
			p = filepath.ToSlash(p)
			paths = append(paths, p)
			return nil
		})

		size := len(paths)

		// 清理块树中的冗余数据
		treenode.ClearRedundantBlockTrees(box.ID, paths)

		// 重新索引缺失的块树
		missingPaths := treenode.GetNotExistPaths(box.ID, paths)
		for i, p := range missingPaths {
			id := path.Base(p)
			id = strings.TrimSuffix(id, ".sy")
			if !ast.IsNodeIDPattern(id) {
				continue
			}

			reindexTreeByPath(box.ID, p, i, size, luteEngine)
			if util.IsExiting.Load() {
				break
			}
		}

		if util.IsExiting.Load() {
			break
		}
	}

	// 清理已关闭的笔记本块树
	boxes = Conf.GetClosedBoxes()
	for _, box := range boxes {
		treenode.RemoveBlockTreesByBoxID(box.ID)
	}
}

// fixDatabaseIndexByBlockTree 通过块树订正数据库索引。
func fixDatabaseIndexByBlockTree() {
	defer logging.Recover()

	util.PushStatusBar(fmt.Sprintf(Conf.Language(58), 4, 5))
	rootUpdatedMap := treenode.GetRootUpdated()
	dbRootUpdatedMap, err := sql.GetRootUpdated()
	if nil == err {
		reindexTreeByUpdated(rootUpdatedMap, dbRootUpdatedMap)
	}
}

func reindexTreeByUpdated(rootUpdatedMap, dbRootUpdatedMap map[string]string) {
	i := -1
	size := len(rootUpdatedMap)
	luteEngine := util.NewLute()
	for rootID, updated := range rootUpdatedMap {
		i++

		if util.IsExiting.Load() {
			break
		}

		rootUpdated := dbRootUpdatedMap[rootID]
		if "" == rootUpdated {
			//logging.LogWarnf("not found tree [%s] in database, reindex it", rootID)
			reindexTree(rootID, i, size, luteEngine)
			continue
		}

		if "" == updated {
			// BlockTree 迁移，v2.6.3 之前没有 updated 字段
			reindexTree(rootID, i, size, luteEngine)
			continue
		}

		btUpdated, _ := time.Parse("20060102150405", updated)
		dbUpdated, _ := time.Parse("20060102150405", rootUpdated)
		if dbUpdated.Before(btUpdated.Add(-10 * time.Minute)) {
			logging.LogWarnf("tree [%s] is not up to date, reindex it", rootID)
			reindexTree(rootID, i, size, luteEngine)
			continue
		}

		if util.IsExiting.Load() {
			break
		}
	}

	var rootIDs []string
	for rootID := range dbRootUpdatedMap {
		if _, ok := rootUpdatedMap[rootID]; !ok {
			rootIDs = append(rootIDs, rootID)
		}

		if util.IsExiting.Load() {
			break
		}
	}
	rootIDs = gulu.Str.RemoveDuplicatedElem(rootIDs)
	roots := map[string]*sql.Block{}
	blocks := sql.GetBlocks(rootIDs)
	for _, block := range blocks {
		roots[block.RootID] = block
	}
	var toRemoveRootIDs []string
	for id, root := range roots {
		if nil == root {
			continue
		}

		toRemoveRootIDs = append(toRemoveRootIDs, id)
		if util.IsExiting.Load() {
			break
		}
	}
	toRemoveRootIDs = gulu.Str.RemoveDuplicatedElem(toRemoveRootIDs)
	//logging.LogWarnf("tree [%s] is not in block tree, remove it from [%s]", id, root.Box)
	sql.BatchRemoveTreeQueue(toRemoveRootIDs)
}

func reindexTreeByPath(box, p string, i, size int, luteEngine *lute.Lute) {
	tree, err := filesys.LoadTree(box, p, luteEngine)
	if nil != err {
		return
	}

	reindexTree0(tree, i, size)
}

func reindexTree(rootID string, i, size int, luteEngine *lute.Lute) {
	root := treenode.GetBlockTree(rootID)
	if nil == root {
		logging.LogWarnf("root block [%s] not found", rootID)
		return
	}

	tree, err := filesys.LoadTree(root.BoxID, root.Path, luteEngine)
	if nil != err {
		if os.IsNotExist(err) {
			// 文件系统上没有找到该 .sy 文件，则订正块树
			treenode.RemoveBlockTreesByRootID(rootID)
		}
		return
	}

	reindexTree0(tree, i, size)
}

func reindexTree0(tree *parse.Tree, i, size int) {
	updated := tree.Root.IALAttr("updated")
	if "" == updated {
		updated = util.TimeFromID(tree.Root.ID)
		tree.Root.SetIALAttr("updated", updated)
		indexWriteTreeUpsertQueue(tree)
	} else {
		treenode.UpsertBlockTree(tree)
		sql.IndexTreeQueue(tree)
	}

	if 0 == i%64 {
		util.PushStatusBar(fmt.Sprintf(Conf.Language(183), i, size, html.EscapeString(path.Base(tree.HPath))))
	}
}
