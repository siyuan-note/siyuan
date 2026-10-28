// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package sql

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"reflect"
	"slices"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func projectionSnapshot[T any](values []*T) []string {
	var result []string
	for _, value := range values {
		data, _ := json.Marshal(value)
		var fields map[string]any
		json.Unmarshal(data, &fields)
		delete(fields, "ID")
		delete(fields, "id")
		data, _ = json.Marshal(fields)
		result = append(result, string(data))
	}
	slices.Sort(result)
	return result
}

func TestIndexHeadingParentsMatchIndependentLookups(t *testing.T) {
	random := rand.New(rand.NewSource(20692))
	for _, nested := range []bool{false, true} {
		root := &ast.Node{Type: ast.NodeDocument, ID: "root"}
		parents := []*ast.Node{root}
		for i := range 1000 {
			node := &ast.Node{Type: ast.NodeParagraph, ID: fmt.Sprint(i)}
			if random.Intn(4) == 0 {
				node.Type, node.HeadingLevel = ast.NodeHeading, random.Intn(21)-2
			}
			parent := parents[random.Intn(len(parents))]
			parent.AppendChild(node)
			if nested && i%20 == 0 {
				node.Type = ast.NodeBlockquote
				parents = append(parents, node)
			}
		}
		for range 2 {
			index := &indexHeadingParents{}
			ast.Walk(root, func(node *ast.Node, entering bool) ast.WalkStatus {
				if entering {
					if got, want := index.get(node), treenode.HeadingParent(node); got != want {
						t.Fatalf("parent differs for %s: got=%v want=%v", node.ID, got, want)
					}
				}
				return ast.WalkContinue
			})
			root.FirstChild.Type, root.FirstChild.HeadingLevel = ast.NodeHeading, 1
		}
	}
}

func TestIndexProjectionMatchesIndependentLookups(t *testing.T) {
	previousDir := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = previousDir })
	tree := newUpsertTestTree(30)
	for i, node := 0, tree.Root.FirstChild; node != nil; i, node = i+1, node.Next {
		if i%4 == 0 {
			node.Type, node.HeadingLevel = ast.NodeHeading, i%6+1
		}
	}
	quote := &ast.Node{Type: ast.NodeBlockquote, ID: "20261019020000-quote01"}
	quote.SetIALAttr("id", quote.ID)
	paragraph := treenode.NewParagraph("20261019020000-child01")
	paragraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("nested text")})
	quote.AppendChild(paragraph)
	tree.Root.AppendChild(quote)
	wantBlocks, wantSpans, wantAssets, wantAttrs := projectTree(tree.Root, tree, buildBlockFromNode)
	gotBlocks, gotSpans, gotAssets, gotAttrs := fromTree(tree.Root, tree)
	if !reflect.DeepEqual(wantBlocks, gotBlocks) ||
		!reflect.DeepEqual(projectionSnapshot(wantSpans), projectionSnapshot(gotSpans)) ||
		!reflect.DeepEqual(projectionSnapshot(wantAssets), projectionSnapshot(gotAssets)) ||
		!reflect.DeepEqual(projectionSnapshot(wantAttrs), projectionSnapshot(gotAttrs)) {
		t.Fatal("batch parent resolution changed the complete business projection")
	}
	changes := NewTreeIndexChanges([]string{tree.ID, quote.ID, paragraph.ID})
	blocks, spans, assets, attrs := fromTreeWithChanges(tree.Root, tree, changes)
	if len(blocks) != 3 || !reflect.DeepEqual(projectionSnapshot(spans), projectionSnapshot(gotSpans)) ||
		!reflect.DeepEqual(projectionSnapshot(assets), projectionSnapshot(gotAssets)) ||
		!reflect.DeepEqual(projectionSnapshot(attrs), projectionSnapshot(gotAttrs)) {
		t.Fatal("scoped projection omitted complete auxiliary metadata")
	}
	for _, block := range blocks {
		found := false
		for _, complete := range wantBlocks {
			if complete.ID == block.ID {
				found = reflect.DeepEqual(block, complete)
			}
		}
		if !found {
			t.Fatalf("scoped block differs from complete projection: %+v", block)
		}
	}
}
