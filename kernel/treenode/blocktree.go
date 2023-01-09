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

package treenode

import (
	"io"
	"os"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/dustin/go-humanize"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/vmihailenco/msgpack/v5"
)

var blockTrees = map[string]*BlockTree{}
var blockTreesLock = sync.Mutex{}
var blockTreesChanged = false

type BlockTree struct {
	ID       string // 块 ID
	RootID   string // 根 ID
	ParentID string // 父 ID
	BoxID    string // 笔记本 ID
	Path     string // 文档数据路径
	HPath    string // 文档可读路径
	Updated  string // 更新时间
}

func GetRootUpdated() (ret map[string]string) {
	blockTreesLock.Lock()
	defer blockTreesLock.Unlock()

	ret = map[string]string{}
	for _, b := range blockTrees {
		if b.RootID == b.ID {
			ret[b.RootID] = b.Updated
		}
	}
	return
}

func GetBlockTreeByPath(path string) *BlockTree {
	blockTreesLock.Lock()
	defer blockTreesLock.Unlock()

	for _, b := range blockTrees {
		if b.Path == path {
			return b
		}
	}
	return nil
}

func CountTrees() (ret int) {
	blockTreesLock.Lock()
	defer blockTreesLock.Unlock()

	roots := map[string]bool{}
	for _, b := range blockTrees {
		roots[b.RootID] = true
	}
	ret = len(roots)
	return
}

func CountBlocks() (ret int) {
	blockTreesLock.Lock()
	defer blockTreesLock.Unlock()
	return len(blockTrees)
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

func GetRedundantPaths(boxID string, paths []string) (ret []string) {
	pathsMap := map[string]bool{}
	for _, path := range paths {
		pathsMap[path] = true
	}

	tmp := blockTrees
	btPathsMap := map[string]bool{}
	for _, blockTree := range tmp {
		if blockTree.BoxID != boxID {
			continue
		}

		btPathsMap[blockTree.Path] = true
	}

	for p, _ := range btPathsMap {
		if !pathsMap[p] {
			ret = append(ret, p)
		}
	}
	ret = gulu.Str.RemoveDuplicatedElem(ret)
	return
}

func GetNotExistPaths(boxID string, paths []string) (ret []string) {
	pathsMap := map[string]bool{}
	for _, path := range paths {
		pathsMap[path] = true
	}

	tmp := blockTrees
	btPathsMap := map[string]bool{}
	for _, blockTree := range tmp {
		if blockTree.BoxID != boxID {
			continue
		}

		btPathsMap[blockTree.Path] = true
	}

	for p, _ := range pathsMap {
		if !btPathsMap[p] {
			ret = append(ret, p)
		}
	}
	ret = gulu.Str.RemoveDuplicatedElem(ret)
	return
}

func GetBlockTreeRootByPath(boxID, path string) *BlockTree {
	blockTreesLock.Lock()
	defer blockTreesLock.Unlock()

	for _, blockTree := range blockTrees {
		if blockTree.BoxID == boxID && blockTree.Path == path && blockTree.RootID == blockTree.ID {
			return blockTree
		}
	}
	return nil
}

func GetBlockTreeRootByHPath(boxID, hPath string) *BlockTree {
	blockTreesLock.Lock()
	defer blockTreesLock.Unlock()

	for _, blockTree := range blockTrees {
		if blockTree.BoxID == boxID && blockTree.HPath == hPath && blockTree.RootID == blockTree.ID {
			return blockTree
		}
	}
	return nil
}

func GetBlockTree(id string) *BlockTree {
	if "" == id {
		return nil
	}

	blockTreesLock.Lock()
	defer blockTreesLock.Unlock()
	return blockTrees[id]
}

func SetBlockTreePath(tree *parse.Tree) {
	blockTreesLock.Lock()
	defer blockTreesLock.Unlock()

	for _, b := range blockTrees {
		if b.RootID == tree.ID {
			b.BoxID, b.Path, b.HPath, b.Updated = tree.Box, tree.Path, tree.HPath, tree.Root.IALAttr("updated")
		}
	}
	blockTreesChanged = true
}

func RemoveBlockTreesByRootID(rootID string) {
	blockTreesLock.Lock()
	defer blockTreesLock.Unlock()

	var ids []string
	for _, b := range blockTrees {
		if b.RootID == rootID {
			ids = append(ids, b.RootID)
		}
	}
	ids = gulu.Str.RemoveDuplicatedElem(ids)
	for _, id := range ids {
		delete(blockTrees, id)
	}
	blockTreesChanged = true
}

func RemoveBlockTreesByPath(path string) {
	blockTreesLock.Lock()
	defer blockTreesLock.Unlock()

	var ids []string
	for _, b := range blockTrees {
		if b.Path == path {
			ids = append(ids, b.ID)
		}
	}
	ids = gulu.Str.RemoveDuplicatedElem(ids)
	for _, id := range ids {
		delete(blockTrees, id)
	}
	blockTreesChanged = true
}

func RemoveBlockTreesByPathPrefix(pathPrefix string) {
	blockTreesLock.Lock()
	defer blockTreesLock.Unlock()

	var ids []string
	for _, b := range blockTrees {
		if strings.HasPrefix(b.Path, pathPrefix) {
			ids = append(ids, b.ID)
		}
	}
	ids = gulu.Str.RemoveDuplicatedElem(ids)
	for _, id := range ids {
		delete(blockTrees, id)
	}
	blockTreesChanged = true
}

func RemoveBlockTreesByBoxID(boxID string) (ids []string) {
	blockTreesLock.Lock()
	defer blockTreesLock.Unlock()

	for _, b := range blockTrees {
		if b.BoxID == boxID {
			ids = append(ids, b.ID)
		}
	}
	ids = gulu.Str.RemoveDuplicatedElem(ids)
	for _, id := range ids {
		delete(blockTrees, id)
	}
	blockTreesChanged = true
	return
}

func RemoveBlockTree(id string) {
	blockTreesLock.Lock()
	defer blockTreesLock.Unlock()

	delete(blockTrees, id)
	blockTreesChanged = true
}

func ReindexBlockTree(tree *parse.Tree) {
	blockTreesLock.Lock()
	defer blockTreesLock.Unlock()

	var ids []string
	for _, b := range blockTrees {
		if b.RootID == tree.ID {
			ids = append(ids, b.ID)
		}
	}
	ids = gulu.Str.RemoveDuplicatedElem(ids)
	for _, id := range ids {
		delete(blockTrees, id)
	}

	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !n.IsBlock() {
			return ast.WalkContinue
		}
		var parentID string
		if nil != n.Parent {
			parentID = n.Parent.ID
		}
		if "" == n.ID {
			return ast.WalkContinue
		}
		blockTrees[n.ID] = &BlockTree{ID: n.ID, ParentID: parentID, RootID: tree.ID, BoxID: tree.Box, Path: tree.Path, HPath: tree.HPath, Updated: tree.Root.IALAttr("updated")}
		return ast.WalkContinue
	})
	blockTreesChanged = true
}

func IndexBlockTree(tree *parse.Tree) {
	blockTreesLock.Lock()
	defer blockTreesLock.Unlock()

	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !n.IsBlock() {
			return ast.WalkContinue
		}
		var parentID string
		if nil != n.Parent {
			parentID = n.Parent.ID
		}
		if "" == n.ID {
			return ast.WalkContinue
		}
		blockTrees[n.ID] = &BlockTree{ID: n.ID, ParentID: parentID, RootID: tree.ID, BoxID: tree.Box, Path: tree.Path, HPath: tree.HPath, Updated: tree.Root.IALAttr("updated")}
		return ast.WalkContinue
	})

	// 新建索引不变更持久化文件，调用处会负责调用 SaveBlockTree()
}

func AutoFlushBlockTree() {
	for {
		SaveBlockTree(false)
		time.Sleep(7 * time.Second)
	}
}

func InitBlockTree(force bool) {
	start := time.Now()

	if force {
		err := os.RemoveAll(util.BlockTreePath)
		if nil != err {
			logging.LogErrorf("remove blocktree file failed: %s", err)
		}
		return
	}

	var err error
	fh, err := os.OpenFile(util.BlockTreePath, os.O_RDWR, 0644)
	if nil != err {
		logging.LogErrorf("open block tree file failed: %s", err)
		os.Exit(util.ExitCodeBlockTreeErr)
		return
	}
	defer fh.Close()

	data, err := io.ReadAll(fh)
	if nil != err {
		logging.LogErrorf("read block tree failed: %s", err)
		os.Exit(util.ExitCodeBlockTreeErr)
		return
	}
	blockTreesLock.Lock()
	if err = msgpack.Unmarshal(data, &blockTrees); nil != err {
		logging.LogErrorf("unmarshal block tree failed: %s", err)
		if err = os.RemoveAll(util.BlockTreePath); nil != err {
			logging.LogErrorf("removed corrupted block tree failed: %s", err)
		}
		os.Exit(util.ExitCodeBlockTreeErr)
		return
	}
	blockTreesLock.Unlock()
	debug.FreeOSMemory()
	if elapsed := time.Since(start).Seconds(); 2 < elapsed {
		logging.LogWarnf("read block tree [%s] to [%s], elapsed [%.2fs]", humanize.Bytes(uint64(len(data))), util.BlockTreePath, elapsed)
	}
	return
}

func SaveBlockTree(force bool) {
	if !force && !blockTreesChanged {
		return
	}

	start := time.Now()

	blockTreesLock.Lock()
	data, err := msgpack.Marshal(blockTrees)
	if nil != err {
		logging.LogErrorf("marshal block tree failed: %s", err)
		os.Exit(util.ExitCodeBlockTreeErr)
		return
	}
	blockTreesLock.Unlock()

	if err = gulu.File.WriteFileSafer(util.BlockTreePath, data, 0644); nil != err {
		logging.LogErrorf("write block tree failed: %s", err)
		os.Exit(util.ExitCodeBlockTreeErr)
		return
	}
	debug.FreeOSMemory()
	if elapsed := time.Since(start).Seconds(); 2 < elapsed {
		logging.LogWarnf("save block tree [size=%s] to [%s], elapsed [%.2fs]", humanize.Bytes(uint64(len(data))), util.BlockTreePath, elapsed)
	}

	blockTreesChanged = false
}
