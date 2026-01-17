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
	"bufio"
	"bytes"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/dataparser"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
	"golang.org/x/time/rate"
)

func resetTree(tree *parse.Tree, titleSuffix string, removeAvBinding bool) {
	tree.ID = ast.NewNodeID()
	tree.Root.ID = tree.ID
	title := tree.Root.IALAttr("title")
	if "" != titleSuffix {
		if t, parseErr := time.Parse("20060102150405", util.TimeFromID(tree.ID)); nil == parseErr {
			titleSuffix += " " + t.Format("2006-01-02 15:04:05")
		} else {
			titleSuffix = "Duplicated " + time.Now().Format("2006-01-02 15:04:05")
		}
		titleSuffix = "(" + titleSuffix + ")"
		titleSuffix = " " + titleSuffix
		if Conf.language(16) == title {
			titleSuffix = ""
		}
	}
	tree.Root.SetIALAttr("id", tree.ID)
	tree.Root.SetIALAttr("title", title+titleSuffix)
	tree.Root.RemoveIALAttr("scroll")
	p := path.Join(path.Dir(tree.Path), tree.ID) + ".sy"
	tree.Path = p
	tree.HPath = tree.HPath + " " + titleSuffix

	// 收集所有引用
	refIDs := map[string]string{}
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !treenode.IsBlockRef(n) {
			return ast.WalkContinue
		}
		defID, _, _ := treenode.GetBlockRef(n)
		if "" == defID {
			return ast.WalkContinue
		}
		refIDs[defID] = "1"
		return ast.WalkContinue
	})

	// 重置块 ID
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || ast.NodeDocument == n.Type {
			return ast.WalkContinue
		}
		if n.IsBlock() && "" != n.ID {
			newID := ast.NewNodeID()
			if "1" == refIDs[n.ID] {
				// 如果是文档自身的内部引用
				refIDs[n.ID] = newID
			}
			n.ID = newID
			n.SetIALAttr("id", n.ID)
		}
		return ast.WalkContinue
	})

	// 重置内部引用
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !treenode.IsBlockRef(n) {
			return ast.WalkContinue
		}
		defID, _, _ := treenode.GetBlockRef(n)
		if "" == defID {
			return ast.WalkContinue
		}
		if "1" != refIDs[defID] {
			if ast.NodeTextMark == n.Type {
				n.TextMarkBlockRefID = refIDs[defID]
			}
		}
		return ast.WalkContinue
	})

	var attrViewIDs []string
	// 绑定镜像数据库
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}

		if ast.NodeAttributeView == n.Type {
			av.UpsertBlockRel(n.AttributeViewID, n.ID)
			attrViewIDs = append(attrViewIDs, n.AttributeViewID)
		}
		return ast.WalkContinue
	})

	if removeAvBinding {
		// 清空文档绑定的数据库
		tree.Root.RemoveIALAttr(av.NodeAttrNameAvs)
	}
}

func pagedPaths(localPath string, pageSize int) (ret map[int][]string) {
	ret = map[int][]string{}
	page := 1
	filelock.Walk(localPath, func(path string, d fs.DirEntry, err error) error {
		if nil != err || nil == d {
			return nil
		}

		if d.IsDir() {
			if strings.HasPrefix(d.Name(), ".") {
				return filepath.SkipDir
			}
			return nil
		}

		if !strings.HasSuffix(d.Name(), ".sy") {
			return nil
		}

		ret[page] = append(ret[page], path)
		if pageSize <= len(ret[page]) {
			page++
		}
		return nil
	})
	return
}

func loadTree(localPath string, luteEngine *lute.Lute) (ret *parse.Tree, err error) {
	data, err := filelock.ReadFile(localPath)
	if err != nil {
		logging.LogErrorf("get data [path=%s] failed: %s", localPath, err)
		return
	}

	ret, err = dataparser.ParseJSONWithoutFix(data, luteEngine.ParseOptions)
	if err != nil {
		logging.LogErrorf("parse json to tree [%s] failed: %s", localPath, err)
		return
	}
	return
}

var (
	ErrBoxNotFound   = errors.New("notebook not found")
	ErrBlockNotFound = errors.New("block not found")
	ErrTreeNotFound  = errors.New("tree not found")
	ErrIndexing      = errors.New("indexing")
	ErrBoxUnindexed  = errors.New("notebook unindexed")
)

func LoadTreeByBlockIDWithReindex(id string) (ret *parse.Tree, err error) {
	if "" == id {
		logging.LogWarnf("block id is empty")
		return nil, ErrTreeNotFound
	}

	bt := treenode.GetBlockTree(id)
	if nil == bt {
		if task.ContainIndexTask() {
			err = ErrIndexing
			return
		}

		// 尝试从文件系统加载并建立索引
		err = indexTreeInFilesystem(id)
		bt = treenode.GetBlockTree(id)
		if nil == bt {
			if "dev" == util.Mode {
				logging.LogWarnf("block tree not found [id=%s], stack: [%s]", id, logging.ShortStack())
			}
			return
		}
	}

	luteEngine := util.NewLute()
	ret, err = filesys.LoadTree(bt.BoxID, bt.Path, luteEngine)
	return
}

func LoadTreeByBlockID(id string) (ret *parse.Tree, err error) {
	if !ast.IsNodeIDPattern(id) {
		stack := logging.ShortStack()
		logging.LogErrorf("block id is invalid [id=%s], stack: [%s]", id, stack)
		return nil, ErrTreeNotFound
	}

	bt := treenode.GetBlockTree(id)
	if nil == bt {
		if task.ContainIndexTask() {
			err = ErrIndexing
			return
		}

		stack := logging.ShortStack()
		if !strings.Contains(stack, "BuildBlockBreadcrumb") {
			if "dev" == util.Mode {
				logging.LogWarnf("block tree not found [id=%s], stack: [%s]", id, stack)
			}
		}
		return nil, ErrTreeNotFound
	}

	ret, err = loadTreeByBlockTree(bt)
	return
}

func loadTreeByBlockTree(bt *treenode.BlockTree) (ret *parse.Tree, err error) {
	luteEngine := util.NewLute()
	ret, err = filesys.LoadTree(bt.BoxID, bt.Path, luteEngine)
	return
}

var searchTreeLimiter = rate.NewLimiter(rate.Every(3*time.Second), 1)

func indexTreeInFilesystem(blockID string) error {
	if !searchTreeLimiter.Allow() {
		return ErrIndexing
	}

	msdID := util.PushMsg(Conf.language(45), 7000)
	defer util.PushClearMsg(msdID)

	logging.LogWarnf("searching tree on filesystem [id=%s]", blockID)

	unindexedTreePath := findUnindexedTreePathInAllBoxes(blockID)
	if "" == unindexedTreePath {
		logging.LogInfof("tree not found on filesystem [id=%s]", blockID)
		return ErrTreeNotFound
	}

	boxID := strings.TrimPrefix(unindexedTreePath, util.DataDir)
	boxID = boxID[1:]
	boxID = boxID[:strings.Index(boxID, string(os.PathSeparator))]
	unindexedTreePath = strings.TrimPrefix(unindexedTreePath, util.DataDir)
	unindexedTreePath = strings.TrimPrefix(unindexedTreePath, string(os.PathSeparator))
	unindexedTreePath = strings.TrimPrefix(unindexedTreePath, boxID)
	unindexedTreePath = filepath.ToSlash(unindexedTreePath)
	if nil == Conf.Box(boxID) {
		for _, b := range Conf.GetClosedBoxes() {
			if b.ID == boxID {
				logging.LogInfof("box [%s] is closed", boxID)
				util.PushErrMsg(fmt.Sprintf(Conf.language(197), b.Name), 7000)
				return ErrBoxUnindexed
			}
		}

		logging.LogInfof("box [%s] not found", boxID)
		// 如果笔记本不存在则不处理 https://github.com/siyuan-note/siyuan/issues/11149
		return ErrTreeNotFound
	}

	tree, err := filesys.LoadTree(boxID, unindexedTreePath, util.NewLute())
	if err != nil {
		logging.LogErrorf("load tree [%s] failed: %s", unindexedTreePath, err)
		return err
	}

	treenode.UpsertBlockTree(tree)
	sql.IndexTreeQueue(tree)
	logging.LogInfof("reindexed tree by filesystem [blockID=%s]", blockID)
	return nil
}

func loadParentTree(tree *parse.Tree) (ret *parse.Tree) {
	boxDir := filepath.Join(util.DataDir, tree.Box)
	parentDir := path.Dir(tree.Path)
	if parentDir == boxDir || parentDir == "/" {
		return
	}

	luteEngine := lute.New()
	parentPath := parentDir + ".sy"
	ret, _ = filesys.LoadTree(tree.Box, parentPath, luteEngine)
	return
}

func findUnindexedTreePathInAllBoxes(id string) (ret string) {
	boxes := Conf.GetBoxes()
	for _, box := range boxes {
		root := filepath.Join(util.DataDir, box.ID)
		paths := findAllOccurrences(root, id)
		var rootIDs []string
		rootIDPaths := map[string]string{}
		for _, p := range paths {
			rootID := util.GetTreeID(p)
			rootIDs = append(rootIDs, rootID)
			rootIDPaths[rootID] = p
		}

		result := treenode.ExistBlockTrees(rootIDs)
		for rootID, exist := range result {
			if !exist {
				return rootIDPaths[rootID]
			}
		}
	}
	return
}

func findAllOccurrences(root string, target string) []string {
	if root == "" || target == "" {
		return nil
	}

	searchBytes := []byte(target)
	jobs := make(chan string, 256)    // 任务通道
	results := make(chan string, 256) // 结果通道

	// 用于等待所有 Worker 完成
	var wg sync.WaitGroup
	// 用于等待结果收集器完成
	var collectWg sync.WaitGroup

	// 1. 启动结果收集协程
	var matchedPaths []string
	collectWg.Add(1)
	go func() {
		defer collectWg.Done()
		for path := range results {
			matchedPaths = append(matchedPaths, path)
		}
	}()

	// 2. 启动并发 Worker Pool (基于 CPU 核心数)
	numWorkers := runtime.NumCPU()
	for i := 0; i < numWorkers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for path := range jobs {
				if containsTarget(path, searchBytes) {
					results <- path
				}
			}
		}()
	}

	// 3. 遍历文件夹并分发任务
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err == nil && d.Type().IsRegular() {
			jobs <- path
		}
		return nil
	})

	// 4. 关闭通道并等待结束
	close(jobs)      // 停止分发任务
	wg.Wait()        // 等待所有 Worker 处理完
	close(results)   // 停止收集结果
	collectWg.Wait() // 等待切片组装完成

	return matchedPaths
}

// containsTarget 针对大文件优化的字节流匹配函数
func containsTarget(path string, target []byte) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()

	// 1MB 缓冲区
	reader := bufio.NewReaderSize(f, 1024*1024)
	for {
		// 使用 ReadSlice 实现零拷贝读取
		line, err := reader.ReadSlice('\n')
		if len(line) > 0 && bytes.Contains(line, target) {
			return true
		}
		if err != nil {
			if err == bufio.ErrBufferFull {
				// 处理超过 1MB 的超长行，直接跳过当前行剩余部分
				for err == bufio.ErrBufferFull {
					_, err = reader.ReadSlice('\n')
				}
				continue
			}
			break // EOF 或其他错误
		}
	}
	return false
}
