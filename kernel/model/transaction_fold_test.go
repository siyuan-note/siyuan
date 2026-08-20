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
	"slices"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestHeadingMoveChildrenByBlockIDs(t *testing.T) {
	document := &ast.Node{Type: ast.NodeDocument, ID: "document"}
	heading := &ast.Node{Type: ast.NodeHeading, ID: "heading", HeadingLevel: 2}
	headingIAL := &ast.Node{Type: ast.NodeKramdownBlockIAL}
	first := treenode.NewParagraph("20260819000300-first00")
	firstIAL := &ast.Node{Type: ast.NodeKramdownBlockIAL}
	second := treenode.NewParagraph("20260819000301-second0")
	secondIAL := &ast.Node{Type: ast.NodeKramdownBlockIAL}
	acquired := treenode.NewParagraph("20260819000302-acquire")
	for _, node := range []*ast.Node{heading, headingIAL, first, firstIAL, second, secondIAL, acquired} {
		document.AppendChild(node)
	}

	children, ok := headingMoveChildrenByBlockIDs(heading, []string{first.ID, second.ID})
	if !ok {
		t.Fatal("expected the stored heading move group to resolve")
	}
	if want := []*ast.Node{first, firstIAL, second, secondIAL}; !slices.Equal(children, want) {
		t.Fatalf("unexpected heading move children: got %v, want %v", children, want)
	}

	children, ok = headingMoveChildrenByBlockIDs(heading, []string{})
	if !ok || 0 != len(children) || nil == children {
		t.Fatal("an explicit empty move group should move only the heading")
	}
	if _, ok = headingMoveChildrenByBlockIDs(heading, []string{second.ID}); ok {
		t.Fatal("a stored move group must be a prefix of the current heading children")
	}
}

func TestMovingFoldHeadingIntoDescendantContainer(t *testing.T) {
	headingChild := &ast.Node{Type: ast.NodeSuperBlock, ID: "heading-child"}
	container := &ast.Node{Type: ast.NodeSuperBlock, ID: "container"}
	target := &ast.Node{Type: ast.NodeParagraph, ID: "target"}
	headingChild.AppendChild(container)
	container.AppendChild(target)

	if !isMovingFoldHeadingIntoSelf(target, []*ast.Node{headingChild}) {
		t.Fatal("moving a folded heading into a descendant container should be rejected")
	}

	unrelated := &ast.Node{Type: ast.NodeParagraph, ID: "unrelated"}
	if isMovingFoldHeadingIntoSelf(unrelated, []*ast.Node{headingChild}) {
		t.Fatal("moving a folded heading next to an unrelated node should be allowed")
	}
}

func TestMovingParentIntoChild(t *testing.T) {
	source := &ast.Node{Type: ast.NodeListItem, ID: "source"}
	child := &ast.Node{Type: ast.NodeList, ID: "child"}
	grandchild := &ast.Node{Type: ast.NodeListItem, ID: "grandchild"}
	source.AppendChild(child)
	child.AppendChild(grandchild)

	if !isMovingParentIntoChild(source, grandchild) {
		t.Fatal("moving a parent block into a descendant should be rejected")
	}
	if isMovingParentIntoChild(source, source) {
		t.Fatal("moving a block relative to itself is handled separately")
	}
	if isMovingParentIntoChild(source, &ast.Node{Type: ast.NodeParagraph, ID: "unrelated"}) {
		t.Fatal("moving a block next to an unrelated block should be allowed")
	}
}

func TestInsertOuterSuperBlockBeforeTargetWrapper(t *testing.T) {
	const (
		sourceID = "20260726000000-source0"
		targetID = "20260726000000-target0"
		outerID  = "20260726000000-outer00"
	)
	luteEngine := util.NewLute()
	tree := luteEngine.BlockDOM2Tree(
		`<div data-node-id="` + sourceID + `" data-type="NodeSuperBlock" class="sb" data-sb-layout="row">` +
			`<div class="protyle-attr" contenteditable="false"></div></div>` +
			`<div data-node-id="` + targetID + `" data-type="NodeSuperBlock" class="sb" data-sb-layout="row">` +
			`<div class="protyle-attr" contenteditable="false"></div></div>`)
	tx := &Transaction{
		luteEngine: luteEngine,
		nodes:      map[string]*ast.Node{},
	}
	err := tx.doInsert0(&Operation{
		Action: "insert",
		ID:     outerID,
		NextID: targetID,
		Data: `<div data-node-id="` + outerID + `" data-type="NodeSuperBlock" class="sb" data-sb-layout="col">` +
			`<div class="protyle-attr" contenteditable="false"></div></div>`,
	}, tree)
	if nil != err {
		t.Fatal(err)
	}

	source := treenode.GetNodeInTree(tree, sourceID)
	target := treenode.GetNodeInTree(tree, targetID)
	outer := treenode.GetNodeInTree(tree, outerID)
	if nil == source || nil == target || nil == outer {
		t.Fatal("expected source, target, and outer super blocks")
	}
	nextSourceBlock := source.Next
	for nil != nextSourceBlock && ast.NodeKramdownBlockIAL == nextSourceBlock.Type {
		nextSourceBlock = nextSourceBlock.Next
	}
	if outer.Parent != target.Parent || outer.Next != target || nextSourceBlock != outer {
		t.Fatal("outer super block should be inserted as the target wrapper's sibling")
	}
	if isMovingParentIntoChild(source, outer) {
		t.Fatal("outer super block should not be inserted into the source wrapper")
	}
}
