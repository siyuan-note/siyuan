// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
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
	parents, err := legacyDocumentCreationParents(boxID, hpath, parentID)
	if err != nil {
		return "", err
	}
	return createDocsByHPath0(boxID, hpath, content, parentID, id, titleEmpty,
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
				return writeTreeUpsertQueueWithPreflight(source, tx.treeIndexChanges(source), func() error {
					current, err := legacyDocumentCreationParents(boxID, hpath, parentID)
					if err != nil {
						return err
					}
					for hp, expected := range parents {
						if actual := current[hp]; actual == nil || expected.ID != actual.ID || expected.Path != actual.Path {
							return documentAddressingError("indexUnavailable", treenode.ErrDocumentMetadataUnavailable)
						}
					}
					return nil
				})
			}
			if err = performTxSyncLocked(tx); err != nil {
				if _, statErr := os.Stat(filepath.Join(util.DataDir, boxID, p)); os.IsNotExist(statErr) {
					treenode.RemoveBlockTreesByRootID(boxID, tree.ID)
				}
			}
			return tree, err
		}, parents)
}
