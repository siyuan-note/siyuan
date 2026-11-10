// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// A relocated restore commits only after the previous source has been removed.
// On failure, restore the target's authenticated before-image and original index
// before the caller rolls back the database mutation and releases its leases.
func writeHistoryDocument(tree *parse.Tree, workingDoc *treenode.BlockTree, removeOldDoc func(string, []byte) error, recoveries ...*attributeViewHistoryRecovery) error {
	var recovery *attributeViewHistoryRecovery
	if len(recoveries) > 0 {
		recovery = recoveries[0]
	}
	if workingDoc == nil || workingDoc.Type != "d" || workingDoc.BoxID != tree.Box || workingDoc.Path == tree.Path {
		if recovery != nil {
			return recovery.writeTree(tree, func() error {
				_, err := filesys.WriteTree(tree)
				return err
			})
		}
		_, err := filesys.WriteTree(tree)
		return err
	}
	_, originalSource, err := filesys.LoadTreeSnapshot(tree.Box, workingDoc.Path, util.NewLute())
	if err != nil {
		return err
	}
	_, before, err := filesys.LoadTreeSnapshot(tree.Box, tree.Path, util.NewLute())
	if os.IsNotExist(err) {
		before, err = nil, nil
	}
	if err != nil {
		return err
	}
	var written []byte
	err = filesys.RecordTreeWrites(tree, before, func(data []byte) error {
		written = bytes.Clone(data)
		if recovery != nil {
			return recovery.recordTree(tree, before, data)
		}
		return nil
	}, func() error {
		_, writeErr := filesys.WriteTree(tree)
		return writeErr
	})
	if err == nil {
		if recovery != nil {
			file, recordErr := recovery.remember(&documentSourceFile{Box: workingDoc.BoxID, Path: workingDoc.Path,
				Before: bytes.Clone(originalSource), After: bytes.Clone(originalSource)})
			if recordErr != nil {
				err = recordErr
			} else {
				err = recovery.record(file, originalSource, nil)
			}
		}
	}
	if err == nil {
		err = removeOldDoc(filepath.Join(util.DataDir, tree.Box, workingDoc.Path), originalSource)
	}
	if err == nil {
		return nil
	}
	var rollbackErr error
	if written != nil {
		filename := filepath.Join(util.DataDir, tree.Box, tree.Path)
		current, readErr := filelock.ReadFile(filename)
		if os.IsNotExist(readErr) {
			current, readErr = nil, nil
		}
		rollbackErr = readErr
		if readErr == nil && !bytes.Equal(current, before) {
			if before == nil {
				rollbackErr = removeIndexRepairSourceIfUnchanged(filename, written)
			} else {
				rollbackErr = util.WriteFileIfUnchanged(filename, written, before)
			}
		}
	}
	cache.RemoveTreeDataInBox(tree.ID, tree.Box)
	cache.RemoveDocIALInBox(tree.Path, tree.Box)
	if rollbackErr == nil {
		originalTree, _, readErr := filesys.LoadTreeSnapshot(tree.Box, workingDoc.Path, util.NewLute())
		rollbackErr = readErr
		if readErr == nil {
			rollbackErr = treenode.ReplaceBlockTree(originalTree)
			if rollbackErr == nil {
				rollbackErr = treenode.FinishDocumentMetadataRecovery(tree.Box, tree.ID, tree.ID != originalTree.ID && before == nil)
			}
			sql.UpsertTreeQueue(originalTree)
		}
	}
	if rollbackErr != nil {
		util.MarkIndexFixDirty()
	}
	return errors.Join(err, rollbackErr)
}
