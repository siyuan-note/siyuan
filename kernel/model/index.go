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
	"bytes"
	"fmt"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/88250/gulu"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/html"
	"github.com/88250/lute/parse"
	"github.com/dustin/go-humanize"
	"github.com/panjf2000/ants/v2"
	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func (box *Box) Unindex() {
	task.AppendTask(task.DatabaseIndex, unindex, box.ID)
}

func unindex(boxID string) {
	ids := treenode.RemoveBlockTreesByBoxID(boxID)
	RemoveRecentDoc(ids)
	sql.DeleteBoxQueue(boxID)
}

func (box *Box) Index() {
	task.AppendTask(task.DatabaseIndex, index, box.ID)
	task.AppendTask(task.DatabaseIndexRef, IndexRefs)
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
	bootProgressPart := 30.0 / float64(boxLen) / float64(len(files))

	start := time.Now()
	luteEngine := util.NewLute()
	var treeCount int
	var treeSize int64
	i := 0
	util.PushStatusBar(fmt.Sprintf("["+html.EscapeString(box.Name)+"] "+Conf.Language(64), len(files)))

	poolSize := runtime.NumCPU()
	if 4 < poolSize {
		poolSize = 4
	}
	waitGroup := &sync.WaitGroup{}
	p, _ := ants.NewPoolWithFunc(poolSize, func(arg interface{}) {
		defer waitGroup.Done()

		file := arg.(*FileInfo)
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

		cache.PutDocIAL(file.path, docIAL)
		treenode.IndexBlockTree(tree)
		sql.IndexTreeQueue(box.ID, file.path)

		util.IncBootProgress(bootProgressPart, fmt.Sprintf(Conf.Language(92), util.ShortPathForBootingDisplay(tree.Path)))
		treeSize += file.size
		treeCount++
		if 1 < i && 0 == i%64 {
			util.PushStatusBar(fmt.Sprintf(Conf.Language(88), i, len(files)-i))
		}
		i++
	})
	for _, file := range files {
		if file.isdir || !strings.HasSuffix(file.name, ".sy") {
			continue
		}

		waitGroup.Add(1)
		p.Invoke(file)
	}
	waitGroup.Wait()
	p.Release()

	box.UpdateHistoryGenerated() // 初始化历史生成时间为当前时间
	end := time.Now()
	elapsed := end.Sub(start).Seconds()
	logging.LogInfof("rebuilt database for notebook [%s] in [%.2fs], tree [count=%d, size=%s]", box.ID, elapsed, treeCount, humanize.Bytes(uint64(treeSize)))
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
		sql.DeleteBoxRefsQueue(box.ID)

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
		bootProgressPart := 10.0 / float64(size)

		for _, defBlockID := range defBlockIDs {
			defTree, loadErr := LoadTreeByID(defBlockID)
			if nil != loadErr {
				continue
			}

			util.IncBootProgress(bootProgressPart, "Indexing ref "+defTree.ID)
			sql.InsertRefsTreeQueue(defTree)
			if 1 < i && 0 == i%64 {
				util.PushStatusBar(fmt.Sprintf(Conf.Language(55), i))
			}
			i++
		}
	}
	logging.LogInfof("resolved refs [%d] in [%dms]", size, time.Now().Sub(start).Milliseconds())
	util.PushStatusBar(fmt.Sprintf(Conf.Language(55), i))
}

// IndexEmbedBlockJob 嵌入块支持搜索 https://github.com/siyuan-note/siyuan/issues/7112
func IndexEmbedBlockJob() {
	embedBlocks := sql.QueryEmptyContentEmbedBlocks()
	task.AppendTaskWithTimeout(task.DatabaseIndexEmbedBlock, 30*time.Second, autoIndexEmbedBlock, embedBlocks)
}

func autoIndexEmbedBlock(embedBlocks []*sql.Block) {
	for i, embedBlock := range embedBlocks {
		stmt := strings.TrimPrefix(embedBlock.Markdown, "{{")
		stmt = strings.TrimSuffix(stmt, "}}")
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
			// Android/iOS 端不显示数据索引和搜索索引状态提示 https://github.com/siyuan-note/siyuan/issues/6392
			return
		}

		current := context["current"].(int)
		total := context["total"]
		msg := fmt.Sprintf(Conf.Language(93), current, total, rootID)
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
}
