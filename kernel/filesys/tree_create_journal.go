// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"fmt"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
	"os"
)

// CreateTreeWithJournal prepares the exact persisted bytes, then records recovery
// before creating a new source. The destination must remain absent.
func CreateTreeWithJournal(tree *parse.Tree, prepare func([]byte) error) (err error) {
	unlock := lockDocumentSource()
	defer unlock()
	dek, _, release, err := acquireCryptoLease(tree.Box)
	if err != nil {
		return err
	}
	defer release()
	data, filename, err := prepareWriteTree(tree)
	if err != nil {
		return err
	}
	disk, err := encryptDataWithDEK(tree.Box, tree.Path, data, dek)
	if err != nil {
		return err
	}
	if _, statErr := os.Lstat(filename); !os.IsNotExist(statErr) {
		return fmt.Errorf("document creation target already exists or is inaccessible: %s", filename)
	}
	if err = prepare(disk); err != nil {
		return err
	}
	pending, err := treenode.BeginDocumentMetadataWrite(tree)
	if err != nil {
		return err
	}
	defer finishDocumentMetadataWrite(tree, pending, &err)
	if err = util.WriteFileIfUnchanged(filename, nil, disk); err != nil {
		return err
	}
	cache.SetTreeDataInBox(tree.ID, tree.Box, data)
	afterWriteTree(tree)
	return nil
}
