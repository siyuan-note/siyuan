// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// currentDocumentIndexSnapshot 为排队中的索引取得当前标题源与摘要，只复制根，不修改编辑树。
// 此副本仅用于派生索引，不能作为源文档保存，避免旧正文与新标题源混合回写。
func currentDocumentIndexSnapshot(source *parse.Tree) (*parse.Tree, error) {
	tree := *source
	tree.HPath = treenode.CurrentTreeHPath(&tree)
	meta, err := treenode.GetDocumentMetadata(tree.Box, tree.ID)
	if err != nil || meta.Path != tree.Path || (meta.Title == treenode.ReadDocumentTitle(tree.Root) &&
		(meta.SourceRevision == "" || meta.SourceRevision == treenode.DocumentTitleRevision(tree.Root))) {
		return &tree, nil
	}
	root := *tree.Root
	if meta.Title.Format == "inline-ast" {
		current, loadErr := filesys.LoadTree(tree.Box, tree.Path, util.NewLute())
		if loadErr != nil {
			return nil, loadErr
		}
		root.DocumentTitle = current.Root.DocumentTitle
		meta.Title = treenode.ReadDocumentTitle(current.Root)
	} else {
		root.DocumentTitle = nil
	}
	root.KramdownIAL = make([][]string, len(tree.Root.KramdownIAL))
	for i, attr := range tree.Root.KramdownIAL {
		root.KramdownIAL[i] = append([]string(nil), attr...)
	}
	root.SetIALAttr("title", meta.Title.Text)
	if meta.Title.Empty {
		root.SetIALAttr(treenode.DocumentTitleEmptyAttr, "true")
	} else {
		root.RemoveIALAttr(treenode.DocumentTitleEmptyAttr)
	}
	tree.Root = &root
	return &tree, nil
}
