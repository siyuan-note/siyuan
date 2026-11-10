// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// createLegacyDocuments keeps path selection and source commits inside the same
// coordination boundary as identity creation. Raw source writers are checked
// again under the source-write lock immediately before each document write.
func createLegacyDocuments(boxID, hpath, content, parentID, id string, titleEmpty bool, attributes map[string]string) (string, error) {
	flushLock.Lock()
	defer flushLock.Unlock()
	for _, queued := range takeQueuedTransactions() {
		flushTx(queued)
	}
	hpathRefresh.Lock()
	defer hpathRefresh.Unlock()
	resolvedHPath, parents, err := legacyDocumentCreationParents(boxID, hpath, parentID, nil)
	if err != nil {
		return "", err
	}
	return createDocsByHPath0(boxID, resolvedHPath, content, parentID, id, titleEmpty,
		func(boxID, p, title, dom string, empty bool) (*parse.Tree, error) {
			validation, err := validateCreateDoc(boxID, p, title, empty)
			if err != nil {
				return nil, err
			}
			var attrs map[string]string
			if validation.id == id {
				attrs = attributes
			}
			tree, err := buildCreateDocTree(boxID, validation, dom, attrs)
			if err != nil {
				return nil, err
			}
			tx := &Transaction{DoOperations: []*Operation{{Action: "create", Tree: tree}}, fromAPI: true}
			tx.writeTransactionTree = func(source *parse.Tree) error {
				err := writeTreeUpsertQueueWithPreflight(source, tx.treeIndexChanges(source), func() error {
					var pending *treenode.BlockTree
					if _, statErr := os.Stat(filepath.Join(util.DataDir, boxID, tree.Path)); os.IsNotExist(statErr) {
						pending = &treenode.BlockTree{ID: tree.ID, BoxID: boxID, Path: tree.Path, HPath: tree.HPath}
					} else if statErr != nil {
						return statErr
					} else if source.ID == tree.ID {
						return fmt.Errorf("created doc path [%s] already exists", tree.Path)
					}
					currentHPath, current, err := legacyDocumentCreationParents(boxID, hpath, parentID, pending)
					if err != nil {
						return err
					}
					if currentHPath != resolvedHPath || len(current) != len(parents) {
						return documentAddressingError("indexUnavailable", treenode.ErrDocumentMetadataUnavailable)
					}
					for hp, expected := range parents {
						if actual := current[hp]; actual == nil || expected.ID != actual.ID || expected.Path != actual.Path {
							return documentAddressingError("indexUnavailable", treenode.ErrDocumentMetadataUnavailable)
						}
					}
					return nil
				})
				if err == nil && source.ID == tree.ID && source.ID != id {
					// 后续文档必须解析到本次刚提交的祖先，不能切换到并发出现的同名文档。
					parents[source.HPath] = &treenode.BlockTree{ID: source.ID, RootID: source.ID,
						BoxID: boxID, Path: source.Path, HPath: source.HPath, Type: "d"}
				}
				return err
			}
			if err = performTxSyncLocked(tx); err != nil {
				if _, statErr := os.Stat(filepath.Join(util.DataDir, boxID, p)); os.IsNotExist(statErr) {
					treenode.RemoveBlockTreesByRootID(boxID, tree.ID)
				}
			}
			return tree, err
		}, parents)
}
