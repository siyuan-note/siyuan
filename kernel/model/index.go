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
	"bytes"
	"fmt"
	"io/fs"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/88250/go-humanize"
	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/editor"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/panjf2000/ants/v2"
	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func UpsertIndexes(paths []string) {
	var syFiles []string
	for _, p := range paths {
		if strings.HasSuffix(p, "/") {
			syFiles = append(syFiles, listSyFiles(p)...)
			continue
		}

		if strings.HasSuffix(p, ".sy") {
			syFiles = append(syFiles, p)
		}
	}

	syFiles = gulu.Str.RemoveDuplicatedElem(syFiles)
	upsertIndexes(syFiles)
}

func RemoveIndexes(paths []string) {
	var syFiles []string
	for _, p := range paths {
		if strings.HasSuffix(p, "/") {
			syFiles = append(syFiles, listSyFiles(p)...)
			continue
		}

		if strings.HasSuffix(p, ".sy") {
			syFiles = append(syFiles, p)
		}
	}

	syFiles = gulu.Str.RemoveDuplicatedElem(syFiles)
	removeIndexes(syFiles)
}

func listSyFiles(dir string) (ret []string) {
	dirPath := filepath.Join(util.DataDir, dir)
	err := filelock.Walk(dirPath, func(path string, d fs.FileInfo, err error) error {
		if nil != err {
			logging.LogWarnf("walk dir [%s] failed: %s", dirPath, err)
			return err
		}

		if d.IsDir() {
			return nil
		}

		if strings.HasSuffix(path, ".sy") {
			p := filepath.ToSlash(strings.TrimPrefix(path, util.DataDir))
			ret = append(ret, p)
		}
		return nil
	})
	if nil != err {
		logging.LogWarnf("walk dir [%s] failed: %s", dirPath, err)
	}
	return
}

func (box *Box) Unindex() {
	task.AppendTask(task.DatabaseIndex, unindex, box.ID)
	go func() {
		sql.WaitForWritingDatabase()
		ResetVirtualBlockRefCache()
	}()
}

func unindex(boxID string) {
	ids := treenode.RemoveBlockTreesByBoxID(boxID)
	RemoveRecentDoc(ids)
	sql.DeleteBoxQueue(boxID)
}

func (box *Box) Index() {
	task.AppendTask(task.DatabaseIndexRef, removeBoxRefs, box.ID)
	task.AppendTask(task.DatabaseIndex, index, box.ID)
	task.AppendTask(task.DatabaseIndexRef, IndexRefs)
	go func() {
		sql.WaitForWritingDatabase()
		ResetVirtualBlockRefCache()
	}()
}

func removeBoxRefs(boxID string) {
	sql.DeleteBoxRefsQueue(boxID)
}

func index(boxID string) {
	box := Conf.Box(boxID)
	if nil == box {
		return
	}

	util.SetBootDetails("Listing files...")
	files := box.ListFiles("/")
	boxLen := len(Conf.GetOpenedBoxes())
	if 1 > boxLen {
		boxLen = 1
	}
	bootProgressPart := int32(30.0 / float64(boxLen) / float64(len(files)))

	start := time.Now()
	luteEngine := util.NewLute()
	var treeCount int
	var treeSize int64
	lock := sync.Mutex{}
	util.PushStatusBar(fmt.Sprintf("["+html.EscapeString(box.Name)+"] "+Conf.Language(64), len(files)))

	poolSize := runtime.NumCPU()
	if 4 < poolSize {
		poolSize = 4
	}
	waitGroup := &sync.WaitGroup{}
	var avNodes []*ast.Node
	p, _ := ants.NewPoolWithFunc(poolSize, func(arg interface{}) {
		defer waitGroup.Done()

		file := arg.(*FileInfo)
		lock.Lock()
		treeSize += file.size
		treeCount++
		i := treeCount
		lock.Unlock()
		tree, err := filesys.LoadTree(box.ID, file.path, luteEngine)
		if nil != err {
			logging.LogErrorf("read box [%s] tree [%s] failed: %s", box.ID, file.path, err)
			return
		}

		docIAL := parse.IAL2MapUnEsc(tree.Root.KramdownIAL)
		if "" == docIAL["updated"] { // 早期的数据可能没有 updated 属性，这里进行订正
			updated := util.TimeFromID(tree.Root.ID)
			tree.Root.SetIALAttr("updated", updated)
			docIAL["updated"] = updated
			if writeErr := filesys.WriteTree(tree); nil != writeErr {
				logging.LogErrorf("write tree [%s] failed: %s", tree.Path, writeErr)
			}
		}

		lock.Lock()
		avNodes = append(avNodes, tree.Root.ChildrenByType(ast.NodeAttributeView)...)
		lock.Unlock()

		cache.PutDocIAL(file.path, docIAL)
		treenode.IndexBlockTree(tree)
		sql.IndexTreeQueue(tree)
		util.IncBootProgress(bootProgressPart, fmt.Sprintf(Conf.Language(92), util.ShortPathForBootingDisplay(tree.Path)))
		if 1 < i && 0 == i%64 {
			util.PushStatusBar(fmt.Sprintf(Conf.Language(88), i, (len(files))-i))
		}
	})
	for _, file := range files {
		if file.isdir || !strings.HasSuffix(file.name, ".sy") {
			continue
		}

		waitGroup.Add(1)
		invokeErr := p.Invoke(file)
		if nil != invokeErr {
			logging.LogErrorf("invoke [%s] failed: %s", file.path, invokeErr)
			continue
		}
	}
	waitGroup.Wait()
	p.Release()

	// 关联数据库和块
	av.BatchUpsertBlockRel(avNodes)

	box.UpdateHistoryGenerated() // 初始化历史生成时间为当前时间
	end := time.Now()
	elapsed := end.Sub(start).Seconds()
	logging.LogInfof("rebuilt database for notebook [%s] in [%.2fs], tree [count=%d, size=%s]", box.ID, elapsed, treeCount, humanize.BytesCustomCeil(uint64(treeSize), 2))
	debug.FreeOSMemory()
	return
}

func IndexRefs() {
	start := time.Now()
	util.SetBootDetails("Resolving refs...")
	util.PushStatusBar(Conf.Language(54))
	util.SetBootDetails("Indexing refs...")

	var defBlockIDs []string
	luteEngine := util.NewLute()
	boxes := Conf.GetOpenedBoxes()
	for _, box := range boxes {
		pages := pagedPaths(filepath.Join(util.DataDir, box.ID), 32)
		for _, paths := range pages {
			for _, treeAbsPath := range paths {
				data, readErr := filelock.ReadFile(treeAbsPath)
				if nil != readErr {
					logging.LogWarnf("get data [path=%s] failed: %s", treeAbsPath, readErr)
					continue
				}

				if !bytes.Contains(data, []byte("TextMarkBlockRefID")) && !bytes.Contains(data, []byte("TextMarkFileAnnotationRefID")) {
					continue
				}

				p := filepath.ToSlash(strings.TrimPrefix(treeAbsPath, filepath.Join(util.DataDir, box.ID)))
				tree, parseErr := filesys.LoadTreeByData(data, box.ID, p, luteEngine)
				if nil != parseErr {
					logging.LogWarnf("parse json to tree [%s] failed: %s", treeAbsPath, parseErr)
					continue
				}

				ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
					if !entering {
						return ast.WalkContinue
					}

					if treenode.IsBlockRef(n) || treenode.IsFileAnnotationRef(n) {
						defBlockIDs = append(defBlockIDs, tree.Root.ID)
					}
					return ast.WalkContinue
				})
			}
		}
	}

	defBlockIDs = gulu.Str.RemoveDuplicatedElem(defBlockIDs)

	i := 0
	size := len(defBlockIDs)
	if 0 < size {
		bootProgressPart := int32(10.0 / float64(size))

		for _, defBlockID := range defBlockIDs {
			defTree, loadErr := LoadTreeByBlockID(defBlockID)
			if nil != loadErr {
				continue
			}

			util.IncBootProgress(bootProgressPart, "Indexing ref "+defTree.ID)
			sql.UpdateRefsTreeQueue(defTree)
			if 1 < i && 0 == i%64 {
				util.PushStatusBar(fmt.Sprintf(Conf.Language(55), i))
			}
			i++
		}
	}
	logging.LogInfof("resolved refs [%d] in [%dms]", size, time.Now().Sub(start).Milliseconds())
	util.PushStatusBar(fmt.Sprintf(Conf.Language(55), i))
}

var indexEmbedBlockLock = sync.Mutex{}

// IndexEmbedBlockJob 嵌入块支持搜索 https://github.com/siyuan-note/siyuan/issues/7112
func IndexEmbedBlockJob() {
	task.AppendTaskWithTimeout(task.DatabaseIndexEmbedBlock, 30*time.Second, autoIndexEmbedBlock)
}

func autoIndexEmbedBlock() {
	indexEmbedBlockLock.Lock()
	defer indexEmbedBlockLock.Unlock()

	embedBlocks := sql.QueryEmptyContentEmbedBlocks()
	for i, embedBlock := range embedBlocks {
		markdown := strings.TrimSpace(embedBlock.Markdown)
		markdown = strings.TrimPrefix(markdown, "{{")
		stmt := strings.TrimSuffix(markdown, "}}")

		// 嵌入块的 Markdown 内容需要反转义
		stmt = html.UnescapeString(stmt)
		stmt = strings.ReplaceAll(stmt, editor.IALValEscNewLine, "\n")

		// 需要移除首尾的空白字符以判断是否具有 //!js 标记
		stmt = strings.TrimSpace(stmt)
		if strings.HasPrefix(stmt, "//!js") {
			// https://github.com/siyuan-note/siyuan/issues/9648
			// js 嵌入块不支持自动索引，由前端主动调用 /api/search/updateEmbedBlock 接口更新内容 https://github.com/siyuan-note/siyuan/issues/9736
			continue
		}

		if !strings.Contains(strings.ToLower(stmt), "select") {
			continue
		}

		queryResultBlocks := sql.SelectBlocksRawStmtNoParse(stmt, 102400)
		for _, block := range queryResultBlocks {
			embedBlock.Content += block.Content
		}
		if "" == embedBlock.Content {
			embedBlock.Content = "no query result"
		}
		sql.UpdateBlockContentQueue(embedBlock)

		if 63 <= i { // 一次任务中最多处理 64 个嵌入块，防止卡顿
			break
		}
	}
}

func updateEmbedBlockContent(embedBlockID string, queryResultBlocks []*EmbedBlock) {
	embedBlock := sql.GetBlock(embedBlockID)
	if nil == embedBlock {
		return
	}

	embedBlock.Content = "" // 嵌入块每查询一次多一个结果 https://github.com/siyuan-note/siyuan/issues/7196
	for _, block := range queryResultBlocks {
		embedBlock.Content += block.Block.Markdown
	}
	if "" == embedBlock.Content {
		embedBlock.Content = "no query result"
	}
	sql.UpdateBlockContentQueue(embedBlock)
}

func init() {
	subscribeSQLEvents()
}

func subscribeSQLEvents() {
	// 使用下面的 EvtSQLInsertBlocksFTS 就可以了
	//eventbus.Subscribe(eventbus.EvtSQLInsertBlocks, func(context map[string]interface{}, current, total, blockCount int, hash string) {
	//	if util.ContainerAndroid == util.Container || util.ContainerIOS == util.Container {
	//		// Android/iOS 端不显示数据索引和搜索索引状态提示 https://github.com/siyuan-note/siyuan/issues/6392
	//		return
	//	}
	//
	//	msg := fmt.Sprintf(Conf.Language(89), current, total, blockCount, hash)
	//	util.SetBootDetails(msg)
	//	util.ContextPushMsg(context, msg)
	//})
	eventbus.Subscribe(eventbus.EvtSQLInsertBlocksFTS, func(context map[string]interface{}, blockCount int, hash string) {
		if util.ContainerAndroid == util.Container || util.ContainerIOS == util.Container {
			// Android/iOS 端不显示数据索引和搜索索引状态提示 https://github.com/siyuan-note/siyuan/issues/6392
			return
		}

		current := context["current"].(int)
		total := context["total"]
		msg := fmt.Sprintf(Conf.Language(90), current, total, blockCount, hash)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtSQLDeleteBlocks, func(context map[string]interface{}, rootID string) {
		if util.ContainerAndroid == util.Container || util.ContainerIOS == util.Container {
			return
		}

		current := context["current"].(int)
		total := context["total"]
		msg := fmt.Sprintf(Conf.Language(93), current, total, rootID)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtSQLUpdateBlocksHPaths, func(context map[string]interface{}, blockCount int, hash string) {
		if util.ContainerAndroid == util.Container || util.ContainerIOS == util.Container {
			return
		}

		current := context["current"].(int)
		total := context["total"]
		msg := fmt.Sprintf(Conf.Language(234), current, total, blockCount, hash)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})

	eventbus.Subscribe(eventbus.EvtSQLInsertHistory, func(context map[string]interface{}) {
		if util.ContainerAndroid == util.Container || util.ContainerIOS == util.Container {
			return
		}

		current := context["current"].(int)
		total := context["total"]
		msg := fmt.Sprintf(Conf.Language(191), current, total)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})

	eventbus.Subscribe(eventbus.EvtSQLInsertAssetContent, func(context map[string]interface{}) {
		if util.ContainerAndroid == util.Container || util.ContainerIOS == util.Container {
			return
		}

		current := context["current"].(int)
		total := context["total"]
		msg := fmt.Sprintf(Conf.Language(217), current, total)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})

	eventbus.Subscribe(eventbus.EvtSQLIndexChanged, func() {
		Conf.DataIndexState = 1
		Conf.Save()
	})

	eventbus.Subscribe(eventbus.EvtSQLIndexFlushed, func() {
		Conf.DataIndexState = 0
		Conf.Save()
	})
}
