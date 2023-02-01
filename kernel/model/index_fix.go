// SiYuan - Build Your Eternal Digital Garden
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
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// FixIndexJob 自动校验数据库索引 https://github.com/siyuan-note/siyuan/issues/7016
func FixIndexJob() {
	task.AppendTask(task.DatabaseIndexFix, autoFixIndex)
}

var autoFixLock = sync.Mutex{}

func autoFixIndex() {
	defer logging.Recover()

	autoFixLock.Lock()
	defer autoFixLock.Unlock()

	util.PushStatusBar(Conf.Language(58))

	// 去除重复的数据库块记录
	duplicatedRootIDs := sql.GetDuplicatedRootIDs("blocks")
	if 1 > len(duplicatedRootIDs) {
		duplicatedRootIDs = sql.GetDuplicatedRootIDs("blocks_fts")
		if 1 > len(duplicatedRootIDs) && !Conf.Search.CaseSensitive {
			duplicatedRootIDs = sql.GetDuplicatedRootIDs("blocks_fts_case_insensitive")
		}
	}

	util.PushStatusBar(Conf.Language(58))
	roots := sql.GetBlocks(duplicatedRootIDs)
	rootMap := map[string]*sql.Block{}
	for _, root := range roots {
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
		if util.IsExiting {
			break
		}
	}
	toRemoveRootIDs = gulu.Str.RemoveDuplicatedElem(toRemoveRootIDs)
	sql.BatchRemoveTreeQueue(toRemoveRootIDs)

	if 0 < deletes {
		logging.LogWarnf("exist more than one tree duplicated [%d], reindex it", deletes)
	}

	util.PushStatusBar(Conf.Language(58))
	sql.WaitForWritingDatabase()
	util.PushStatusBar(Conf.Language(58))
	// 根据文件系统补全块树
	boxes := Conf.GetOpenedBoxes()
	for _, box := range boxes {
		boxPath := filepath.Join(util.DataDir, box.ID)
		var paths []string
		filepath.Walk(boxPath, func(path string, info os.FileInfo, err error) error {
			if !info.IsDir() && filepath.Ext(path) == ".sy" {
				p := path[len(boxPath):]
				p = filepath.ToSlash(p)
				paths = append(paths, p)
			}
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

			reindexTreeByPath(box.ID, p, i, size)
			if util.IsExiting {
				break
			}
		}

		if util.IsExiting {
			break
		}
	}

	util.PushStatusBar(Conf.Language(58))
	sql.WaitForWritingDatabase()
	util.PushStatusBar(Conf.Language(58))
	// 清理已关闭的笔记本块树
	boxes = Conf.GetClosedBoxes()
	for _, box := range boxes {
		treenode.RemoveBlockTreesByBoxID(box.ID)
	}

	// 对比块树和数据库并订正数据库
	rootUpdatedMap := treenode.GetRootUpdated()
	dbRootUpdatedMap, err := sql.GetRootUpdated()
	if nil == err {
		reindexTreeByUpdated(rootUpdatedMap, dbRootUpdatedMap)
	}

	util.PushStatusBar(Conf.Language(58))
	sql.WaitForWritingDatabase()
	util.PushStatusBar(Conf.Language(185))
}

func reindexTreeByUpdated(rootUpdatedMap, dbRootUpdatedMap map[string]string) {
	i := -1
	size := len(rootUpdatedMap)
	for rootID, updated := range rootUpdatedMap {
		i++

		if util.IsExiting {
			break
		}

		rootUpdated := dbRootUpdatedMap[rootID]
		if "" == rootUpdated {
			//logging.LogWarnf("not found tree [%s] in database, reindex it", rootID)
			reindexTree(rootID, i, size)
			continue
		}

		if "" == updated {
			// BlockTree 迁移，v2.6.3 之前没有 updated 字段
			reindexTree(rootID, i, size)
			continue
		}

		btUpdated, _ := time.Parse("20060102150405", updated)
		dbUpdated, _ := time.Parse("20060102150405", rootUpdated)
		if dbUpdated.Before(btUpdated.Add(-10 * time.Minute)) {
			logging.LogWarnf("tree [%s] is not up to date, reindex it", rootID)
			reindexTree(rootID, i, size)
			continue
		}

		if util.IsExiting {
			break
		}
	}

	var rootIDs []string
	for rootID, _ := range dbRootUpdatedMap {
		if _, ok := rootUpdatedMap[rootID]; !ok {
			rootIDs = append(rootIDs, rootID)
		}

		if util.IsExiting {
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
		if util.IsExiting {
			break
		}
	}
	toRemoveRootIDs = gulu.Str.RemoveDuplicatedElem(toRemoveRootIDs)
	//logging.LogWarnf("tree [%s] is not in block tree, remove it from [%s]", id, root.Box)
	sql.BatchRemoveTreeQueue(toRemoveRootIDs)
}

func reindexTreeByPath(box, p string, i, size int) {
	tree, err := LoadTree(box, p)
	if nil != err {
		return
	}

	reindexTree0(tree, i, size)
}

func reindexTree(rootID string, i, size int) {
	root := treenode.GetBlockTree(rootID)
	if nil == root {
		logging.LogWarnf("root block not found", rootID)
		return
	}

	tree, err := LoadTree(root.BoxID, root.Path)
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
		indexWriteJSONQueue(tree)
	} else {
		treenode.IndexBlockTree(tree)
		sql.IndexTreeQueue(tree.Box, tree.Path)
	}

	if 0 == i%64 {
		util.PushStatusBar(fmt.Sprintf(Conf.Language(183), i, size, html.EscapeHTMLStr(path.Base(tree.HPath))))
	}
}
