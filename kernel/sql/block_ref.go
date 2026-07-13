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

package sql

import (
	"database/sql"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/logging"
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
	// 删除前先保留旧 refs 的 id 映射，重建时命中业务键则复用，避免每次重建刷新 id 而打乱“最近引用”排序
	refIDs := queryRefIDsByPath(tx, tree.Box, tree.Path)
	if err = deleteRefsByPath(tx, tree.Box, tree.Path); err != nil {
		return
	}
	if err = deleteFileAnnotationRefsByPath(tx, tree.Box, tree.Path); err != nil {
		return
	}
	err = insertRefs(tx, tree, refIDs)
	return
}

func deleteRefs(tx *sql.Tx, tree *parse.Tree) (err error) {
	if err = deleteRefsByPath(tx, tree.Box, tree.Path); err != nil {
		return
	}
	if err = deleteFileAnnotationRefsByPath(tx, tree.Box, tree.Path); err != nil {
		return
	}
	return
}

func insertRefs(tx *sql.Tx, tree *parse.Tree, refIDs map[string]string) (err error) {
	refs, fileAnnotationRefs := refsFromTree(tree, refIDs)
	if err = insertBlockRefs(tx, refs); err != nil {
		return
	}
	if err = insertFileAnnotationRefs(tx, fileAnnotationRefs); err != nil {
		return
	}
	return err
}

// queryRefIDsByPath 返回某篇文档现有 refs 的业务键→id 映射，用于重建时复用旧 id 以稳定“最近引用”排序。
func queryRefIDsByPath(tx *sql.Tx, box, path string) (ret map[string]string) {
	rows, err := queryTx(tx, "SELECT id, block_id, def_block_id FROM refs WHERE box = ? AND path = ?", box, path)
	if err != nil {
		logging.LogErrorf("sql query failed: %s", err)
		return
	}
	defer rows.Close()
	ret = map[string]string{}
	for rows.Next() {
		var id, blockID, defBlockID string
		if err = rows.Scan(&id, &blockID, &defBlockID); err != nil {
			logging.LogErrorf("query scan field failed: %s", err)
			return
		}
		ret[blockID+"\x00"+defBlockID] = id
	}
	return
}
