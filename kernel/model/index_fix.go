// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"errors"
	"fmt"
	"io/fs"
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
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/task"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var (
	checkIndexOnce = sync.Once{}

	// fixIndexMu 保证 checkIndex 与 AutoFixIndex 互斥，不会并发跑同一套订正。
	fixIndexMu sync.Mutex
	// lastFixedAt 记录上次订正完成时间，用于 AutoFixIndex 的冷却期判断。
	lastFixedAt time.Time
)

const (
	// idleFixThreshold 为用户空闲超过该阈值后才允许触发空闲订正。
	idleFixThreshold = 7 * time.Minute
	// fixCooldown 为上次订正后至少间隔该时长才允许下一次空闲订正。
	fixCooldown = 120 * time.Minute
)

// checkIndex 自动校验数据库索引，仅在数据同步执行完成后执行一次。
// Index fixing should not be performed before data synchronization https://github.com/siyuan-note/siyuan/issues/10761
func checkIndex() {
	checkIndexOnce.Do(func() {
		if util.IsMobileContainer() {
			// 移动端不执行校验 https://ld246.com/article/1734939896061
			return
		}

		// 阻塞式获取锁：若 AutoFixIndex 正在跑则等其完成，确保唯一一次校验不会与之并发
		fixIndexMu.Lock()
		defer fixIndexMu.Unlock()

		runFixIndexPipeline()
	})
}

// runFixIndexPipeline 执行索引订正流水线并完成收尾（清除脏标志、记录订正时间）。
// 调用方需持有 fixIndexMu。
func runFixIndexPipeline() {
	if err := completeIndexRepair(fixIndexPipeline); err != nil {
		logging.LogErrorf("index repair incomplete: %s", err)
	}
}

func completeIndexRepair(repair func() error) (err error) {
	version := util.IndexFixVersion()
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("index repair panicked: %v", recovered)
		}
		if err != nil {
			util.MarkIndexFixDirty()
			lastFixedAt = time.Time{}
		}
	}()
	if err = repair(); err != nil {
		return err
	}
	if util.MarkIndexClean(version) {
		lastFixedAt = time.Now()
	} else {
		lastFixedAt = time.Time{}
	}
	return nil
}

// fixIndexPipeline 执行索引订正流水线。
// 由 checkIndex（同步后一次性）与 AutoFixIndex（空闲触发）共用，调用方负责加 fixIndexMu 互斥锁。
func fixIndexPipeline() error {
	logging.LogInfof("start fixing index...")

	removeDuplicateDatabaseIndex()
	sql.FlushQueue()

	if err := resetDuplicateBlocksOnFileSys(); err != nil {
		return err
	}
	sql.FlushQueue()

	if err := fixBlockTreeByFileSys(); err != nil {
		return err
	}
	sql.FlushQueue()

	if err := fixDatabaseIndexByBlockTree(); err != nil {
		return err
	}
	sql.FlushQueue()

	removeDuplicateDatabaseRefs()
	if util.IsExiting.Load() {
		return errors.New("index repair interrupted by shutdown")
	}

	// 后面要加任务的话记得修改推送任务栏的进度 util.PushStatusBar(fmt.Sprintf(Conf.Language(58), 1, 5))

	debug.FreeOSMemory()
	util.PushStatusBar(Conf.Language(185))
	logging.LogInfof("finish fixing index")
	return nil
}

// AutoFixIndex 在用户空闲且存在未订正变更时，自动订正索引。由 cron 每分钟调用。
// 触发需同时满足：空闲达 idleFixThreshold、存在未订正变更（dirty）、冷却期已过。
func AutoFixIndex() {
	defer logging.Recover()

	if util.IsMobileContainer() {
		return
	}
	if !util.IsIdle(idleFixThreshold) {
		return
	}
	if !util.IsIndexFixDirty() {
		return
	}
	// TryLock 非阻塞：若 checkIndex 正在跑或上次还没跑完，直接跳过，不堆积 goroutine
	if !fixIndexMu.TryLock() {
		return
	}
	defer fixIndexMu.Unlock()
	if !lastFixedAt.IsZero() && time.Since(lastFixedAt) < fixCooldown {
		return
	}

	// double-check：拿到锁后再确认一次确实空闲，避免在等待锁期间用户又开始操作
	if !util.IsIdle(idleFixThreshold) {
		return
	}

	logging.LogInfof("start auto fixing index on idle...")
	runFixIndexPipeline()
	logging.LogInfof("finish auto fixing index on idle")
}

// removeDuplicateDatabaseRefs 删除重复的数据库引用关系。
func removeDuplicateDatabaseRefs() {

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

	util.PushStatusBar(fmt.Sprintf(Conf.Language(58), 1, 5))
	duplicatedRootIDs := sql.GetDuplicatedRootIDs("blocks")
	if 1 > len(duplicatedRootIDs) {
		duplicatedRootIDs = sql.GetDuplicatedRootIDs("blocks_fts")
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
func resetDuplicateBlocksOnFileSys() error {
	return resetDuplicateBlocksOnFileSysBeforeWrite(nil)
}

func resetDuplicateBlocksOnFileSysBeforeWrite(beforeWrite func(*parse.Tree)) error {
	util.PushStatusBar(fmt.Sprintf(Conf.Language(58), 2, 5))
	boxes := Conf.GetBoxes()
	luteEngine := lute.New()
	blockIDs := map[string]bool{}
	needRefreshUI := false
	for _, box := range boxes {
		if util.IsExiting.Load() {
			return errors.New("index repair interrupted by shutdown")
		}
		// 关闭的加密笔记本无法解密 .sy，跳过（避免密文被当损坏移走）
		if IsEncryptedBox(box.ID) && !IsBoxUnlocked(box.ID) {
			continue
		}
		boundary := ""
		if IsEncryptedBox(box.ID) {
			boundary = box.ID
		}
		// 校验索引阶段自动删除历史遗留的笔记本 history 文件夹
		legacyHistory := filepath.Join(util.DataDir, box.ID, ".siyuan", "history")
		if gulu.File.IsDir(legacyHistory) {
			if removeErr := os.RemoveAll(legacyHistory); nil != removeErr {
				logging.LogErrorf("remove legacy history failed: %s", removeErr)
				return removeErr
			} else {
				logging.LogInfof("removed legacy history [%s]", legacyHistory)
			}
		}

		boxPath := filepath.Join(util.DataDir, box.ID)
		type repairSnapshot struct {
			tree     *parse.Tree
			original []byte
		}
		var duplicatedTrees []repairSnapshot
		if walkErr := filelock.Walk(boxPath, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if nil == d {
				return nil
			}

			if d.IsDir() {
				if boxPath == path {
					// 跳过笔记本文件夹
					return nil
				}

				if strings.HasPrefix(d.Name(), ".") {
					return filepath.SkipDir
				}

				if !ast.IsNodeIDPattern(d.Name()) {
					return nil
				}
				return nil
			}

			if filepath.Ext(path) != ".sy" || strings.Contains(filepath.ToSlash(path), "/assets/") {
				return nil
			}

			if !ast.IsNodeIDPattern(strings.TrimSuffix(d.Name(), ".sy")) {
				logging.LogWarnf("invalid .sy file name [%s]", path)
				box.moveCorruptedData(path)
				if _, err := os.Stat(path); !os.IsNotExist(err) {
					return fmt.Errorf("quarantine invalid document [%s] failed", path)
				}
				return nil
			}

			p := path[len(boxPath):]
			p = filepath.ToSlash(p)
			FlushTxQueue()
			flushLock.Lock()
			defer flushLock.Unlock()
			tree, original, needOverwrite, loadErr := filesys.LoadTreeSnapshotWithFix(box.ID, p, luteEngine)
			if nil != loadErr {
				logging.LogErrorf("load tree [%s] failed: %s", p, loadErr)
				return loadErr
			}
			duplicateRoot := false

			ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
				if !entering || !n.IsBlock() {
					return ast.WalkContinue
				}

				if "" == n.ID {
					needOverwrite = true
					treenode.ResetNodeID(n)
					blockIDs[boundary+"/"+n.ID] = true
					return ast.WalkContinue
				}

				if !blockIDs[boundary+"/"+n.ID] {
					blockIDs[boundary+"/"+n.ID] = true
					return ast.WalkContinue
				}

				// 存在重复的块 ID

				if ast.NodeDocument == n.Type {
					// 如果是文档根节点，则重置这颗树
					// 这里不能在迭代中重置，因为如果这个文档存在子文档的话，重置时会重命名子文档文件夹，后续迭代可能会导致子文档 ID 重复
					duplicatedTrees = append(duplicatedTrees, repairSnapshot{tree, original})
					duplicateRoot = true
					return ast.WalkStop
				}

				// 其他情况，重置节点 ID
				needOverwrite = true
				oldID := n.ID
				treenode.ResetNodeID(n)
				blockIDs[boundary+"/"+n.ID] = true
				// A tab's selected child has an explicit structural owner, unlike global block references.
				if n.Type == ast.NodeTabItem && n.Parent != nil && n.Parent.IALAttr(treenode.TabsActiveIDAttr) == oldID {
					count := 0
					for child := n.Parent.FirstChild; child != nil; child = child.Next {
						if child == n || child.ID == oldID {
							count++
						}
					}
					if count == 1 {
						n.Parent.SetIALAttr(treenode.TabsActiveIDAttr, n.ID)
					}
				}
				logging.LogWarnf("duplicate block ID repaired [%s%s]: [%s] -> [%s]; ambiguous references, database bindings and flashcard records retain their original IDs for manual review", tree.Box, tree.Path, oldID, n.ID)
				needRefreshUI = true
				return ast.WalkContinue
			})

			if needOverwrite && !duplicateRoot {
				if beforeWrite != nil {
					beforeWrite(tree)
				}
				logging.LogWarnf("exist more than one node with the same id in tree [%s], reset it", box.ID+p)
				if err := saveIndexRepairHistory(tree, original); err != nil {
					return err
				}
				if _, writeErr := filesys.WriteTreeIfUnchanged(tree, original); nil != writeErr {
					logging.LogErrorf("write tree [%s] failed: %s", p, writeErr)
					return writeErr
				}
			}
			if !duplicateRoot && (needOverwrite || !indexRepairIdentitiesMatch(tree)) {
				var mirrors []*ast.Node
				ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
					if entering && node.Type == ast.NodeAttributeView {
						mirrors = append(mirrors, node)
					}
					return ast.WalkContinue
				})
				if err := av.AddCopiedBlockRels(boundary, mirrors); err != nil {
					return err
				}
				// Queue recovery before publishing the new block identities. If interrupted before
				// this point, the next scan still sees the source/index mismatch, even at equal timestamps.
				sql.UpsertTreeQueue(tree)
				if err := treenode.ReplaceBlockTree(tree); err != nil {
					return err
				}
			}
			return nil
		}); walkErr != nil {
			return walkErr
		}

		for _, snapshot := range duplicatedTrees {
			tree := snapshot.tree
			absPath := filepath.Join(boxPath, tree.Path)
			logging.LogWarnf("exist more than one tree with the same id [%s], reset it", absPath)
			if err := recreateTree(tree, absPath, snapshot.original); err != nil {
				return err
			}
			needRefreshUI = true
		}
	}

	if needRefreshUI {
		util.ReloadUI()
		task.AppendAsyncTaskWithDelay(task.PushMsg, 3*time.Second, util.PushMsg, Conf.Language(190), 5000)
	}
	return nil
}

func indexRepairIdentitiesMatch(tree *parse.Tree) bool {
	indexed := treenode.GetBlockTreesByRootIDInBox(tree.ID, tree.Box)
	nodes := map[string]*ast.Node{}
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && node.IsBlock() && node.ID != "" {
			nodes[node.ID] = node
		}
		return ast.WalkContinue
	})
	if len(indexed) != len(nodes) {
		return false
	}
	for _, block := range indexed {
		node := nodes[block.ID]
		if node == nil || block.BoxID != tree.Box || block.Path != tree.Path || block.Type != treenode.TypeAbbr(node.Type.String()) {
			return false
		}
		if node.Parent != nil && block.ParentID != node.Parent.ID {
			return false
		}
	}
	return true
}

// Keep the exact source bytes, including existing encryption, before changing identities.
func saveIndexRepairHistory(tree *parse.Tree, original []byte) error {
	if util.HistoryDir == "" {
		return errors.New("document repair history directory is unavailable")
	}
	if err := os.MkdirAll(util.HistoryDir, 0700); err != nil {
		return err
	}
	stamp := time.Now()
	for attempt := 0; attempt < 1000; attempt++ {
		dir := filepath.Join(util.HistoryDir, stamp.Add(time.Duration(attempt)*time.Second).Format("2006-01-02-150405")+"-"+HistoryOpFormat)
		filename := filepath.Join(dir, tree.Box, tree.Path)
		if err := os.MkdirAll(filepath.Dir(filename), 0700); err != nil {
			return err
		}
		file, err := os.OpenFile(filename, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if os.IsExist(err) {
			continue
		}
		if err != nil {
			return err
		}
		_, writeErr := file.Write(original)
		if writeErr == nil {
			writeErr = file.Sync()
		}
		err = errors.Join(writeErr, file.Close())
		if err == nil {
			generateAvHistoryInTree(tree, dir)
		}
		return err
	}
	return errors.New("document repair history names exhausted")
}

func recreateTree(tree *parse.Tree, absPath string, original []byte) error {
	return recreateTreeWithSteps(tree, absPath, original, nil)
}

func recreateTreeWithSteps(tree *parse.Tree, absPath string, original []byte, step func(string) error) (err error) {
	FlushTxQueue()
	flushLock.Lock()
	defer flushLock.Unlock()
	current, err := filelock.ReadFile(absPath)
	if err != nil {
		return err
	}
	if !bytes.Equal(current, original) {
		return fmt.Errorf("%w: %s", util.ErrFileChanged, absPath)
	}
	prepared, snapshot, err := filesys.LoadTreeSnapshot(tree.Box, tree.Path, util.NewLute())
	if err != nil {
		return err
	}
	if !bytes.Equal(snapshot, original) {
		return util.ErrFileChanged
	}
	if err = saveIndexRepairHistory(tree, original); err != nil {
		return err
	}
	oldPath := tree.Path
	resetTreeData(prepared, "", true)
	j := &documentSourceJournal{Version: 1, ID: ast.NewNodeID(), State: "pending", Files: []*documentSourceFile{
		{Box: tree.Box, Path: oldPath, Before: original},
		{Box: tree.Box, Path: prepared.Path},
	}}
	from := strings.TrimSuffix(absPath, ".sy")
	to := filepath.Join(filepath.Dir(absPath), prepared.ID)
	if info, statErr := os.Lstat(from); statErr == nil {
		if !info.IsDir() {
			return errors.New("invalid document child directory")
		}
		j.Move = &documentSourceMove{Box: tree.Box, From: strings.TrimSuffix(oldPath, ".sy"), To: strings.TrimSuffix(prepared.Path, ".sy")}
	} else if !os.IsNotExist(statErr) {
		return statErr
	}
	if _, statErr := os.Lstat(to); !os.IsNotExist(statErr) {
		return errors.New("document repair destination directory already exists or is inaccessible")
	}
	committed, recorded := false, false
	defer func() {
		if !committed && recorded {
			if rollbackErr := j.rollback(); rollbackErr != nil {
				err = errors.Join(err, rollbackErr)
				return
			}
			cache.RemoveTreeDataInBox(prepared.ID, prepared.Box)
			cache.RemoveDocIALInBox(prepared.Path, prepared.Box)
			treenode.RemoveBlockTreesByRootID(prepared.Box, prepared.ID)
			if removeErr := os.Remove(j.filename()); removeErr != nil {
				err = errors.Join(err, removeErr)
			}
		}
	}()
	checkpoint := func(stage string) error {
		if step != nil {
			return step(stage)
		}
		return nil
	}
	err = filesys.CreateTreeWithJournal(prepared, func(data []byte) error {
		j.Files[1].After = data
		if saveErr := j.save(); saveErr != nil {
			return saveErr
		}
		recorded = true
		return checkpoint("prepared")
	})
	if err != nil {
		return err
	}
	if err = checkpoint("created"); err != nil {
		return err
	}
	if j.Move != nil {
		if err = os.Rename(from, to); err != nil {
			return err
		}
	}
	if err = checkpoint("children-moved"); err != nil {
		return err
	}
	if err = removeIndexRepairSourceIfUnchanged(absPath, original); err != nil {
		return err
	}
	if err = checkpoint("source-removed"); err != nil {
		return err
	}
	j.State = "committed"
	if err = j.save(); err != nil {
		j.State = "pending"
		return err
	}
	committed = true
	*tree = *prepared
	// Publish derived state only after the complete filesystem operation commits.
	// A surviving committed record forces authenticated reindexing on the next mount.
	sql.RemoveTreePathQueue(tree.Box, strings.TrimSuffix(oldPath, ".sy"))
	treenode.RemoveBlockTreesByPathPrefix(tree.Box, strings.TrimSuffix(oldPath, ".sy"))
	paths, err := duplicateDocTreePaths(tree.Box, tree.Path)
	if err != nil {
		return err
	}
	err = filesys.WalkTreeSnapshots(tree.Box, paths, func(current *parse.Tree) error {
		boundary := ""
		if IsEncryptedBox(current.Box) {
			boundary = current.Box
		}
		if err := av.AddCopiedBlockRels(boundary, current.Root.ChildrenByType(ast.NodeAttributeView)); err != nil {
			return err
		}
		sql.UpsertTreeQueue(current)
		return treenode.ReplaceBlockTree(current)
	})
	if err == nil {
		err = os.Remove(j.filename())
	}
	return err
}

func removeIndexRepairSourceIfUnchanged(absPath string, original []byte) error {
	filelock.Lock(absPath)
	defer filelock.Unlock(absPath)
	current, err := os.ReadFile(absPath)
	if err != nil {
		return err
	}
	if !bytes.Equal(current, original) {
		return fmt.Errorf("%w: %s", util.ErrFileChanged, absPath)
	}
	return os.Remove(absPath)
}

// fixBlockTreeByFileSys 通过文件系统订正块树。
func fixBlockTreeByFileSys() error {

	util.PushStatusBar(fmt.Sprintf(Conf.Language(58), 3, 5))
	boxes := Conf.GetOpenedBoxes()
	luteEngine := lute.New()
	for _, box := range boxes {
		boxPath := filepath.Join(util.DataDir, box.ID)
		var paths []string
		if walkErr := filelock.Walk(boxPath, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if nil == d {
				return nil
			}

			if boxPath == path {
				// 跳过根路径（笔记本文件夹）
				return nil
			}

			if d.IsDir() {
				if strings.HasPrefix(d.Name(), ".") {
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
		}); walkErr != nil {
			return walkErr
		}

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

			if err := reindexTreeByPath(box.ID, p, i, size, luteEngine); err != nil {
				return err
			}
			if util.IsExiting.Load() {
				break
			}
		}

		if util.IsExiting.Load() {
			return errors.New("index repair interrupted by shutdown")
		}
	}

	// 清理已关闭的笔记本块树
	boxes = Conf.GetClosedBoxes()
	for _, box := range boxes {
		if IsEncryptedBox(box.ID) && !IsBoxUnlocked(box.ID) {
			continue
		}
		treenode.RemoveBlockTreesByBoxID(box.ID)
	}
	return nil
}

// fixDatabaseIndexByBlockTree 通过块树订正数据库索引。
func fixDatabaseIndexByBlockTree() error {

	util.PushStatusBar(fmt.Sprintf(Conf.Language(58), 4, 5))
	rootUpdatedMap := treenode.GetRootUpdated()
	dbRootUpdatedMap, err := sql.GetRootUpdated()
	if err != nil {
		return err
	}
	return reindexTreeByUpdated(rootUpdatedMap, dbRootUpdatedMap)
}

func reindexTreeByUpdated(rootUpdatedMap, dbRootUpdatedMap map[string]string) error {
	i := -1
	size := len(rootUpdatedMap)
	luteEngine := util.NewLute()
	for rootID, updated := range rootUpdatedMap {
		i++

		if util.IsExiting.Load() {
			return errors.New("index repair interrupted by shutdown")
		}

		rootUpdated := dbRootUpdatedMap[rootID]
		if "" == rootUpdated {
			//logging.LogWarnf("not found tree [%s] in database, reindex it", rootID)
			if err := reindexTree(rootID, i, size, luteEngine); err != nil {
				return err
			}
			continue
		}

		if "" == updated {
			// BlockTree 迁移，v2.6.3 之前没有 updated 字段
			if err := reindexTree(rootID, i, size, luteEngine); err != nil {
				return err
			}
			continue
		}

		btUpdated, _ := time.Parse("20060102150405", updated)
		dbUpdated, _ := time.Parse("20060102150405", rootUpdated)
		if dbUpdated.Before(btUpdated.Add(-10 * time.Minute)) {
			logging.LogWarnf("tree [%s] is not up to date, reindex it", rootID)
			if err := reindexTree(rootID, i, size, luteEngine); err != nil {
				return err
			}
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
	if util.IsExiting.Load() {
		return errors.New("index repair interrupted by shutdown")
	}
	return nil
}

func reindexTreeByPath(box, p string, i, size int, luteEngine *lute.Lute) error {
	tree, err := filesys.LoadTree(box, p, luteEngine)
	if err != nil {
		return err
	}

	return reindexTree0(tree, i, size)
}

func reindexTree(rootID string, i, size int, luteEngine *lute.Lute) error {
	root := treenode.GetBlockTree(rootID)
	if nil == root {
		logging.LogWarnf("root block [%s] not found", rootID)
		return fmt.Errorf("root block [%s] not found", rootID)
	}

	tree, err := filesys.LoadTree(root.BoxID, root.Path, luteEngine)
	if err != nil {
		if os.IsNotExist(err) {
			// 文件系统上没有找到该 .sy 文件，则订正块树
			treenode.RemoveBlockTreesByRootID(root.BoxID, rootID)
			return nil
		}
		return err
	}

	return reindexTree0(tree, i, size)
}

func reindexTree0(tree *parse.Tree, i, size int) error {
	updated := tree.Root.IALAttr("updated")
	if "" == updated {
		updated = util.TimeFromID(tree.Root.ID)
		tree.Root.SetIALAttr("updated", updated)
		if err := writeTreeUpsertQueue(tree); err != nil {
			logging.LogErrorf("repair document timestamp [%s] failed: %s", tree.ID, err)
			util.PushErrMsg(Conf.Language(258), 7000)
			return err
		}
		treenode.UpsertBlockTree(tree)
	} else {
		treenode.UpsertBlockTree(tree)
		sql.IndexTreeQueue(tree)
	}

	if 0 == i%64 {
		util.PushStatusBar(fmt.Sprintf(Conf.Language(183), i, size, html.EscapeString(treenode.ReadDocumentTitle(tree.Root).Text)))
	}
	return nil
}
