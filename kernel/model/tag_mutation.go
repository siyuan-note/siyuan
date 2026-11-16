// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func tagMutationNode(id string, before, after map[string]*parse.Tree, sources map[string][]byte) (*ast.Node, error) {
	bt := treenode.GetBlockTree(id)
	if bt == nil {
		return nil, nil
	}
	if IsEncryptedBox(bt.BoxID) {
		return nil, fmt.Errorf("tags are unavailable in encrypted notebooks")
	}
	if before[bt.RootID] == nil {
		var err error
		before[bt.RootID], sources[bt.RootID], err = filesys.LoadTreeSnapshot(bt.BoxID, bt.Path, util.NewLute())
		if err != nil {
			return nil, err
		}
		var projectedSource []byte
		after[bt.RootID], projectedSource, err = filesys.LoadTreeSnapshot(bt.BoxID, bt.Path, util.NewLute())
		if err != nil {
			return nil, err
		}
		if !bytes.Equal(sources[bt.RootID], projectedSource) {
			return nil, util.ErrFileChanged
		}
	}
	return treenode.GetNodeInTree(after[bt.RootID], id), nil
}

func (tx *Transaction) appendTagMutationOperations(before, after map[string]*parse.Tree, changed map[string]bool) {
	engine := util.NewLute()
	rootIDs := make([]string, 0, len(after))
	for rootID := range after {
		rootIDs = append(rootIDs, rootID)
	}
	sort.Strings(rootIDs)
	for _, rootID := range rootIDs {
		ast.Walk(after[rootID].Root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if !entering || !changed[node.ID] {
				return ast.WalkContinue
			}
			old := treenode.GetNodeInTree(before[rootID], node.ID)
			if node.Type == ast.NodeDocument {
				if node.IALAttr("tags") == old.IALAttr("tags") {
					return ast.WalkContinue
				}
				data, _ := json.Marshal(map[string]string{"tags": node.IALAttr("tags")})
				undo, _ := json.Marshal(map[string]string{"tags": old.IALAttr("tags")})
				tx.DoOperations = append(tx.DoOperations, &Operation{Action: "setAttrs", ID: node.ID, Data: string(data)})
				tx.UndoOperations = append(tx.UndoOperations, &Operation{Action: "setAttrs", ID: node.ID, Data: string(undo)})
				return ast.WalkContinue
			}
			data, undo := engine.RenderNodeBlockDOM(node), engine.RenderNodeBlockDOM(old)
			if data == undo {
				return ast.WalkContinue
			}
			tx.DoOperations = append(tx.DoOperations, &Operation{Action: "update", ID: node.ID, Data: data})
			tx.UndoOperations = append(tx.UndoOperations, &Operation{Action: "update", ID: node.ID, Data: undo})
			return ast.WalkSkipChildren
		})
	}
}
