// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"context"
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

// databaseIndexDataLock 用于避免索引任务读取正在被替换或删除的笔记本目录。
var databaseIndexDataLock sync.Mutex

const indexBatchDocuments = 32
const indexBatchBytes int64 = 8 * 1024 * 1024

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
	err := filelock.Walk(dirPath, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
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
	if err != nil {
		logging.LogWarnf("walk dir [%s] failed: %s", dirPath, err)
	}
	return
}

func (box *Box) Unindex() {
	task.AppendTask(task.DatabaseIndex, unindex, box.ID)
	go func() {
		sql.FlushQueue()
		ResetVirtualBlockRefCache()
	}()
}

func unindex(boxID string) {
	treenode.RemoveBlockTreesByBoxID(boxID)
	sql.DeleteBoxQueue(boxID)
}

func (box *Box) Index() {
	// 排队时即撤销就绪状态，避免创建请求在后台重建开始前通过检查。
	if err := treenode.SetDocumentMetadataState(box.ID, "building"); err != nil {
		logging.LogErrorf("prepare queued document metadata [%s] failed: %s", box.ID, err)
		return
	}
	task.AppendTask(task.DatabaseIndexRef, removeBoxRefs, box.ID)
	task.AppendTask(task.DatabaseIndex, indexBox, box.ID)
	task.AppendTask(task.DatabaseIndexRef, IndexRefs)
	go func() {
		sql.FlushQueue()
		ResetVirtualBlockRefCache()
	}()
}

func removeBoxRefs(boxID string) {
	if IsEncryptedBox(boxID) {
		if err := AcquireEncryptedBoxOperation(boxID); err != nil {
			return
		}
		defer ReleaseEncryptedBoxOperation(boxID)
	}
	sql.DeleteBoxRefsQueue(boxID)
}

func indexBox(boxID string) {
	encrypted := IsEncryptedBox(boxID)
	if encrypted {
		if err := AcquireEncryptedBoxOperation(boxID); err != nil {
			logging.LogWarnf("skip indexing encrypted notebook [%s]: %s", boxID, err)
			return
		}
		defer ReleaseEncryptedBoxOperation(boxID)
		if !isEncryptedBoxMounted(boxID) {
			return
		}
	}

	databaseIndexDataLock.Lock()
	defer databaseIndexDataLock.Unlock()

	box := Conf.Box(boxID)
	if nil == box {
		return
	}
	if err := treenode.SetDocumentMetadataState(boxID, "building"); err != nil {
		logging.LogErrorf("prepare document metadata [%s] failed: %s", boxID, err)
		return
	}
	metadataReady := false
	defer func() {
		if !metadataReady {
			_ = treenode.SetDocumentMetadataState(boxID, "error")
		}
	}()
	// 全量索引使用纯 INSERT，开始前必须清理该笔记本的旧数据，避免重复任务叠加相同行。
	sql.DeleteBoxQueue(boxID)
	recoveringSources := hasDocumentSourceRecovery(boxID)

	util.SetBootDetails(Conf.Language(303))
	files, scanErr := box.listFilesForIndex("/")
	if scanErr != nil {
		logging.LogErrorf("enumerate notebook [%s] failed: %s", boxID, scanErr)
		return
	}
	boxLen := max(1, len(Conf.GetOpenedBoxes()))
	bootProgressPart := int32(30.0 / float64(boxLen) / float64(len(files)))

	start := time.Now()
	luteEngine := util.NewLute()
	var treeCount int
	var treeSize int64
	lock := sync.Mutex{}
	var sourceFailed bool
	util.PushStatusBar(fmt.Sprintf("["+html.EscapeString(box.Name)+"] "+Conf.Language(64), len(files)))

	poolSize := min(runtime.NumCPU(), 4)
	waitGroup := &sync.WaitGroup{}
	var avNodes []*ast.Node
	p, _ := ants.NewPoolWithFunc(poolSize, func(arg any) {
		defer waitGroup.Done()

		file := arg.(*FileInfo)
		lock.Lock()
		treeSize += file.size
		treeCount++
		i := treeCount
		lock.Unlock()
		tree, err := filesys.LoadTree(box.ID, file.path, luteEngine)
		if err != nil {
			lock.Lock()
			sourceFailed = true
			lock.Unlock()
			logging.LogErrorf("read box [%s] tree [%s] failed: %s", box.ID, file.path, err)
			return
		}

		docIAL := parse.IAL2Map(tree.Root.KramdownIAL)
		if "" == docIAL["updated"] { // 早期的数据可能没有 updated 属性，这里进行订正
			updated := util.TimeFromID(tree.Root.ID)
			tree.Root.SetIALAttr("updated", updated)
			docIAL["updated"] = updated
			if _, writeErr := filesys.WriteTree(tree); nil != writeErr {
				logging.LogErrorf("write tree [%s] failed: %s", tree.Path, writeErr)
				lock.Lock()
				sourceFailed = true
				lock.Unlock()
				return
			}
		}

		lock.Lock()
		for _, node := range tree.Root.ChildrenByType(ast.NodeAttributeView) {
			// 关联镜像只需要节点标识，避免父节点和兄弟节点引用把整篇文档保留到重建结束。
			avNodes = append(avNodes, &ast.Node{Type: ast.NodeAttributeView, ID: node.ID, AttributeViewID: node.AttributeViewID})
		}
		lock.Unlock()

		cache.PutDocIALInBox(file.path, tree.Box, docIAL)
		if recoveringSources {
			for _, block := range treenode.GetBlockTreesByRootIDInBox(tree.ID, tree.Box) {
				cache.RemoveBlockIALInBox(block.ID, tree.Box)
			}
			if err := treenode.ReplaceBlockTree(tree); err != nil {
				lock.Lock()
				sourceFailed = true
				lock.Unlock()
				logging.LogErrorf("rebuild recovered block identities [%s]: %s", tree.ID, err)
				return
			}
		} else {
			treenode.IndexBlockTree(tree)
		}
		sql.IndexTreeQueue(tree)
		util.IncBootProgress(bootProgressPart, fmt.Sprintf(Conf.Language(92), util.ShortPathForBootingDisplay(tree.Path)))
		if 1 < i && 0 == i%64 {
			util.PushStatusBar(fmt.Sprintf(Conf.Language(88), i, (len(files))-i))
		}
	})
	defer p.Release()
	var batchDocuments int
	var batchBytes int64
	flushBatch := func() {
		waitGroup.Wait()
		sql.FlushQueue()
		batchDocuments, batchBytes = 0, 0
		debug.FreeOSMemory()
	}
	for _, file := range files {
		if util.IsExiting.Load() {
			waitGroup.Wait()
			return
		}
		if file.isdir || !strings.HasSuffix(file.name, ".sy") {
			continue
		}

		if !ast.IsNodeIDPattern(strings.TrimSuffix(file.name, ".sy")) {
			// 不以块 ID 命名的 .sy 文件不应该被加载到思源中 https://github.com/siyuan-note/siyuan/issues/16089
			continue
		}
		// 同时限制文档数量和源文件体积；单篇大文档独立处理，避免与其他文档叠加峰值。
		if batchDocuments > 0 && (batchDocuments >= indexBatchDocuments || batchBytes+file.size > indexBatchBytes) {
			flushBatch()
		}

		waitGroup.Add(1)
		invokeErr := p.Invoke(file)
		if nil != invokeErr {
			waitGroup.Done()
			lock.Lock()
			sourceFailed = true
			lock.Unlock()
			logging.LogErrorf("invoke [%s] failed: %s", file.path, invokeErr)
			continue
		}
		batchDocuments++
		batchBytes += file.size
	}
	flushBatch()
	if !sourceFailed {
		if recoveringSources {
			paths := make([]string, 0, len(files))
			for _, file := range files {
				paths = append(paths, file.path)
			}
			treenode.ClearRedundantBlockTrees(boxID, paths)
		}
		pending, pendingErr := treenode.PendingDocumentMetadata(boxID)
		for _, doc := range pending {
			if pendingErr = filesys.RecoverDocumentMetadataWrite(doc); pendingErr != nil {
				break
			}
		}
		if pendingErr != nil {
			logging.LogErrorf("recover document metadata [%s] failed: %s", boxID, pendingErr)
		} else if err := treenode.SetDocumentMetadataState(boxID, "ready"); err != nil {
			logging.LogErrorf("complete document metadata [%s] failed: %s", boxID, err)
		} else {
			metadataReady = true
		}
	}

	// 关联数据库和块
	av.BatchUpsertBlockRel(avNodes)
	if metadataReady {
		if err := finishDocumentSourceRecovery(box.ID); err != nil {
			logging.LogErrorf("complete document source recovery [%s] failed: %s", box.ID, err)
		}
	}

	box.UpdateHistoryGenerated() // 初始化历史生成时间为当前时间
	end := time.Now()
	elapsed := end.Sub(start).Seconds()
	logging.LogInfof("rebuilt database for notebook [%s] in [%.2fs], tree [count=%d, size=%s]", box.ID, elapsed, treeCount, humanize.BytesCustomCeil(uint64(treeSize), 2))
	debug.FreeOSMemory()
}

func IndexRefs() {
	boxes := Conf.GetOpenedBoxes()
	boxIDs := make([]string, 0, len(boxes))
	for _, box := range boxes {
		boxIDs = append(boxIDs, box.ID)
	}
	release, err := AcquireEncryptedBoxOperations(context.Background(), boxIDs)
	if err != nil {
		logging.LogWarnf("skip resolving references while an encrypted notebook is unavailable: %s", err)
		return
	}
	defer release()

	databaseIndexDataLock.Lock()
	defer databaseIndexDataLock.Unlock()

	start := time.Now()
	util.SetBootDetails(Conf.Language(304))
	util.PushStatusBar(Conf.Language(54))
	util.SetBootDetails(Conf.Language(305))

	var defBlockIDs []string
	defBlockBoxes := map[string]string{} // defBlockID -> boxID，加密笔记本下需按 box 路由后续加载
	luteEngine := util.NewLute()
	for _, box := range boxes {
		encryptedBox := IsEncryptedBox(box.ID)
		pages := pagedPaths(filepath.Join(util.DataDir, box.ID), 32)
		for _, paths := range pages {
			for _, treeAbsPath := range paths {
				p := filepath.ToSlash(strings.TrimPrefix(treeAbsPath, filepath.Join(util.DataDir, box.ID)))

				// Encrypted documents must be authenticated by filesys.LoadTree.
				var tree *parse.Tree
				if encryptedBox {
					loadTree, loadErr := filesys.LoadTree(box.ID, p, luteEngine)
					if nil != loadErr {
						logging.LogWarnf("load encrypted box [%s] tree [%s] failed: %s", box.ID, treeAbsPath, loadErr)
						continue
					}
					tree = loadTree
				} else {
					data, readErr := filelock.ReadFile(treeAbsPath)
					if nil != readErr {
						logging.LogWarnf("get data [path=%s] failed: %s", treeAbsPath, readErr)
						continue
					}

					parseTree, parseErr := filesys.LoadTreeByData(data, box.ID, p, luteEngine)
					if nil != parseErr {
						logging.LogWarnf("parse json to tree [%s] failed: %s", treeAbsPath, parseErr)
						continue
					}
					tree = parseTree
				}

				if sql.TreeHasRefs(tree) {
					defBlockIDs = append(defBlockIDs, tree.Root.ID)
					defBlockBoxes[tree.Root.ID] = box.ID
				}
			}
		}
	}

	defBlockIDs = gulu.Str.RemoveDuplicatedElem(defBlockIDs)

	i := 0
	size := len(defBlockIDs)
	if 0 < size {
		bootProgressPart := int32(10.0 / float64(size))

		for _, defBlockID := range defBlockIDs {
			// 加密笔记本的 defBlock 在加密 blocktree db，需按 box 路由加载
			var defTree *parse.Tree
			var loadErr error
			if boxID, ok := defBlockBoxes[defBlockID]; ok && IsEncryptedBox(boxID) {
				defTree, loadErr = loadTreeByBlockIDInBox(defBlockID, boxID)
			} else {
				defTree, loadErr = LoadTreeByBlockID(defBlockID)
			}
			if nil != loadErr {
				continue
			}

			util.IncBootProgress(bootProgressPart, fmt.Sprintf(Conf.Language(306), defTree.ID))
			sql.UpdateRefsTreeQueue(defTree)
			if 1 < i && 0 == i%64 {
				util.PushStatusBar(fmt.Sprintf(Conf.Language(55), i))
			}
			i++
		}
	}
	logging.LogInfof("resolved refs [%d] in [%dms]", size, time.Since(start).Milliseconds())
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
	for _, boxID := range treenode.GetOpenedEncryptedBoxIDs() {
		embedBlocks = append(embedBlocks, sql.QueryEmptyContentEmbedBlocksInBox(boxID)...)
	}
	for i, embedBlock := range embedBlocks {
		content, supported := sql.CalculateEmbedBlockContent(embedBlock)
		if !supported {
			continue
		}
		embedBlock.Content = content
		sql.UpdateBlockContentQueue(embedBlock)

		if 63 <= i { // 一次任务中最多处理 64 个嵌入块，防止卡顿
			break
		}
	}
}

func updateEmbedBlockContent(embedBlockID string, queryResultBlocks []*EmbedBlock, boxIDs ...string) {
	boxID := ""
	if len(boxIDs) > 0 {
		boxID = boxIDs[0]
	}
	embedBlock := sql.GetBlockInBox(embedBlockID, boxID)
	if nil == embedBlock {
		return
	}

	content := "" // 嵌入块每查询一次多一个结果 https://github.com/siyuan-note/siyuan/issues/7196
	for _, block := range queryResultBlocks {
		content += block.Block.Markdown
	}
	if "" == content {
		content = "no query result"
	}
	if embedBlock.Content == content {
		return
	}
	embedBlock.Content = content
	sql.UpdateBlockContentQueue(embedBlock)
}

func init() {
	subscribeSQLEvents()
}

var (
	pushSQLInsertBlocksFTSMsg bool
	pushSQLDeleteBlocksMsg    bool
)

func subscribeSQLEvents() {
	// 使用下面的 EvtSQLInsertBlocksFTS 就可以了
	//eventbus.Subscribe(eventbus.EvtSQLInsertBlocks, func(context map[string]any, current, total, blockCount int, hash string) {
	//
	//	msg := fmt.Sprintf(Conf.Language(89), current, total, blockCount, hash)
	//	util.SetBootDetails(msg)
	//	util.ContextPushMsg(context, msg)
	//})
	eventbus.Subscribe(eventbus.EvtSQLInsertBlocksFTS, func(context map[string]any, blockCount int, hash string) {
		if !pushSQLInsertBlocksFTSMsg {
			return
		}

		if nil == context["current"] || nil == context["total"] {
			logging.LogWarnf("EvtSQLInsertBlocksFTS handler missing key [current] or [total] in context")
			return
		}
		current := context["current"].(int)
		total := context["total"]
		msg := fmt.Sprintf(Conf.Language(90), current, total, blockCount, hash)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtSQLDeleteBlocks, func(context map[string]any, rootID string) {
		if !pushSQLDeleteBlocksMsg {
			return
		}

		if nil == context["current"] || nil == context["total"] {
			logging.LogWarnf("EvtSQLDeleteBlocks handler missing key [current] or [total] in context")
			return
		}
		current := context["current"].(int)
		total := context["total"]
		msg := fmt.Sprintf(Conf.Language(93), current, total, rootID)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})
	eventbus.Subscribe(eventbus.EvtSQLUpdateBlocksHPaths, func(context map[string]any, blockCount int, hash string) {
		if util.IsMobileContainer() {
			return
		}

		if nil == context["current"] || nil == context["total"] {
			logging.LogWarnf("EvtSQLUpdateBlocksHPaths handler missing key [current] or [total] in context")
			return
		}
		current := context["current"].(int)
		total := context["total"]
		msg := fmt.Sprintf(Conf.Language(234), current, total, blockCount, hash)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})

	eventbus.Subscribe(eventbus.EvtSQLInsertHistory, func(context map[string]any) {
		if util.IsMobileContainer() {
			return
		}

		if nil == context["current"] || nil == context["total"] {
			logging.LogWarnf("EvtSQLInsertHistory handler missing key [current] or [total] in context")
			return
		}
		current := context["current"].(int)
		total := context["total"]
		msg := fmt.Sprintf(Conf.Language(191), current, total)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})

	eventbus.Subscribe(eventbus.EvtSQLInsertAssetContent, func(context map[string]any) {
		if util.IsMobileContainer() {
			return
		}

		if nil == context["current"] || nil == context["total"] {
			logging.LogWarnf("EvtSQLInsertAssetContent handler missing key [current] or [total] in context")
			return
		}
		current := context["current"].(int)
		total := context["total"]
		msg := fmt.Sprintf(Conf.Language(217), current, total)
		util.SetBootDetails(msg)
		util.ContextPushMsg(context, msg)
	})

	// 持久化索引队列负责崩溃恢复，状态事件只更新供查询使用的运行时标志。
	eventbus.Subscribe(eventbus.EvtSQLIndexChanged, func() {
		Conf.m.Lock()
		Conf.DataIndexState = 1
		Conf.m.Unlock()
	})

	eventbus.Subscribe(eventbus.EvtSQLIndexFlushed, func() {
		Conf.m.Lock()
		Conf.DataIndexState = 0
		Conf.m.Unlock()
	})
}
