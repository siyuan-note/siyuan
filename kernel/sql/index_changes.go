// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"database/sql"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

// TreeIndexChanges 是完整事务影响集合的进程内提示；nil 表示必须重新生成全部主块投影。
// 集合须包含变更、删除和替换子树的块以及受影响容器，入队时复制且不写入恢复队列。
type TreeIndexChanges struct {
	blockIDs map[string]bool
}

func NewTreeIndexChanges(blockIDs []string) *TreeIndexChanges {
	result := &TreeIndexChanges{blockIDs: map[string]bool{}}
	for _, id := range blockIDs {
		if id != "" {
			result.blockIDs[id] = true
		}
	}
	if len(result.blockIDs) == 0 {
		return nil
	}
	return result
}

func mergeTreeIndexChanges(first, second *TreeIndexChanges) *TreeIndexChanges {
	if first == nil || second == nil {
		return nil
	}
	result := &TreeIndexChanges{blockIDs: make(map[string]bool, len(first.blockIDs)+len(second.blockIDs))}
	for id := range first.blockIDs {
		result.blockIDs[id] = true
	}
	for id := range second.blockIDs {
		result.blockIDs[id] = true
	}
	return result
}

func usableTreeIndexChanges(tx *sql.Tx, tree *parse.Tree, changes *TreeIndexChanges) (*TreeIndexChanges, error) {
	if changes == nil {
		return nil, nil
	}
	var box, path, hpath, hash, updated sql.NullString
	err := tx.QueryRow("SELECT box, path, hpath, hash, updated FROM blocks WHERE id = ? AND root_id = ? AND type = 'd'", tree.ID, tree.ID).Scan(&box, &path, &hpath, &hash, &updated)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !box.Valid || !path.Valid || !hpath.Valid || !hash.Valid || !updated.Valid ||
		box.String != tree.Box || path.String != tree.Path || hpath.String != tree.HPath {
		return nil, nil
	}
	root := *tree.Root
	root.KramdownIAL = make([][]string, len(tree.Root.KramdownIAL))
	for i, attribute := range tree.Root.KramdownIAL {
		root.KramdownIAL[i] = append([]string(nil), attribute...)
	}
	if root.IALAttr("updated") != updated.String {
		root.SetIALAttr("updated", updated.String)
	}
	if treenode.NodeHash(&root, tree, luteEngine) != hash.String {
		return nil, nil
	}
	stable := true
	treenode.WalkWithInlineTitles(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && node.Type == ast.NodeInlineHTML {
			stable = false
			return ast.WalkStop
		}
		return ast.WalkContinue
	})
	if !stable {
		return nil, nil
	}
	result := mergeTreeIndexChanges(changes, changes)
	result.blockIDs[tree.ID] = true
	return result, nil
}
