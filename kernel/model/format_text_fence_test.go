// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"reflect"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
)

func literalFenceTestTree(marker string) *parse.Tree {
	tree := parseKTree([]byte("placeholder\n\n```\noriginal();\n```\n\n# Following\n\n![gif](assets/animation-20261109000000-abcdefg.gif)\n\n![png](assets/picture-20261109000000-abcdefg.png)\n"))
	tree.Root.FirstChild.FirstChild.Tokens = []byte("<pre>\n  " + marker + "Java\nexample\n</pre>")
	removeLiteralFenceTestIAL(tree)
	return tree
}

func removeLiteralFenceTestIAL(tree *parse.Tree) {
	var nodes []*ast.Node
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if entering && n.Type == ast.NodeKramdownBlockIAL {
			nodes = append(nodes, n)
		}
		return ast.WalkContinue
	})
	for _, n := range nodes {
		n.Unlink()
	}
}

func TestAutoSpacePreservesLiteralFencesAndFollowingBlocks(t *testing.T) {
	previousConf := Conf
	Conf = NewAppConf()
	Conf.Editor.Store(conf.NewEditor())
	Conf.Export.Store(conf.NewExport())
	t.Cleanup(func() { Conf = previousConf })
	for _, marker := range []string{"```", "~~~~"} {
		t.Run(marker, func(t *testing.T) {
			tree := literalFenceTestTree(marker)
			blockTypes := func(tree *parse.Tree) map[string]ast.NodeType {
				ret := map[string]ast.NodeType{}
				ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
					if entering && n.IsBlock() && n.Type != ast.NodeKramdownBlockIAL {
						ret[n.ID] = n.Type
					}
					return ast.WalkContinue
				})
				return ret
			}
			before := blockTypes(tree)
			assets := getAssetsLinkDests(tree.Root, false)
			for pass := range 2 {
				tree = autoSpaceTree(tree)
				if got := blockTypes(tree); !reflect.DeepEqual(got, before) {
					t.Fatalf("pass %d changed block IDs or types: %v, expected %v", pass, got, before)
				}
				if got := getAssetsLinkDests(tree.Root, false); !reflect.DeepEqual(got, assets) {
					t.Fatalf("pass %d changed image references: %v", pass, got)
				}
				if got := string(tree.Root.ChildByType(ast.NodeCodeBlock).ChildByType(ast.NodeCodeBlockCode).Tokens); got != "original();\n" {
					t.Fatalf("pass %d changed real code: %q", pass, got)
				}
				removeLiteralFenceTestIAL(tree)
			}
		})
	}
}
