// SiYuan - From thought to insight, with agents
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
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

const AttributeViewRefType = "av"

func attributeViewRefsFromNode(tree *parse.Tree, databaseNode *ast.Node) (ret []*Ref) {
	if nil == tree || nil == databaseNode || ast.NodeAttributeView != databaseNode.Type ||
		"" == databaseNode.ID || "" == databaseNode.AttributeViewID {
		return
	}

	avBoxID := attributeViewRefStorageBoxID(tree.Box)
	attrView, err := av.ParseAttributeViewInBox(databaseNode.AttributeViewID, avBoxID)
	if nil != err || nil == attrView {
		return
	}
	return attributeViewRefs(tree, databaseNode, attrView)
}

func attributeViewRefStorageBoxID(carrierBoxID string) string {
	if nil != IsEncryptedBoxFn && IsEncryptedBoxFn(carrierBoxID) {
		return carrierBoxID
	}
	return ""
}

func attributeViewRefs(tree *parse.Tree, databaseNode *ast.Node, attrView *av.AttributeView) (ret []*Ref) {
	if nil == tree || nil == databaseNode || nil == attrView {
		return
	}

	for _, keyValues := range attrView.KeyValues {
		if nil == keyValues || nil == keyValues.Key || av.KeyTypeText != keyValues.Key.Type {
			continue
		}
		for _, value := range keyValues.Values {
			if nil == value || nil == value.Text || !value.Text.IsRich() || "" == value.Text.Rich.Content {
				continue
			}
			fragmentTree, err := av.ParseValueTextRich(value.Text.Rich)
			if nil != err || nil == fragmentTree || nil == fragmentTree.Root {
				continue
			}
			ast.Walk(fragmentTree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
				if !entering || !treenode.IsBlockRef(node) {
					return ast.WalkContinue
				}
				ref := buildAttributeViewRef(tree, databaseNode, node)
				if "" != ref.DefBlockID && !isRepeatedRef(ret, ref) {
					ret = append(ret, ref)
				}
				return ast.WalkContinue
			})
		}
	}
	return
}

func buildAttributeViewRef(tree *parse.Tree, databaseNode, refNode *ast.Node) *Ref {
	tmpType := refNode.TextMarkType
	refNode.TextMarkType = "block-ref"
	markdown := treenode.ExportNodeStdMd(refNode, luteEngine)
	refNode.TextMarkType = tmpType

	defBlockID, text, _ := treenode.GetBlockRef(refNode)
	var defBlockParentID, defBlockRootID, defBlockPath string
	if defBlock := treenode.GetBlockTreeInBox(defBlockID, tree.Box); nil != defBlock {
		defBlockParentID = defBlock.ParentID
		defBlockRootID = defBlock.RootID
		defBlockPath = defBlock.Path
	}
	return &Ref{
		ID:               ast.NewNodeID(),
		DefBlockID:       defBlockID,
		DefBlockParentID: defBlockParentID,
		DefBlockRootID:   defBlockRootID,
		DefBlockPath:     defBlockPath,
		BlockID:          databaseNode.ID,
		RootID:           tree.ID,
		Box:              tree.Box,
		Path:             tree.Path,
		Content:          text,
		Markdown:         markdown,
		Type:             AttributeViewRefType,
	}
}
