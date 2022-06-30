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

	"github.com/88250/flock"
	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/dustin/go-humanize"
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
	Path     string // 文档物理路径
	HPath    string // 文档逻辑路径
}

func GetBlockTrees() map[string]*BlockTree {
	return blockTrees
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
			b.BoxID, b.Path, b.HPath = tree.Box, tree.Path, tree.HPath
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
	for _, id := range ids {
		delete(blockTrees, id)
	}
	blockTreesChanged = true
}

func RemoveBlockTreesByBoxID(boxID string) {
	blockTreesLock.Lock()
	defer blockTreesLock.Unlock()

	var ids []string
	for _, b := range blockTrees {
		if b.BoxID == boxID {
			ids = append(ids, b.ID)
		}
	}
	for _, id := range ids {
		delete(blockTrees, id)
	}
	blockTreesChanged = true
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
		blockTrees[n.ID] = &BlockTree{ID: n.ID, ParentID: parentID, RootID: tree.ID, BoxID: tree.Box, Path: tree.Path, HPath: tree.HPath}
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
		blockTrees[n.ID] = &BlockTree{ID: n.ID, ParentID: parentID, RootID: tree.ID, BoxID: tree.Box, Path: tree.Path, HPath: tree.HPath}
		return ast.WalkContinue
	})

	// 新建索引不变更持久化文件，调用处会负责调用 SaveBlockTree()
}

var blocktreeFileLock *flock.Flock

func AutoFlushBlockTree() {
	for {
		if blockTreesChanged {
			SaveBlockTree()
			blockTreesChanged = false
		}
		time.Sleep(7 * time.Second)
	}
}

func InitBlockTree() {
	start := time.Now()

	if nil == blocktreeFileLock {
		blocktreeFileLock = flock.New(util.BlockTreePath)
	}

	var err error
	if err = blocktreeFileLock.Lock(); nil != err {
		util.LogErrorf("read block tree failed: %s", err)
		os.Exit(util.ExitCodeBlockTreeErr)
		return
	}

	fh := blocktreeFileLock.Fh()
	if _, err = fh.Seek(0, io.SeekStart); nil != err {
		util.LogErrorf("read block tree failed: %s", err)
		os.Exit(util.ExitCodeBlockTreeErr)
		return
	}
	data, err := io.ReadAll(fh)
	if nil != err {
		util.LogErrorf("read block tree failed: %s", err)
		os.Exit(util.ExitCodeBlockTreeErr)
		return
	}
	blockTreesLock.Lock()
	if err = msgpack.Unmarshal(data, &blockTrees); nil != err {
		util.LogErrorf("unmarshal block tree failed: %s", err)
		if err = os.RemoveAll(util.BlockTreePath); nil != err {
			util.LogErrorf("removed corrupted block tree failed: %s", err)
		}
		os.Exit(util.ExitCodeBlockTreeErr)
		return
	}
	blockTreesLock.Unlock()
	debug.FreeOSMemory()
	if elapsed := time.Since(start).Seconds(); 2 < elapsed {
		util.LogWarnf("read block tree [%s] to [%s], elapsed [%.2fs]", humanize.Bytes(uint64(len(data))), util.BlockTreePath, elapsed)
	}
	return
}

func SaveBlockTree() {
	start := time.Now()

	if nil == blocktreeFileLock {
		blocktreeFileLock = flock.New(util.BlockTreePath)
	}

	if err := blocktreeFileLock.Lock(); nil != err {
		util.LogErrorf("read block tree failed: %s", err)
		os.Exit(util.ExitCodeBlockTreeErr)
		return
	}

	blockTreesLock.Lock()
	data, err := msgpack.Marshal(blockTrees)
	if nil != err {
		util.LogErrorf("marshal block tree failed: %s", err)
		os.Exit(util.ExitCodeBlockTreeErr)
		return
	}
	blockTreesLock.Unlock()

	fh := blocktreeFileLock.Fh()
	if err = gulu.File.WriteFileSaferByHandle(fh, data); nil != err {
		util.LogErrorf("write block tree failed: %s", err)
		os.Exit(util.ExitCodeBlockTreeErr)
		return
	}
	debug.FreeOSMemory()
	if elapsed := time.Since(start).Seconds(); 2 < elapsed {
		util.LogWarnf("save block tree [size=%s] to [%s], elapsed [%.2fs]", humanize.Bytes(uint64(len(data))), util.BlockTreePath, elapsed)
	}
}

func CloseBlockTree() {
	SaveBlockTree()
	if err := blocktreeFileLock.Unlock(); nil != err {
		util.LogErrorf("close block tree failed: %s", err)
	}
}
