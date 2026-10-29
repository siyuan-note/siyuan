// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package filesys

import (
	"bytes"
	"fmt"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func BenchmarkDocumentJSON(b *testing.B) {
	previousDataDir := util.DataDir
	util.DataDir = b.TempDir()
	b.Cleanup(func() { util.DataDir = previousDataDir })
	for _, size := range []int{1000, 5000, 20000} {
		tree := treenode.NewTree("20261019000000-box0001", "/20261019000000-doc0001.sy", "/Baseline", "Baseline")
		for tree.Root.FirstChild != nil {
			tree.Root.FirstChild.Unlink()
		}
		for i := range size {
			paragraph := treenode.NewParagraph(fmt.Sprintf("20261019000000-%07d", i))
			paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(strings.Repeat("baseline text ", 8))})
			tree.Root.AppendChild(paragraph)
		}
		data, _, err := prepareWriteTree(tree)
		if err != nil {
			b.Fatal(err)
		}
		b.Run(fmt.Sprintf("serialize/%d", size), func(b *testing.B) {
			b.ReportAllocs()
			b.SetBytes(int64(len(data)))
			for i := 0; i < b.N; i++ {
				if _, _, err := prepareWriteTree(tree); err != nil {
					b.Fatal(err)
				}
			}
		})
		b.Run(fmt.Sprintf("parse/%d", size), func(b *testing.B) {
			luteEngine := util.NewLute()
			b.ReportAllocs()
			b.SetBytes(int64(len(data)))
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if _, err := parseJSON2Tree(tree.Box, tree.Path, data, luteEngine); err != nil {
					b.Fatal(err)
				}
			}
		})
		b.Run(fmt.Sprintf("properties/%d", size), func(b *testing.B) {
			b.ReportAllocs()
			b.SetBytes(int64(len(data)))
			for i := 0; i < b.N; i++ {
				if _, err := parseDocIAL(bytes.NewReader(data)); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
