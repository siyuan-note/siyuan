// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

// BenchmarkDocumentReadBoundarySource 测量完整来源树的加载，包含缓存解压、解析及读取锁成本。
func BenchmarkDocumentReadBoundarySource(b *testing.B) {
	for _, size := range []int{20, 1000, 5000, 20000} {
		b.Run(fmt.Sprint(size), func(b *testing.B) {
			fixture := setupFileOperationTest(b)
			tree := treenode.NewTree(fixture.box.ID, fixture.sourcePath, "/Source", "Source")
			tree.Root.FirstChild.Unlink()
			for i := range size {
				node := treenode.NewParagraph(fmt.Sprintf("20261019000001-%07d", i))
				node.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(strings.Repeat("content ", 16))})
				tree.Root.AppendChild(node)
			}
			if _, err := filesys.WriteTree(tree); err != nil {
				b.Fatal(err)
			}
			treenode.UpsertBlockTree(tree)
			deadline := time.Now().Add(time.Second)
			for {
				if _, ok := cache.GetTreeDataInBox(tree.ID, tree.Box); ok {
					break
				}
				if time.Now().After(deadline) {
					b.Fatal("source cache was not published")
				}
				time.Sleep(time.Millisecond)
			}
			b.Run("capture", func(b *testing.B) {
				b.ReportAllocs()
				for b.Loop() {
					if source, err := captureDocumentSourceAtTransactionBoundary(tree.ID, "", nil); err != nil || source == nil {
						b.Fatalf("source capture did not use the warm cache: %v", err)
					}
				}
			})
			for _, cold := range []bool{false, true} {
				for _, boundary := range []bool{false, true} {
					b.Run(fmt.Sprintf("cold=%t/boundary=%t", cold, boundary), func(b *testing.B) {
						if _, err := loadDocumentAtTransactionBoundary(tree.ID, "", nil); err != nil {
							b.Fatal(err)
						}
						b.ReportAllocs()
						for b.Loop() {
							if cold {
								cache.RemoveTreeDataInBox(tree.ID, tree.Box)
							}
							var err error
							if boundary {
								_, err = loadDocumentAtTransactionBoundary(tree.ID, "", nil)
							} else {
								FlushTxQueue()
								_, err = loadTreeByBlockIDInBox0(tree.ID, "", false)
							}
							if err != nil {
								b.Fatal(err)
							}
						}
						b.ReportMetric(float64(size), "blocks/op")
					})
				}
			}
		})
	}
}
