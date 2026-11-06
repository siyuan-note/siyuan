// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// 只记录本次原生创建写入的确切字节；不能从失败后文件反推拥有权。
// 它不是跨原生文档创建事务与 AV 事务的持久原子提交记录。
type relationCreatedDocuments struct {
	// 创建步骤和模板写入回调均在调用协程同步执行，不跨请求共享。
	files map[string]*documentSourceFile
}

func (created *relationCreatedDocuments) capture(tree *parse.Tree, data []byte) error {
	if tree == nil || len(data) == 0 {
		return errors.New("created document source is unavailable")
	}
	created.files[tree.ID] = &documentSourceFile{Box: tree.Box, Path: tree.Path, After: bytes.Clone(data)}
	return nil
}

func (created *relationCreatedDocuments) recordOwnWrite(tree *parse.Tree, write func() error) error {
	file := created.files[tree.ID]
	if file == nil {
		return errors.New("created document source ownership is unavailable")
	}
	if file.Box != tree.Box || file.Path != tree.Path {
		return fmt.Errorf("%w: created document moved", util.ErrFileChanged)
	}
	var after []byte
	err := filesys.ObserveTreeWrites(tree, file.After, func(data []byte) error { after = bytes.Clone(data); return nil }, write)
	if err == nil && after != nil {
		file.After = after
	}
	return err
}

func relationCreatedDocumentCurrentTree(id string, file *documentSourceFile) *treenode.BlockTree {
	if IsEncryptedBox(file.Box) {
		return treenode.GetBlockTreeInExactBox(id, file.Box)
	}
	// 普通笔记本之间移动后仍在普通索引中；不得跨入加密笔记本寻找同 ID 文档。
	current := treenode.GetBlockTreeInExactBox(id, "")
	if current != nil && IsEncryptedBox(current.BoxID) {
		return nil
	}
	return current
}

func (created *relationCreatedDocuments) retainedError(cause error) error {
	var retained []string
	for id, file := range created.files {
		name, err := file.filename()
		if err != nil {
			continue
		}
		if _, err = os.Stat(name); !os.IsNotExist(err) {
			retained = append(retained, id+" ["+file.Box+":"+file.Path+"]")
		} else if current := relationCreatedDocumentCurrentTree(id, file); current != nil && (current.BoxID != file.Box || current.Path != file.Path) {
			retained = append(retained, id+" ["+current.BoxID+":"+current.Path+"]")
		}
	}
	if len(retained) == 0 {
		return cause
	}
	sort.Strings(retained)
	return fmt.Errorf("created documents retained for recovery: %s: %w", strings.Join(retained, ", "), cause)
}

func (created *relationCreatedDocuments) cleanup() (err error) {
	if created == nil || len(created.files) == 0 {
		return nil
	}
	var removed []string
	defer func() {
		if err != nil {
			err = created.retainedError(err)
			util.MarkIndexFixDirty()
		}
		if len(removed) > 0 {
			event := util.NewCmdResult("removeDoc", 0, util.PushModeBroadcast)
			event.Data = map[string]any{"ids": removed}
			util.PushEvent(event)
		}
	}()
	leased := map[string]bool{}
	for _, file := range created.files {
		if leased[file.Box] {
			continue
		}
		if err = AcquireEncryptedBoxOperation(file.Box); err != nil {
			return err
		}
		leased[file.Box] = true
		defer ReleaseEncryptedBoxOperation(file.Box)
	}
	// 沿用原生文档创建的锁序，先完成已排队编辑，再判断文件及引用是否仍归本次操作所有。
	createDocLock.Lock()
	defer createDocLock.Unlock()
	flushLock.Lock()
	defer flushLock.Unlock()
	for _, queued := range takeQueuedTransactions() {
		flushTx(queued)
	}
	hpathRefresh.Lock()
	defer hpathRefresh.Unlock()
	sql.FlushQueue()
	var ids []string
	owned := map[string]bool{}
	paths := map[string]bool{}
	present := map[string]bool{}
	for id, file := range created.files {
		ids = append(ids, id)
		owned[id] = true
		name, e := file.filename()
		if e != nil {
			return e
		}
		paths[name] = true
	}
	sort.Slice(ids, func(i, j int) bool { return len(created.files[ids[i]].Path) > len(created.files[ids[j]].Path) })
	for _, id := range ids {
		file := created.files[id]
		name, _ := file.filename()
		current, readErr := os.ReadFile(name)
		if os.IsNotExist(readErr) {
			if current := relationCreatedDocumentCurrentTree(id, file); current != nil && (current.BoxID != file.Box || current.Path != file.Path) {
				return fmt.Errorf("%w: created document [%s] moved to %s:%s", util.ErrFileChanged, id, current.BoxID, current.Path)
			}
			continue
		}
		if readErr != nil {
			return readErr
		}
		present[id] = true
		if !bytes.Equal(current, file.After) {
			return fmt.Errorf("%w: %s", util.ErrFileChanged, id)
		}
		tree, snapshot, loadErr := filesys.LoadTreeSnapshot(file.Box, file.Path, util.NewLute())
		if loadErr != nil {
			return loadErr
		}
		if !bytes.Equal(snapshot, file.After) {
			return util.ErrFileChanged
		}
		bound := false
		ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if entering && node.IALAttr(av.NodeAttrNameAvs) != "" {
				bound = true
				return ast.WalkStop
			}
			return ast.WalkContinue
		})
		if bound {
			return fmt.Errorf("created document [%s] has database bindings", id)
		}
		boxID := ""
		if IsEncryptedBox(file.Box) {
			boxID = file.Box
		}
		used, queryErr := sql.HasDocumentRefsOutsideRootsInBox(id, owned, boxID)
		if queryErr != nil {
			return queryErr
		}
		if used {
			return fmt.Errorf("created document [%s] has new references", id)
		}
		children := strings.TrimSuffix(name, ".sy")
		walkErr := filepath.WalkDir(children, func(path string, entry os.DirEntry, e error) error {
			if os.IsNotExist(e) {
				return nil
			}
			if e != nil {
				return e
			}
			if !entry.IsDir() && filepath.Ext(path) == ".sy" && !paths[path] {
				return fmt.Errorf("created document [%s] has a new child", id)
			}
			return nil
		})
		if walkErr != nil {
			return walkErr
		}
	}
	for _, id := range ids {
		if !present[id] {
			continue
		}
		file := created.files[id]
		if err = restoreDocumentSource(file); err != nil {
			return err
		}
		removed = append(removed, id)
		cache.RemoveTreeDataInBox(id, file.Box)
		cache.RemoveDocIALInBox(file.Path, file.Box)
		treenode.RemoveBlockTreesByRootID(file.Box, id)
		sql.RemoveTreeQueue(file.Box, id)
		name, _ := file.filename()
		_ = os.Remove(strings.TrimSuffix(name, ".sy")) // 只删除空目录，保留任何并发内容。
		if box := Conf.Box(file.Box); box != nil {
			box.removeSort([]string{id})
		}
	}
	IncSync()
	return nil
}
