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
const maxRawDocumentDerivedIndexes = 100_000

type rawDocumentIndexRemoval struct {
	boxID        string
	rootID       string
	documentPath string
	matched      bool
}

// RawDocumentIndexBatch 在一次本地同步提交期间独占文档身份域。
type RawDocumentIndexBatch struct {
	identityGuard treenode.DocumentIdentitySetGuard
	rootIDs       map[string]struct{}
	locations     map[string]string
	identities    map[string]string
	prepared      map[string]*PreparedRawDocumentIndexMutation
	derived       map[string]*parse.Tree
	active        atomic.Bool
	committed     atomic.Bool
}

// PreparedRawDocumentIndexMutation is validated before filesystem publication
// and committed only after the corresponding file mutation succeeds.
type PreparedRawDocumentIndexMutation struct {
	batch        *RawDocumentIndexBatch
	tree         *parse.Tree
	blockIDs     []string
	removal      *rawDocumentIndexRemoval
	documentPath string
}

type documentIndexProjection struct {
	delta   DocumentIndexDelta
	tree    *parse.Tree
	removed bool
}

func applyDocumentIndexProjections(projections []documentIndexProjection) {
	invalidBlockIDs := map[string]struct{}{}
	for _, projection := range projections {
		for _, blockID := range projection.delta.BeforeIDs {
			invalidBlockIDs[blockID] = struct{}{}
		}
		for _, blockID := range projection.delta.AfterIDs {
			invalidBlockIDs[blockID] = struct{}{}
		}
		cache.RemoveTreeData(projection.delta.RootID)
		cache.RemoveDocIAL(projection.delta.Path)
		if projection.removed {
			sql.RemoveTreeQueue(projection.delta.BoxID, projection.delta.RootID)
		} else if projection.tree != nil {
			queueIndexedTree(projection.tree)
		}
	}
	for blockID := range invalidBlockIDs {
		removeCachedBlockIAL(blockID)
	}
}

func rawBatchBlockIDs(rootID, boxID string) []string {
	blocks := getIndexedRootBlocks(rootID, boxID)
	ids := make([]string, 0, len(blocks))
	for _, block := range blocks {
		ids = append(ids, block.ID)
	}
	return ids
}

// PrepareHPathProjection 在 identity 锁外计算 HPath 和后代投影，随后重新加锁并复验身份冲突。
func (batch *RawDocumentIndexBatch) PrepareHPathProjection(titles map[string]string) error {
	if batch == nil || batch.identityGuard == nil || !batch.active.Load() || batch.committed.Load() {
		return errors.New("raw document index batch cannot prepare hpath projection")
	}
	batch.identityGuard.Unlock()
	batch.identityGuard = nil
	projectionErr := batch.refreshPreparedHPaths(titles)
	batch.identityGuard = treenode.LockDocumentIdentitySet()
	if projectionErr != nil {
		return projectionErr
	}
	return batch.revalidatePreparedIdentities()
}

func (batch *RawDocumentIndexBatch) refreshPreparedHPaths(titles map[string]string) error {
	if batch == nil || !batch.active.Load() || batch.committed.Load() {
		return errors.New("raw document index batch cannot refresh hpaths")
	}
	keys := make([]string, 0, len(batch.prepared))
	for key := range batch.prepared {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	luteEngine := util.NewLute()
	affectedPrefixes := map[string]RawDocumentIndexTarget{}
	for _, key := range keys {
		prepared := batch.prepared[key]
		if prepared.tree == nil {
			if prepared.removal != nil && prepared.removal.matched {
				affectedPrefixes[key] = RawDocumentIndexTarget{
					BoxID: prepared.removal.boxID, DocumentPath: prepared.removal.documentPath,
				}
			}
			continue
		}
		tree := prepared.tree
		if err := filesys.RefreshTreeHPathWithOverlay(tree, luteEngine, titles); err != nil {
			return fmt.Errorf("refresh document hpath %s%s failed: %w", tree.Box, tree.Path, err)
		}
		locations, err := lookupIndexedRootLocations(tree.ID)
		if err != nil {
			return fmt.Errorf("lookup previous document hpath %s failed: %w", tree.ID, err)
		}
		for _, location := range locations {
			if rawDocumentLocationKey(location.BoxID, location.Path) == key && location.HPath != tree.HPath {
				affectedPrefixes[key] = RawDocumentIndexTarget{BoxID: tree.Box, DocumentPath: tree.Path}
				break
			}
		}
	}
	if len(affectedPrefixes) == 0 {
		return nil
	}
	if batch.derived == nil {
		batch.derived = map[string]*parse.Tree{}
	}
	candidates := map[string]*treenode.BlockTree{}
	for _, target := range affectedPrefixes {
		prefix := strings.TrimSuffix(path.Clean(target.DocumentPath), ".sy") + "/"
		for _, block := range getIndexedPathBlocks(target.BoxID, prefix) {
			candidateKey := rawDocumentLocationKey(block.BoxID, block.Path)
			if batch.locationPlanned(block.BoxID, block.Path) {
				continue
			}
			if _, exists := candidates[candidateKey]; !exists {
				candidates[candidateKey] = block
			}
		}
	}
	if len(candidates) > maxRawDocumentDerivedIndexes {
		return fmt.Errorf("derived document index limit exceeded: %d", len(candidates))
	}
	derivedKeys := make([]string, 0, len(candidates))
	for key := range candidates {
		derivedKeys = append(derivedKeys, key)
	}
	sort.Strings(derivedKeys)
	for _, key := range derivedKeys {
		block := candidates[key]
		tree, err := filesys.LoadTreeReadOnly(block.BoxID, block.Path, luteEngine, maxRawDocumentIndexBytes)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return fmt.Errorf("refresh descendant document hpath %s%s failed: %w", block.BoxID, block.Path, err)
		}
		if err = filesys.RefreshTreeHPathWithOverlay(tree, luteEngine, titles); err != nil {
			return fmt.Errorf("refresh descendant document hpath %s%s failed: %w", block.BoxID, block.Path, err)
		}
		batch.derived[key] = tree
	}
	return nil
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
	identityGuard := treenode.LockDocumentIdentitySet()
	batch := &RawDocumentIndexBatch{
		identityGuard: identityGuard,
		rootIDs:       unique,
		locations:     locations,
		identities:    map[string]string{},
		prepared:      map[string]*PreparedRawDocumentIndexMutation{},
		derived:       map[string]*parse.Tree{},
	}
	batch.active.Store(true)
	return batch, nil
}

func (batch *RawDocumentIndexBatch) locationPlanned(boxID, documentPath string) bool {
	_, exists := batch.locations[rawDocumentLocationKey(boxID, documentPath)]
	return exists
}

func (batch *RawDocumentIndexBatch) validateTreeIdentities(tree *parse.Tree, blockIDs []string) error {
	target := rawDocumentLocationKey(tree.Box, tree.Path)
	if len(blockIDs) == 0 {
		seen := map[string]struct{}{}
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
	}
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
	document, err := filesys.ValidateDocument(reader, size, rootID, maxRawDocumentIndexBytes)
	if err != nil {
		return nil, fmt.Errorf("load staged document %s%s failed: %w", boxID, documentPath, err)
	}
	return batch.PrepareUpsertValidated(boxID, documentPath, document)
}

func (batch *RawDocumentIndexBatch) PrepareUpsertValidated(boxID, documentPath string, document *filesys.ValidatedDocument) (*PreparedRawDocumentIndexMutation, error) {
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
	tree, err := document.BindTree(boxID, documentPath, util.NewLute(), false)
	if err != nil {
		return nil, fmt.Errorf("bind staged document %s%s failed: %w", boxID, documentPath, err)
	}
	if tree == nil || tree.Root == nil || tree.Root.ID != rootID || tree.Box != boxID {
		return nil, fmt.Errorf("document root identity does not match path: %s%s", boxID, documentPath)
	}
	if err = batch.validateTreeIdentities(tree, document.BlockIDs); err != nil {
		return nil, fmt.Errorf("document index identity conflict for %s%s: %w", boxID, documentPath, err)
	}
	prepared := &PreparedRawDocumentIndexMutation{
		batch: batch, tree: tree, blockIDs: append([]string(nil), document.BlockIDs...), documentPath: documentPath,
	}
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
	removal := &rawDocumentIndexRemoval{boxID: boxID, rootID: rootID, documentPath: documentPath}
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

func (batch *RawDocumentIndexBatch) revalidatePreparedIdentities() error {
	if err := treenode.ValidateDocumentIdentitySetGuard(batch.identityGuard); err != nil {
		return err
	}
	batch.identities = map[string]string{}
	keys := make([]string, 0, len(batch.prepared))
	for key := range batch.prepared {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		prepared := batch.prepared[key]
		if prepared.tree != nil {
			if err := batch.validateTreeIdentities(prepared.tree, prepared.blockIDs); err != nil {
				return err
			}
			continue
		}
		removal := prepared.removal
		locations, err := lookupIndexedRootLocations(removal.rootID)
		if err != nil {
			return err
		}
		removal.matched = false
		for _, location := range locations {
			locationKey := rawDocumentLocationKey(location.BoxID, location.Path)
			if locationKey == key {
				removal.matched = true
				continue
			}
			if !batch.locationPlanned(location.BoxID, location.Path) {
				return fmt.Errorf("%w: root [%s] is also indexed at [%s%s]",
					ErrIndexPathConflict, removal.rootID, location.BoxID, path.Clean(location.Path))
			}
		}
	}
	derivedKeys := make([]string, 0, len(batch.derived))
	for key := range batch.derived {
		derivedKeys = append(derivedKeys, key)
	}
	sort.Strings(derivedKeys)
	for _, key := range derivedKeys {
		if err := batch.validateTreeIdentities(batch.derived[key], nil); err != nil {
			return err
		}
	}
	return nil
}

// Commit 原子更新批次内的块树索引。文件发布必须在调用前全部成功。
func (batch *RawDocumentIndexBatch) Commit() ([]DocumentIndexDelta, error) {
	if batch == nil || !batch.active.Load() || !batch.committed.CompareAndSwap(false, true) {
		return nil, errors.New("raw document index batch cannot be committed")
	}
	if len(batch.prepared) != len(batch.locations) {
		batch.committed.Store(false)
		return nil, fmt.Errorf("raw document index batch is incomplete: prepared=%d targets=%d", len(batch.prepared), len(batch.locations))
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
	beforeIDs := map[string][]string{}
	for _, key := range keys {
		prepared := batch.prepared[key]
		if prepared.tree != nil {
			for _, block := range getIndexedRootBlocks(prepared.tree.ID, prepared.tree.Box) {
				beforeIDs[key] = append(beforeIDs[key], block.ID)
			}
			mutations = append(mutations, treenode.RawDocumentIndexMutation{Tree: prepared.tree})
			continue
		}
		removal := prepared.removal
		for _, block := range getIndexedRootBlocks(removal.rootID, removal.boxID) {
			beforeIDs[key] = append(beforeIDs[key], block.ID)
		}
		mutations = append(mutations, treenode.RawDocumentIndexMutation{
			BoxID: removal.boxID, RootID: removal.rootID, DocumentPath: removal.documentPath,
		})
	}
	derivedKeys := make([]string, 0, len(batch.derived))
	for key := range batch.derived {
		derivedKeys = append(derivedKeys, key)
	}
	sort.Strings(derivedKeys)
	for _, key := range derivedKeys {
		tree := batch.derived[key]
		for _, block := range getIndexedRootBlocks(tree.ID, tree.Box) {
			beforeIDs[key] = append(beforeIDs[key], block.ID)
		}
		mutations = append(mutations, treenode.RawDocumentIndexMutation{Tree: tree})
	}
	if err := applyRawDocumentIndexBatch(batch.identityGuard, mutations); err != nil {
		batch.committed.Store(false)
		return nil, err
	}
	deltas := make([]DocumentIndexDelta, 0, len(keys)+len(derivedKeys))
	projections := make([]documentIndexProjection, 0, len(keys)+len(derivedKeys))
	for _, key := range keys {
		prepared := batch.prepared[key]
		if prepared.tree != nil {
			delta := DocumentIndexDelta{
				BoxID: prepared.tree.Box, RootID: prepared.tree.ID, Path: prepared.tree.Path,
				BeforeIDs: beforeIDs[key], AfterIDs: rawBatchBlockIDs(prepared.tree.ID, prepared.tree.Box),
				Revision: documentIndexRevision.Add(1),
			}
			deltas = append(deltas, delta)
			projections = append(projections, documentIndexProjection{delta: delta, tree: prepared.tree})
			continue
		}
		removal := prepared.removal
		delta := DocumentIndexDelta{
			BoxID: removal.boxID, RootID: removal.rootID, Path: removal.documentPath,
			BeforeIDs: beforeIDs[key], Revision: documentIndexRevision.Add(1),
		}
		deltas = append(deltas, delta)
		projections = append(projections, documentIndexProjection{delta: delta, removed: true})
	}
	for _, key := range derivedKeys {
		tree := batch.derived[key]
		delta := DocumentIndexDelta{
			BoxID: tree.Box, RootID: tree.ID, Path: tree.Path, BeforeIDs: beforeIDs[key],
			AfterIDs: rawBatchBlockIDs(tree.ID, tree.Box), Revision: documentIndexRevision.Add(1),
		}
		deltas = append(deltas, delta)
		projections = append(projections, documentIndexProjection{delta: delta, tree: tree})
	}
	applyDocumentIndexProjections(projections)
	return deltas, nil
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
	batch.identityGuard.Unlock()
}

var (
	ErrIndexPathConflict        = errors.New("document index path does not match the indexed root location")
	lookupIndexedRootLocations  = treenode.LookupRootBlockTreeLocations
	lookupIndexedBlockLocations = treenode.LookupBlockTreeIdentityLocations
	getIndexedRootBlocks        = treenode.GetBlockTreesByRootIDInBox
	getIndexedPathBlocks        = treenode.GetBlockTreesByPathPrefix
	applyRawDocumentIndexBatch  = treenode.ApplyRawDocumentIndexBatchIdentityLocked
	removeCachedBlockIAL        = cache.RemoveBlockIAL
	queueIndexedTree            = sql.UpsertTreeQueue
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
		documentTxn := BeginDocumentMutation()
		defer documentTxn.Abort()
		tree, err := documentTxn.LoadForUpdate(box.ID, file.path, luteEngine)
		if err != nil {
			logging.LogErrorf("read box [%s] tree [%s] failed: %s", box.ID, file.path, err)
			return
		}

		docIAL := parse.IAL2Map(tree.Root.KramdownIAL)
		if "" == docIAL["updated"] { // 早期的数据可能没有 updated 属性，这里进行订正
			updated := util.TimeFromID(tree.Root.ID)
			tree.Root.SetIALAttr("updated", updated)
			docIAL["updated"] = updated
			if _, writeErr := documentTxn.Write(tree); nil != writeErr {
				logging.LogErrorf("write tree [%s] failed: %s", tree.Path, writeErr)
			}
		}

		lock.Lock()
		avNodes = append(avNodes, tree.Root.ChildrenByType(ast.NodeAttributeView)...)
		lock.Unlock()

		cache.PutDocIALInBox(file.path, tree.Box, docIAL)
		if _, indexErr := documentTxn.Index(tree); indexErr != nil {
			logging.LogErrorf("index tree [%s] failed: %s", tree.Path, indexErr)
			return
		}
		documentTxn.Commit()
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
