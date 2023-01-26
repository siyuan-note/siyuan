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
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/dustin/go-humanize"
	util2 "github.com/siyuan-note/dejavu/util"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	"github.com/vmihailenco/msgpack/v5"
)

var blockTrees = sync.Map{}

type btSlice struct {
	data    map[string]*BlockTree
	changed time.Time
	m       *sync.Mutex
}

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

func GetRootUpdated() (ret map[string]string) {
	ret = map[string]string{}
	blockTrees.Range(func(key, value interface{}) bool {
		slice := value.(*btSlice)
		slice.m.Lock()
		for _, b := range slice.data {
			if b.RootID == b.ID {
				ret[b.RootID] = b.Updated
			}
		}
		slice.m.Unlock()
		return true
	})
	return
}

func GetBlockTreeByPath(path string) (ret *BlockTree) {
	blockTrees.Range(func(key, value interface{}) bool {
		slice := value.(*btSlice)
		slice.m.Lock()
		for _, b := range slice.data {
			if b.Path == path {
				ret = b
				break
			}
		}
		slice.m.Unlock()
		return nil == ret
	})
	return
}

func CountTrees() (ret int) {
	roots := map[string]bool{}
	blockTrees.Range(func(key, value interface{}) bool {
		slice := value.(*btSlice)
		slice.m.Lock()
		for _, b := range slice.data {
			roots[b.RootID] = true
		}
		slice.m.Unlock()
		return true
	})
	ret = len(roots)
	return
}

func CountBlocks() (ret int) {
	blockTrees.Range(func(key, value interface{}) bool {
		slice := value.(*btSlice)
		slice.m.Lock()
		ret += len(slice.data)
		slice.m.Unlock()
		return true
	})
	return
}

func GetRedundantPaths(boxID string, paths []string) (ret []string) {
	pathsMap := map[string]bool{}
	for _, path := range paths {
		pathsMap[path] = true
	}

	btPathsMap := map[string]bool{}
	blockTrees.Range(func(key, value interface{}) bool {
		slice := value.(*btSlice)
		slice.m.Lock()
		for _, b := range slice.data {
			if b.BoxID == boxID {
				btPathsMap[b.Path] = true
			}
		}
		slice.m.Unlock()
		return true
	})

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

	btPathsMap := map[string]bool{}
	blockTrees.Range(func(key, value interface{}) bool {
		slice := value.(*btSlice)
		slice.m.Lock()
		for _, b := range slice.data {
			if b.BoxID == boxID {
				btPathsMap[b.Path] = true
			}
		}
		slice.m.Unlock()
		return true
	})

	for p, _ := range pathsMap {
		if !btPathsMap[p] {
			ret = append(ret, p)
		}
	}
	ret = gulu.Str.RemoveDuplicatedElem(ret)
	return
}

func GetBlockTreeRootByPath(boxID, path string) (ret *BlockTree) {
	blockTrees.Range(func(key, value interface{}) bool {
		slice := value.(*btSlice)
		slice.m.Lock()
		for _, b := range slice.data {
			if b.BoxID == boxID && b.Path == path && b.RootID == b.ID {
				ret = b
				break
			}
		}
		slice.m.Unlock()
		return nil == ret
	})
	return
}

func GetBlockTreeRootByHPath(boxID, hPath string) (ret *BlockTree) {
	blockTrees.Range(func(key, value interface{}) bool {
		slice := value.(*btSlice)
		slice.m.Lock()
		for _, b := range slice.data {
			if b.BoxID == boxID && b.HPath == hPath && b.RootID == b.ID {
				ret = b
				break
			}
		}
		slice.m.Unlock()
		return nil == ret
	})
	return
}

func GetBlockTree(id string) (ret *BlockTree) {
	if "" == id {
		return
	}

	hash := btHash(id)
	val, ok := blockTrees.Load(hash)
	if !ok {
		return
	}
	slice := val.(*btSlice)
	slice.m.Lock()
	ret = slice.data[id]
	slice.m.Unlock()
	return
}

func SetBlockTreePath(tree *parse.Tree) {
	hash := btHash(tree.ID)
	val, ok := blockTrees.Load(hash)
	if !ok {
		val = &btSlice{data: map[string]*BlockTree{}, changed: time.Time{}, m: &sync.Mutex{}}
		blockTrees.Store(hash, val)
	}

	slice := val.(*btSlice)
	slice.m.Lock()
	slice.data[tree.ID] = &BlockTree{
		ID:      tree.ID,
		RootID:  tree.Root.ID,
		BoxID:   tree.Box,
		Path:    tree.Path,
		HPath:   tree.HPath,
		Updated: tree.Root.IALAttr("updated"),
		Type:    TypeAbbr(ast.NodeDocument.String()),
	}
	slice.m.Unlock()
	slice.changed = time.Now()
}

func RemoveBlockTreesByRootID(rootID string) {
	var ids []string
	blockTrees.Range(func(key, value interface{}) bool {
		slice := value.(*btSlice)
		slice.m.Lock()
		for _, b := range slice.data {
			if b.RootID == rootID {
				ids = append(ids, b.RootID)
			}
		}
		slice.m.Unlock()
		return true
	})

	ids = gulu.Str.RemoveDuplicatedElem(ids)
	for _, id := range ids {
		val, ok := blockTrees.Load(btHash(id))
		if !ok {
			continue
		}
		slice := val.(*btSlice)
		slice.m.Lock()
		delete(slice.data, id)
		slice.m.Unlock()
		slice.changed = time.Now()
	}
}

func RemoveBlockTreesByPath(path string) {
	var ids []string
	blockTrees.Range(func(key, value interface{}) bool {
		slice := value.(*btSlice)
		slice.m.Lock()
		for _, b := range slice.data {
			if b.Path == path {
				ids = append(ids, b.RootID)
			}
		}
		slice.m.Unlock()
		return true
	})

	ids = gulu.Str.RemoveDuplicatedElem(ids)
	for _, id := range ids {
		val, ok := blockTrees.Load(btHash(id))
		if !ok {
			continue
		}
		slice := val.(*btSlice)
		slice.m.Lock()
		delete(slice.data, id)
		slice.m.Unlock()
		slice.changed = time.Now()
	}
}

func RemoveBlockTreesByPathPrefix(pathPrefix string) {
	var ids []string
	blockTrees.Range(func(key, value interface{}) bool {
		slice := value.(*btSlice)
		slice.m.Lock()
		for _, b := range slice.data {
			if strings.HasPrefix(b.Path, pathPrefix) {
				ids = append(ids, b.RootID)
			}
		}
		slice.m.Unlock()
		return true
	})

	ids = gulu.Str.RemoveDuplicatedElem(ids)
	for _, id := range ids {
		val, ok := blockTrees.Load(btHash(id))
		if !ok {
			continue
		}
		slice := val.(*btSlice)
		slice.m.Lock()
		delete(slice.data, id)
		slice.m.Unlock()
		slice.changed = time.Now()
	}
}

func RemoveBlockTreesByBoxID(boxID string) (ids []string) {
	blockTrees.Range(func(key, value interface{}) bool {
		slice := value.(*btSlice)
		slice.m.Lock()
		for _, b := range slice.data {
			if b.BoxID == boxID {
				ids = append(ids, b.RootID)
			}
		}
		slice.m.Unlock()
		return true
	})

	ids = gulu.Str.RemoveDuplicatedElem(ids)
	for _, id := range ids {
		val, ok := blockTrees.Load(btHash(id))
		if !ok {
			continue
		}
		slice := val.(*btSlice)
		slice.m.Lock()
		delete(slice.data, id)
		slice.m.Unlock()
		slice.changed = time.Now()
	}
	return
}

func RemoveBlockTree(id string) {
	val, ok := blockTrees.Load(btHash(id))
	if !ok {
		return
	}
	slice := val.(*btSlice)
	slice.m.Lock()
	delete(slice.data, id)
	slice.m.Unlock()
	slice.changed = time.Now()
}

func IndexBlockTree(tree *parse.Tree) {
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

		hash := btHash(n.ID)
		val, ok := blockTrees.Load(hash)
		if !ok {
			val = &btSlice{data: map[string]*BlockTree{}, changed: time.Time{}, m: &sync.Mutex{}}
			blockTrees.Store(hash, val)
		}
		slice := val.(*btSlice)
		slice.m.Lock()
		if bt := slice.data[n.ID]; nil != bt {
			if bt.Updated != n.IALAttr("updated") {
				slice.data[n.ID] = &BlockTree{ID: n.ID, ParentID: parentID, RootID: tree.ID, BoxID: tree.Box, Path: tree.Path, HPath: tree.HPath, Updated: n.IALAttr("updated"), Type: TypeAbbr(n.Type.String())}
				slice.changed = time.Now()
			}
		} else {
			slice.data[n.ID] = &BlockTree{ID: n.ID, ParentID: parentID, RootID: tree.ID, BoxID: tree.Box, Path: tree.Path, HPath: tree.HPath, Updated: n.IALAttr("updated"), Type: TypeAbbr(n.Type.String())}
			slice.changed = time.Now()
		}
		slice.m.Unlock()
		return ast.WalkContinue
	})
}

func AutoFlushBlockTree() {
	for {
		SaveBlockTree(false)
		time.Sleep(1 * time.Second)
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

	entries, err := os.ReadDir(util.BlockTreePath)
	if nil != err {
		logging.LogErrorf("read block tree dir failed: %s", err)
		os.Exit(util.ExitCodeBlockTreeErr)
		return
	}

	size := uint64(0)
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".msgpack") {
			continue
		}

		p := filepath.Join(util.BlockTreePath, entry.Name())
		var fh *os.File
		fh, err = os.OpenFile(p, os.O_RDWR, 0644)
		if nil != err {
			logging.LogErrorf("open block tree file failed: %s", err)
			os.Exit(util.ExitCodeBlockTreeErr)
			return
		}

		var data []byte
		data, err = io.ReadAll(fh)
		fh.Close()
		if nil != err {
			logging.LogErrorf("read block tree failed: %s", err)
			os.Exit(util.ExitCodeBlockTreeErr)
			return
		}

		sliceData := map[string]*BlockTree{}
		if err = msgpack.Unmarshal(data, &sliceData); nil != err {
			logging.LogErrorf("unmarshal block tree failed: %s", err)
			if err = os.RemoveAll(util.BlockTreePath); nil != err {
				logging.LogErrorf("removed corrupted block tree failed: %s", err)
			}
			os.Exit(util.ExitCodeBlockTreeErr)
			return
		}

		name := entry.Name()[0:strings.Index(entry.Name(), ".")]
		blockTrees.Store(name, &btSlice{data: sliceData, changed: time.Time{}, m: &sync.Mutex{}})
		size += uint64(len(data))
	}

	runtime.GC()

	if elapsed := time.Since(start).Seconds(); 2 < elapsed {
		logging.LogWarnf("read block tree [%s] to [%s], elapsed [%.2fs]", humanize.Bytes((size)), util.BlockTreePath, elapsed)
	}
	return
}

func SaveBlockTree(force bool) {
	start := time.Now()
	os.MkdirAll(util.BlockTreePath, 0755)

	size := uint64(0)
	blockTrees.Range(func(key, value interface{}) bool {
		slice := value.(*btSlice)
		if !force && (slice.changed.IsZero() || slice.changed.After(start.Add(-7*time.Second))) {
			return true
		}

		slice.m.Lock()
		data, err := msgpack.Marshal(slice.data)
		if nil != err {
			logging.LogErrorf("marshal block tree failed: %s", err)
			os.Exit(util.ExitCodeBlockTreeErr)
			return false
		}
		slice.m.Unlock()

		p := filepath.Join(util.BlockTreePath, key.(string)) + ".msgpack"
		if err = gulu.File.WriteFileSafer(p, data, 0644); nil != err {
			logging.LogErrorf("write block tree failed: %s", err)
			os.Exit(util.ExitCodeBlockTreeErr)
			return false
		}
		slice.changed = time.Time{}
		size += uint64(len(data))
		return true
	})

	runtime.GC()

	if elapsed := time.Since(start).Seconds(); 2 < elapsed {
		logging.LogWarnf("save block tree [size=%s] to [%s], elapsed [%.2fs]", humanize.Bytes(size), util.BlockTreePath, elapsed)
	}
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

func btHash(id string) string {
	return util2.Hash([]byte(id))[0:2]
}
