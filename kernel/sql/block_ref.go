// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"database/sql"

	"github.com/88250/lute/parse"
)

type Ref struct {
	ID               string
	DefBlockID       string
	DefBlockParentID string
	DefBlockRootID   string
	DefBlockPath     string
	BlockID          string
	RootID           string
	Box              string
	Path             string
	Content          string
	Markdown         string
	Type             string
}

func upsertRefs(tx *sql.Tx, tree *parse.Tree) (err error) {
	removeRefCacheByPath(tree.Box, tree.Path)
	if err = deleteRefsByPath(tx, tree.Box, tree.Path); err != nil {
		return
	}
	if err = deleteFileAnnotationRefsByPath(tx, tree.Box, tree.Path); err != nil {
		return
	}
	err = insertRefs(tx, tree)
	return
}

func deleteRefs(tx *sql.Tx, tree *parse.Tree) (err error) {
	removeRefCacheByPath(tree.Box, tree.Path)
	if err = deleteRefsByPath(tx, tree.Box, tree.Path); err != nil {
		return
	}
	if err = deleteFileAnnotationRefsByPath(tx, tree.Box, tree.Path); err != nil {
		return
	}
	return
}

func insertRefs(tx *sql.Tx, tree *parse.Tree) (err error) {
	refs, fileAnnotationRefs := refsFromTree(tree)
	if err = insertBlockRefs(tx, refs); err != nil {
		return
	}
	if err = insertFileAnnotationRefs(tx, fileAnnotationRefs); err != nil {
		return
	}
	return err
}
