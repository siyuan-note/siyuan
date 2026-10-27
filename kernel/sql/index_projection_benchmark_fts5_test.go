// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package sql

import (
	"fmt"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func BenchmarkIndexProjection(b *testing.B) {
	previousDir := util.DataDir
	util.DataDir = b.TempDir()
	b.Cleanup(func() { util.DataDir = previousDir })
	for _, size := range []int{1000, 5000, 20000} {
		for _, mode := range []string{"independent", "batch_parents", "changeset"} {
			b.Run(fmt.Sprintf("%d/%s", size, mode), func(b *testing.B) {
				tree := newUpsertTestTree(size)
				tree.Root.FirstChild.FirstChild.Tokens = []byte("changed ordinary paragraph content ")
				changes := NewTreeIndexChanges([]string{tree.ID, tree.Root.FirstChild.ID})
				b.ReportAllocs()
				b.ResetTimer()
				for range b.N {
					var blocks []*Block
					switch mode {
					case "independent":
						// 独立查找两次父级，对照哈希及主块字段各自解析父级的成本。
						blocks, _, _, _ = projectTree(tree.Root, tree, func(node *ast.Node, source *parse.Tree) (*Block, []*Attribute) {
							parent := treenode.HeadingParent(node)
							block, attributes := buildBlockFromNode(node, source)
							if node.Type != ast.NodeDocument && parent != nil && parent.ID != block.ParentID {
								b.Fatal("independent parent changed during projection")
							}
							return block, attributes
						})
					case "batch_parents":
						blocks, _, _, _ = fromTree(tree.Root, tree)
					case "changeset":
						blocks, _, _, _ = fromTreeWithChanges(tree.Root, tree, changes)
					}
					want := size + 1
					if mode == "changeset" {
						want = 2
					}
					if len(blocks) != want {
						b.Fatalf("projected %d blocks, want %d", len(blocks), want)
					}
				}
			})
		}
	}
}
