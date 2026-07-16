// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"errors"
	"sync/atomic"

	"github.com/88250/lute"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

var documentIndexRevision atomic.Uint64

type DocumentIndexDelta struct {
	BoxID     string
	RootID    string
	Path      string
	BeforeIDs []string
	AfterIDs  []string
	Revision  uint64
}

// DocumentMutationTxn 统一持有文档文件和 BlockTree 更新所需的身份锁。
type DocumentMutationTxn struct {
	guard  treenode.DocumentIdentityMutationGuard
	closed atomic.Bool
}

func BeginDocumentMutation() *DocumentMutationTxn {
	return &DocumentMutationTxn{guard: treenode.LockDocumentIdentityMutation()}
}

func (transaction *DocumentMutationTxn) validate() error {
	if transaction == nil || transaction.closed.Load() || transaction.guard == nil {
		return errors.New("document mutation transaction is closed")
	}
	return treenode.ValidateDocumentIdentityMutationGuard(transaction.guard)
}

func (transaction *DocumentMutationTxn) LoadForUpdate(boxID, documentPath string, luteEngine *lute.Lute) (*parse.Tree, error) {
	if err := transaction.validate(); err != nil {
		return nil, err
	}
	return filesys.LoadTreeIdentityLocked(transaction.guard, boxID, documentPath, luteEngine)
}

func (transaction *DocumentMutationTxn) LoadWithFixForUpdate(boxID, documentPath string,
	luteEngine *lute.Lute) (*parse.Tree, bool, error) {
	if err := transaction.validate(); err != nil {
		return nil, false, err
	}
	return filesys.LoadTreeWithFixIdentityLocked(transaction.guard, boxID, documentPath, luteEngine)
}

func (transaction *DocumentMutationTxn) Write(tree *parse.Tree) (uint64, error) {
	if err := transaction.validate(); err != nil {
		return 0, err
	}
	return filesys.WriteTreeIdentityLocked(transaction.guard, tree)
}

func (transaction *DocumentMutationTxn) ReplaceIndex(tree *parse.Tree) (DocumentIndexDelta, error) {
	if err := transaction.validate(); err != nil {
		return DocumentIndexDelta{}, err
	}
	before := documentBlockIDs(tree.ID, tree.Box)
	if err := treenode.UpsertBlockTreeMutationLocked(transaction.guard, tree); err != nil {
		return DocumentIndexDelta{}, err
	}
	return DocumentIndexDelta{
		BoxID: tree.Box, RootID: tree.ID, Path: tree.Path, BeforeIDs: before,
		AfterIDs: documentBlockIDs(tree.ID, tree.Box), Revision: documentIndexRevision.Add(1),
	}, nil
}

func (transaction *DocumentMutationTxn) Index(tree *parse.Tree) (DocumentIndexDelta, error) {
	if err := transaction.validate(); err != nil {
		return DocumentIndexDelta{}, err
	}
	before := documentBlockIDs(tree.ID, tree.Box)
	if err := treenode.IndexBlockTreeMutationLocked(transaction.guard, tree); err != nil {
		return DocumentIndexDelta{}, err
	}
	return DocumentIndexDelta{
		BoxID: tree.Box, RootID: tree.ID, Path: tree.Path, BeforeIDs: before,
		AfterIDs: documentBlockIDs(tree.ID, tree.Box), Revision: documentIndexRevision.Add(1),
	}, nil
}

func (transaction *DocumentMutationTxn) RemoveIndex(boxID, rootID string) (DocumentIndexDelta, error) {
	if err := transaction.validate(); err != nil {
		return DocumentIndexDelta{}, err
	}
	before := documentBlockIDs(rootID, boxID)
	if err := treenode.RemoveBlockTreesByRootIDMutationLocked(transaction.guard, boxID, rootID); err != nil {
		return DocumentIndexDelta{}, err
	}
	return DocumentIndexDelta{
		BoxID: boxID, RootID: rootID, BeforeIDs: before, Revision: documentIndexRevision.Add(1),
	}, nil
}

func (transaction *DocumentMutationTxn) RemoveBlockIDs(boxID string, blockIDs []string) error {
	if err := transaction.validate(); err != nil {
		return err
	}
	return treenode.RemoveBlockTreesByIDsMutationLocked(transaction.guard, boxID, blockIDs)
}

func (transaction *DocumentMutationTxn) Commit() { transaction.close() }
func (transaction *DocumentMutationTxn) Abort()  { transaction.close() }

func (transaction *DocumentMutationTxn) close() {
	if transaction == nil || !transaction.closed.CompareAndSwap(false, true) {
		return
	}
	transaction.guard.Unlock()
	transaction.guard = nil
}

func documentBlockIDs(rootID, boxID string) []string {
	blocks := treenode.GetBlockTreesByRootIDInBox(rootID, boxID)
	ids := make([]string, 0, len(blocks))
	for _, block := range blocks {
		ids = append(ids, block.ID)
	}
	return ids
}
