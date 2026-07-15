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
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
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

const maxRawDocumentIndexBytes = int64(256 * 1024 * 1024)

// PreparedDocumentIndex contains a validated tree which can be published to
// the index only after the corresponding staged file has been committed.
// Its fields stay private so callers cannot bypass identity validation.
type PreparedDocumentIndex struct {
	tree *parse.Tree
}

// PreparedDocumentIndexRemoval contains the exact indexed location approved
// for deletion while the raw document still exists.
type PreparedDocumentIndexRemoval struct {
	boxID        string
	rootID       string
	documentPath string
	matched      bool
}

// RawDocumentIndexBatch owns the exclusive document-identity domain and all
// root-identity stripes needed by one local sync commit.
type RawDocumentIndexBatch struct {
	identityGuard treenode.DocumentIdentitySetGuard
	unlockRoots   func()
	rootIDs       map[string]struct{}
	locations     map[string]string
	identities    map[string]string
	prepared      map[string]*PreparedRawDocumentIndexMutation
	active        atomic.Bool
	committed     atomic.Bool
}

// PreparedRawDocumentIndexMutation is validated before filesystem publication
// and committed only after the corresponding file mutation succeeds.
type PreparedRawDocumentIndexMutation struct {
	batch        *RawDocumentIndexBatch
	tree         *parse.Tree
	removal      *PreparedDocumentIndexRemoval
	documentPath string
}

// RawDocumentIndexTarget 是一个批次最终会替换或删除的文档位置。
type RawDocumentIndexTarget struct {
	BoxID        string
	DocumentPath string
}

func rawDocumentLocationKey(boxID, documentPath string) string {
	return boxID + path.Clean("/"+strings.TrimPrefix(filepath.ToSlash(documentPath), "/"))
}

func LockRawDocumentIndexBatch(targets []RawDocumentIndexTarget) (*RawDocumentIndexBatch, error) {
	unique := map[string]struct{}{}
	locations := map[string]string{}
	for _, target := range targets {
		documentPath := path.Clean("/" + strings.TrimPrefix(filepath.ToSlash(target.DocumentPath), "/"))
		rootID := util.GetTreeID(documentPath)
		if !ast.IsNodeIDPattern(target.BoxID) || !ast.IsNodeIDPattern(rootID) {
			return nil, fmt.Errorf("invalid notebook or document ID in path: %s%s", target.BoxID, documentPath)
		}
		unique[rootID] = struct{}{}
		key := rawDocumentLocationKey(target.BoxID, documentPath)
		if _, exists := locations[key]; exists {
			return nil, fmt.Errorf("duplicate document batch target: %s%s", target.BoxID, documentPath)
		}
		locations[key] = rootID
	}
	ordered := make([]string, 0, len(unique))
	for rootID := range unique {
		ordered = append(ordered, rootID)
	}
	sort.Strings(ordered)
	identityGuard := treenode.LockDocumentIdentitySet()
	batch := &RawDocumentIndexBatch{
		identityGuard: identityGuard,
		unlockRoots:   treenode.LockRootIdentities(ordered),
		rootIDs:       unique,
		locations:     locations,
		identities:    map[string]string{},
		prepared:      map[string]*PreparedRawDocumentIndexMutation{},
	}
	batch.active.Store(true)
	return batch, nil
}

func (batch *RawDocumentIndexBatch) locationPlanned(boxID, documentPath string) bool {
	_, exists := batch.locations[rawDocumentLocationKey(boxID, documentPath)]
	return exists
}

func (batch *RawDocumentIndexBatch) validateTreeIdentities(tree *parse.Tree) error {
	target := rawDocumentLocationKey(tree.Box, tree.Path)
	seen := map[string]struct{}{}
	var blockIDs []string
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !node.IsBlock() || node.ID == "" {
			return ast.WalkContinue
		}
		if _, exists := seen[node.ID]; exists {
			return ast.WalkContinue
		}
		seen[node.ID] = struct{}{}
		blockIDs = append(blockIDs, node.ID)
		return ast.WalkContinue
	})
	rootLocations, err := lookupIndexedRootLocations(tree.ID)
	if err != nil {
		return fmt.Errorf("lookup indexed root %s failed: %w", tree.ID, err)
	}
	blockLocations, err := lookupIndexedBlockLocations(blockIDs)
	if err != nil {
		return fmt.Errorf("lookup indexed document block IDs failed: %w", err)
	}
	for _, location := range append(rootLocations, blockLocations...) {
		locationKey := rawDocumentLocationKey(location.BoxID, location.Path)
		if locationKey != target && !batch.locationPlanned(location.BoxID, location.Path) {
			return fmt.Errorf("%w: block [%s] belongs to root [%s] at [%s%s], target root [%s] at [%s%s]",
				ErrIndexPathConflict, location.ID, location.RootID, location.BoxID, path.Clean(location.Path), tree.ID, tree.Box, path.Clean(tree.Path))
		}
	}
	for _, blockID := range blockIDs {
		if existing, exists := batch.identities[blockID]; exists && existing != target {
			return fmt.Errorf("%w: block [%s] is staged for both [%s] and [%s]", ErrIndexPathConflict, blockID, existing, target)
		}
		batch.identities[blockID] = target
	}
	return nil
}

func (batch *RawDocumentIndexBatch) PrepareUpsert(boxID, documentPath string, reader io.Reader, size int64) (*PreparedRawDocumentIndexMutation, error) {
	documentPath = path.Clean("/" + strings.TrimPrefix(filepath.ToSlash(documentPath), "/"))
	rootID := util.GetTreeID(documentPath)
	if err := batch.validate(rootID); err != nil {
		return nil, err
	}
	key := rawDocumentLocationKey(boxID, documentPath)
	if plannedRoot, exists := batch.locations[key]; !exists || plannedRoot != rootID {
		return nil, fmt.Errorf("document location is outside the locked batch: %s%s", boxID, documentPath)
	}
	if _, exists := batch.prepared[key]; exists {
		return nil, fmt.Errorf("document location is already prepared: %s%s", boxID, documentPath)
	}
	tree, err := filesys.LoadTreeReaderReadOnly(boxID, documentPath, reader, size, util.NewLute(), maxRawDocumentIndexBytes)
	if err != nil {
		return nil, fmt.Errorf("load staged document %s%s failed: %w", boxID, documentPath, err)
	}
	if tree == nil || tree.Root == nil || tree.Root.ID != rootID || tree.Box != boxID {
		return nil, fmt.Errorf("document root identity does not match path: %s%s", boxID, documentPath)
	}
	if err = batch.validateTreeIdentities(tree); err != nil {
		return nil, fmt.Errorf("document index identity conflict for %s%s: %w", boxID, documentPath, err)
	}
	prepared := &PreparedRawDocumentIndexMutation{batch: batch, tree: tree, documentPath: documentPath}
	batch.prepared[key] = prepared
	return prepared, nil
}

func (batch *RawDocumentIndexBatch) PrepareRemoval(boxID, documentPath string) (*PreparedRawDocumentIndexMutation, error) {
	documentPath = path.Clean("/" + strings.TrimPrefix(filepath.ToSlash(documentPath), "/"))
	rootID := util.GetTreeID(documentPath)
	if err := batch.validate(rootID); err != nil {
		return nil, err
	}
	key := rawDocumentLocationKey(boxID, documentPath)
	if plannedRoot, exists := batch.locations[key]; !exists || plannedRoot != rootID {
		return nil, fmt.Errorf("document location is outside the locked batch: %s%s", boxID, documentPath)
	}
	if _, exists := batch.prepared[key]; exists {
		return nil, fmt.Errorf("document location is already prepared: %s%s", boxID, documentPath)
	}
	locations, err := lookupIndexedRootLocations(rootID)
	if err != nil {
		return nil, fmt.Errorf("lookup indexed root %s failed: %w", rootID, err)
	}
	removal := &PreparedDocumentIndexRemoval{boxID: boxID, rootID: rootID, documentPath: documentPath}
	for _, location := range locations {
		locationKey := rawDocumentLocationKey(location.BoxID, location.Path)
		if locationKey == key {
			removal.matched = true
			continue
		}
		if !batch.locationPlanned(location.BoxID, location.Path) {
			return nil, fmt.Errorf("%w: requested [%s%s], root [%s] is also indexed at [%s%s]",
				ErrIndexPathConflict, boxID, documentPath, rootID, location.BoxID, path.Clean(location.Path))
		}
	}
	prepared := &PreparedRawDocumentIndexMutation{batch: batch, removal: removal, documentPath: documentPath}
	batch.prepared[key] = prepared
	return prepared, nil
}

// Commit 原子更新批次内的块树索引。文件发布必须在调用前全部成功。
func (batch *RawDocumentIndexBatch) Commit() error {
	if batch == nil || !batch.active.Load() || !batch.committed.CompareAndSwap(false, true) {
		return errors.New("raw document index batch cannot be committed")
	}
	if len(batch.prepared) != len(batch.locations) {
		batch.committed.Store(false)
		return fmt.Errorf("raw document index batch is incomplete: prepared=%d targets=%d", len(batch.prepared), len(batch.locations))
	}
	keys := make([]string, 0, len(batch.prepared))
	for key := range batch.prepared {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(left, right int) bool {
		leftRemoval := batch.prepared[keys[left]].removal != nil
		rightRemoval := batch.prepared[keys[right]].removal != nil
		if leftRemoval != rightRemoval {
			return leftRemoval
		}
		return keys[left] < keys[right]
	})
	mutations := make([]treenode.RawDocumentIndexMutation, 0, len(keys))
	for _, key := range keys {
		prepared := batch.prepared[key]
		if prepared.tree != nil {
			mutations = append(mutations, treenode.RawDocumentIndexMutation{Tree: prepared.tree})
			continue
		}
		removal := prepared.removal
		mutations = append(mutations, treenode.RawDocumentIndexMutation{
			BoxID: removal.boxID, RootID: removal.rootID, DocumentPath: removal.documentPath,
		})
	}
	if err := treenode.ApplyRawDocumentIndexBatchIdentityLocked(batch.identityGuard, mutations); err != nil {
		batch.committed.Store(false)
		return err
	}
	for _, key := range keys {
		prepared := batch.prepared[key]
		if prepared.tree != nil {
			queueIndexedTree(prepared.tree)
			cache.RemoveTreeData(prepared.tree.ID)
			for _, block := range getIndexedRootBlocks(prepared.tree.ID, prepared.tree.Box) {
				cache.RemoveBlockIAL(block.ID)
			}
			cache.RemoveDocIAL(prepared.tree.Path)
			continue
		}
		removal := prepared.removal
		cache.RemoveTreeData(removal.rootID)
		cache.RemoveDocIAL(removal.documentPath)
		sql.RemoveTreeQueue(removal.boxID, removal.rootID)
	}
	return nil
}

func (batch *RawDocumentIndexBatch) validate(rootID string) error {
	if batch == nil || !batch.active.Load() {
		return errors.New("raw document index batch is not active")
	}
	if _, exists := batch.rootIDs[rootID]; !exists {
		return fmt.Errorf("document root %s is outside the locked batch", rootID)
	}
	return treenode.ValidateDocumentIdentitySetGuard(batch.identityGuard)
}

func (batch *RawDocumentIndexBatch) Unlock() {
	if batch == nil || !batch.active.CompareAndSwap(true, false) {
		panic("model: invalid raw document index batch unlock")
	}
	batch.unlockRoots()
	batch.identityGuard.Unlock()
}

var (
	ErrIndexPathConflict        = errors.New("document index path does not match the indexed root location")
	ErrIndexDocumentStillExists = errors.New("document file still exists; remove the file before removing its index")
	lookupIndexedRootLocations  = treenode.LookupRootBlockTreeLocations
	lookupIndexedBlockLocations = treenode.LookupBlockTreeIdentityLocations
	replaceIndexedTree          = treenode.ReplaceBlockTreeIdentityLocked
	getIndexedRootBlocks        = treenode.GetBlockTreesByRootIDInBox
	queueIndexedTree            = sql.UpsertTreeQueue
	indexedDocumentExists       = func(boxID, documentPath string) (bool, error) {
		filePath := filepath.Join(util.DataDir, boxID, filepath.FromSlash(strings.TrimPrefix(path.Clean(documentPath), "/")))
		_, err := os.Lstat(filePath)
		if err == nil {
			return true, nil
		}
		if os.IsNotExist(err) {
			return false, nil
		}
		return false, err
	}
	removeIndexedRootLocation = func(guard treenode.DocumentIdentitySetGuard, boxID, rootID, documentPath string) error {
		if err := treenode.RemoveBlockTreesByRootPathIdentityLocked(guard, boxID, rootID, path.Clean(documentPath)); err != nil {
			return err
		}
		cache.RemoveTreeData(rootID)
		cache.RemoveDocIAL(documentPath)
		sql.RemoveTreeQueue(boxID, rootID)
		blocks := treenode.GetBlockTreesByRootIDInBox(rootID, boxID)
		for _, block := range blocks {
			if path.Clean(block.Path) == path.Clean(documentPath) {
				cache.RemoveBlockIAL(block.ID)
			}
		}
		return nil
	}
)

func validateUpsertTreeIdentity(tree *parse.Tree, rootID, boxID, documentPath string) error {
	rootLocations, err := lookupIndexedRootLocations(rootID)
	if err != nil {
		return fmt.Errorf("lookup indexed root %s failed: %w", rootID, err)
	}
	seen := map[string]struct{}{}
	var blockIDs []string
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !node.IsBlock() || node.ID == "" {
			return ast.WalkContinue
		}
		if _, exists := seen[node.ID]; !exists {
			seen[node.ID] = struct{}{}
			blockIDs = append(blockIDs, node.ID)
		}
		return ast.WalkContinue
	})
	blockLocations, err := lookupIndexedBlockLocations(blockIDs)
	if err != nil {
		return fmt.Errorf("lookup indexed document block IDs failed: %w", err)
	}
	targetPath := path.Clean(documentPath)
	for _, location := range append(rootLocations, blockLocations...) {
		if location.RootID != rootID || location.BoxID != boxID || path.Clean(location.Path) != targetPath {
			return fmt.Errorf("%w: block [%s] belongs to root [%s] at [%s%s], target root [%s] at [%s%s]",
				ErrIndexPathConflict, location.ID, location.RootID, location.BoxID, path.Clean(location.Path), rootID, boxID, targetPath)
		}
	}
	return nil
}

// PrepareDocumentIndexIdentityLocked parses a staged plaintext document and
// validates every block identity while the caller owns the exclusive raw
// publication lock. It does not mutate the current index.
func PrepareDocumentIndexIdentityLocked(guard treenode.DocumentIdentitySetGuard, boxID, documentPath string, reader io.Reader, size int64) (*PreparedDocumentIndex, error) {
	documentPath = path.Clean("/" + strings.TrimPrefix(filepath.ToSlash(documentPath), "/"))
	rootID := util.GetTreeID(documentPath)
	if !ast.IsNodeIDPattern(boxID) || !ast.IsNodeIDPattern(rootID) {
		return nil, fmt.Errorf("invalid notebook or document ID in path: %s%s", boxID, documentPath)
	}
	tree, err := filesys.LoadTreeReaderReadOnly(boxID, documentPath, reader, size, util.NewLute(), maxRawDocumentIndexBytes)
	if err != nil {
		return nil, fmt.Errorf("load staged document %s%s failed: %w", boxID, documentPath, err)
	}
	if tree == nil || tree.Root == nil || tree.Root.ID != rootID || tree.Box != boxID {
		return nil, fmt.Errorf("document root identity does not match path: %s%s", boxID, documentPath)
	}
	if err = validateUpsertTreeIdentity(tree, rootID, boxID, documentPath); err != nil {
		return nil, fmt.Errorf("document index identity conflict for %s%s: %w", boxID, documentPath, err)
	}
	// Validate the opaque token before returning a prepared mutation. The same
	// token is checked again when the mutation is committed.
	if err = treenode.ValidateDocumentIdentitySetGuard(guard); err != nil {
		return nil, err
	}
	return &PreparedDocumentIndex{tree: tree}, nil
}

// CommitPreparedDocumentIndexIdentityLocked replaces the exact document
// index after its file publication has succeeded.
func CommitPreparedDocumentIndexIdentityLocked(guard treenode.DocumentIdentitySetGuard, prepared *PreparedDocumentIndex) error {
	if prepared == nil || prepared.tree == nil {
		return errors.New("prepared document index is nil")
	}
	tree := prepared.tree
	if err := replaceIndexedTree(guard, tree); err != nil {
		return err
	}
	queueIndexedTree(tree)
	cache.RemoveTreeData(tree.ID)
	for _, block := range getIndexedRootBlocks(tree.ID, tree.Box) {
		cache.RemoveBlockIAL(block.ID)
	}
	cache.RemoveDocIAL(tree.Path)
	return nil
}

// PrepareDocumentIndexRemovalIdentityLocked validates that rootID is indexed
// only at the exact path being removed. Missing index state is an idempotent
// success and is represented by matched=false.
func PrepareDocumentIndexRemovalIdentityLocked(guard treenode.DocumentIdentitySetGuard, boxID, rootID, documentPath string) (*PreparedDocumentIndexRemoval, error) {
	if err := treenode.ValidateDocumentIdentitySetGuard(guard); err != nil {
		return nil, err
	}
	documentPath = path.Clean("/" + strings.TrimPrefix(filepath.ToSlash(documentPath), "/"))
	if !ast.IsNodeIDPattern(boxID) || !ast.IsNodeIDPattern(rootID) || util.GetTreeID(documentPath) != rootID {
		return nil, fmt.Errorf("invalid document index path: %s%s", boxID, documentPath)
	}
	locations, err := lookupIndexedRootLocations(rootID)
	if err != nil {
		return nil, fmt.Errorf("lookup indexed root %s failed: %w", rootID, err)
	}
	prepared := &PreparedDocumentIndexRemoval{boxID: boxID, rootID: rootID, documentPath: documentPath}
	for _, location := range locations {
		if location.RootID == rootID && location.BoxID == boxID && path.Clean(location.Path) == documentPath {
			prepared.matched = true
			continue
		}
		return nil, fmt.Errorf("%w: requested [%s/%s], root [%s] is also indexed at [%s%s]",
			ErrIndexPathConflict, boxID, strings.TrimPrefix(documentPath, "/"), rootID, location.BoxID, path.Clean(location.Path))
	}
	return prepared, nil
}

// CommitPreparedDocumentIndexRemovalIdentityLocked removes the exact index
// location after the corresponding file deletion has succeeded.
func CommitPreparedDocumentIndexRemovalIdentityLocked(guard treenode.DocumentIdentitySetGuard, prepared *PreparedDocumentIndexRemoval) error {
	if prepared == nil {
		return errors.New("prepared document index removal is nil")
	}
	if !prepared.matched {
		return treenode.ValidateDocumentIdentitySetGuard(guard)
	}
	return removeIndexedRootLocation(guard, prepared.boxID, prepared.rootID, prepared.documentPath)
}

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
	task.AppendTask(task.DatabaseIndexRef, removeBoxRefs, box.ID)
	task.AppendTask(task.DatabaseIndex, indexBox, box.ID)
	task.AppendTask(task.DatabaseIndexRef, IndexRefs)
	go func() {
		sql.FlushQueue()
		ResetVirtualBlockRefCache()
	}()
}

func removeBoxRefs(boxID string) {
	sql.DeleteBoxRefsQueue(boxID)
}

func indexBox(boxID string) {
	box := Conf.Box(boxID)
	if nil == box {
		return
	}

	util.SetBootDetails(Conf.Language(303))
	files := box.ListFiles("/")
	boxLen := max(1, len(Conf.GetOpenedBoxes()))
	bootProgressPart := int32(30.0 / float64(boxLen) / float64(len(files)))

	start := time.Now()
	luteEngine := util.NewLute()
	var treeCount int
	var treeSize int64
	lock := sync.Mutex{}
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
			logging.LogErrorf("read box [%s] tree [%s] failed: %s", box.ID, file.path, err)
			return
		}
		identityGuard := treenode.LockDocumentIdentityMutation()
		defer identityGuard.Unlock()

		docIAL := parse.IAL2Map(tree.Root.KramdownIAL)
		if "" == docIAL["updated"] { // 早期的数据可能没有 updated 属性，这里进行订正
			updated := util.TimeFromID(tree.Root.ID)
			tree.Root.SetIALAttr("updated", updated)
			docIAL["updated"] = updated
			if _, writeErr := filesys.WriteTreeIdentityLocked(identityGuard, tree); nil != writeErr {
				logging.LogErrorf("write tree [%s] failed: %s", tree.Path, writeErr)
			}
		}

		lock.Lock()
		avNodes = append(avNodes, tree.Root.ChildrenByType(ast.NodeAttributeView)...)
		lock.Unlock()

		cache.PutDocIALInBox(file.path, tree.Box, docIAL)
		if indexErr := treenode.IndexBlockTreeMutationLocked(identityGuard, tree); indexErr != nil {
			logging.LogErrorf("index tree [%s] failed: %s", tree.Path, indexErr)
			return
		}
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

		if !ast.IsNodeIDPattern(strings.TrimSuffix(file.name, ".sy")) {
			// 不以块 ID 命名的 .sy 文件不应该被加载到思源中 https://github.com/siyuan-note/siyuan/issues/16089
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
}

func IndexRefs() {
	start := time.Now()
	util.SetBootDetails(Conf.Language(304))
	util.PushStatusBar(Conf.Language(54))
	util.SetBootDetails(Conf.Language(305))

	var defBlockIDs []string
	defBlockBoxes := map[string]string{} // defBlockID -> boxID，加密笔记本下需按 box 路由后续加载
	luteEngine := util.NewLute()
	boxes := Conf.GetOpenedBoxes()
	for _, box := range boxes {
		encryptedBox := IsEncryptedBox(box.ID)
		pages := pagedPaths(filepath.Join(util.DataDir, box.ID), 32)
		for _, paths := range pages {
			for _, treeAbsPath := range paths {
				p := filepath.ToSlash(strings.TrimPrefix(treeAbsPath, filepath.Join(util.DataDir, box.ID)))

				// 加密笔记本的 .sy 是密文，必须走 filesys.LoadTree 透明解密；无法用 bytes.Contains 预检
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

					if !bytes.Contains(data, []byte("TextMarkBlockRefID")) && !bytes.Contains(data, []byte("TextMarkFileAnnotationRefID")) {
						continue
					}

					parseTree, parseErr := filesys.LoadTreeByData(data, box.ID, p, luteEngine)
					if nil != parseErr {
						logging.LogWarnf("parse json to tree [%s] failed: %s", treeAbsPath, parseErr)
						continue
					}
					tree = parseTree
				}

				ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
					if !entering {
						return ast.WalkContinue
					}

					if treenode.IsBlockRef(n) || treenode.IsFileAnnotationRef(n) {
						defBlockIDs = append(defBlockIDs, tree.Root.ID)
						defBlockBoxes[tree.Root.ID] = box.ID
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

	eventbus.Subscribe(eventbus.EvtSQLIndexChanged, func() {
		Conf.DataIndexState = 1
		Conf.Save()
	})

	eventbus.Subscribe(eventbus.EvtSQLIndexFlushed, func() {
		Conf.DataIndexState = 0
		Conf.Save()
	})
}
