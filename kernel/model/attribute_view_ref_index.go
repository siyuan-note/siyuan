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

package model

import (
	"path"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func queueAttributeViewRefIndex(avID, avBoxID string) {
	if "" == avID {
		return
	}
	attrView, err := av.ParseAttributeViewInBox(avID, avBoxID)
	if nil != err || nil == attrView || av.RichTextSpec > attrView.Spec {
		return
	}
	queueAttributeViewRefCarrierIndex(avID, avBoxID)
}

// queueExternalAttributeViewRefIndex 用于同步、历史和快照直接替换 AV 文件后的引用重建。
// 这里不能按当前规范版本跳过，因为旧的富文本文件可能被纯文本文件替换，需要删除既有引用。
func queueExternalAttributeViewRefIndex(avID, avBoxID string) {
	if "" == avID || ("" != avBoxID && !IsEncryptedBox(avBoxID)) {
		return
	}
	queueAttributeViewRefCarrierIndex(avID, avBoxID)
}

func queueAttributeViewRefCarrierIndex(avID, avBoxID string) {
	for _, tree := range attributeViewRefCarrierTrees(avID, avBoxID) {
		sql.UpdateRefsTreeQueue(tree)
	}
}

func queueExternalAttributeViewRefIndexByRepoPath(repoPath string) {
	avID, avBoxID, ok := parseAttributeViewRefRepoPath(repoPath)
	if !ok {
		return
	}
	queueExternalAttributeViewRefIndex(avID, avBoxID)
}

func parseAttributeViewRefRepoPath(repoPath string) (avID, avBoxID string, ok bool) {
	repoPath = "/" + strings.TrimPrefix(path.Clean(strings.ReplaceAll(repoPath, "\\", "/")), "/")
	parts := strings.Split(strings.TrimPrefix(repoPath, "/"), "/")
	switch {
	case 3 == len(parts) && "storage" == parts[0] && "av" == parts[1]:
	case 4 == len(parts) && ast.IsNodeIDPattern(parts[0]) && "storage" == parts[1] && "av" == parts[2]:
		avBoxID = parts[0]
	default:
		return "", "", false
	}
	filename := parts[len(parts)-1]
	if ".json" != path.Ext(filename) {
		return "", "", false
	}
	avID = strings.TrimSuffix(filename, ".json")
	if !ast.IsNodeIDPattern(avID) {
		return "", "", false
	}
	return avID, avBoxID, true
}

func attributeViewRefCarrierTrees(avID, avBoxID string) (ret []*parse.Tree) {
	queuedRootIDs := map[string]bool{}
	for _, blockID := range treenode.GetMirrorAttrViewBlockIDs(avID) {
		blockTree := attributeViewCarrierBlockTree(blockID, avBoxID)
		if nil == blockTree || !sameAttributeViewRefBoundary(avBoxID, blockTree.BoxID) || queuedRootIDs[blockTree.RootID] {
			continue
		}
		tree, err := LoadTreeByBlockIDInExactBox(blockID, attributeViewRefQueryBoxID(avBoxID))
		if nil != err || nil == tree {
			continue
		}
		databaseNode := treenode.GetNodeInTree(tree, blockID)
		if nil == databaseNode || ast.NodeAttributeView != databaseNode.Type || avID != databaseNode.AttributeViewID {
			continue
		}
		queuedRootIDs[tree.ID] = true
		ret = append(ret, tree)
	}
	return
}

func attributeViewCarrierBlockTree(blockID, avBoxID string) *treenode.BlockTree {
	if "" != avBoxID && IsEncryptedBox(avBoxID) {
		return treenode.GetBlockTreeInBox(blockID, avBoxID)
	}
	return treenode.GetBlockTreeInExactBox(blockID, "")
}

func attributeViewRefQueryBoxID(avBoxID string) string {
	if "" != avBoxID && IsEncryptedBox(avBoxID) {
		return avBoxID
	}
	return ""
}

func sameAttributeViewRefBoundary(avBoxID, carrierBoxID string) bool {
	avEncrypted := "" != avBoxID && IsEncryptedBox(avBoxID)
	carrierEncrypted := "" != carrierBoxID && IsEncryptedBox(carrierBoxID)
	if !avEncrypted && !carrierEncrypted {
		return true
	}
	return avEncrypted && carrierEncrypted && avBoxID == carrierBoxID
}
